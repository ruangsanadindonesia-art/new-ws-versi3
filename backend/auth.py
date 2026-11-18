"""Authentication module - Google OAuth mandiri (fallback Emergent) + email/password."""
import os
import uuid
import secrets
import hashlib
import bcrypt
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional
import base64
import json
from urllib.parse import urlencode, quote
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorDatabase


EMERGENT_AUTH_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_COOKIE = "session_token"
GOOGLE_STATE_COOKIE = "g_oauth_state"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _google_cfg():
    """Google OAuth mandiri aktif bila GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET ada di .env."""
    cid, sec = os.environ.get("GOOGLE_CLIENT_ID"), os.environ.get("GOOGLE_CLIENT_SECRET")
    if not cid or not sec:
        return None
    return {"client_id": cid, "client_secret": sec,
            "redirect_uri": os.environ.get("GOOGLE_REDIRECT_URI", "https://workspace.ruangsanad.com/api/auth/google/callback")}


def _jwt_claims(token: str) -> dict:
    """Ambil payload id_token. Aman tanpa cek tanda tangan karena token diterima langsung dari
    endpoint token Google lewat TLS dengan client secret (OIDC Core 3.1.3.7)."""
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
SESSION_DAYS = 7


# ============== MODELS ==============
class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionPayload(BaseModel):
    session_id: str


class UpdateUserPayload(BaseModel):
    status: Optional[str] = None  # pending | approved | rejected
    role: Optional[str] = None  # spv | anggota
    anggota_id: Optional[str] = None


class UpdateProfilePayload(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=6)


class CreateUserPayload(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)
    role: str = "anggota"  # spv | anggota
    anggota_id: Optional[str] = None


class ResetPasswordPayload(BaseModel):
    new_password: str = Field(min_length=6)


class ApiKeyCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scope: str = "read"      # read | write  (kunci personal)
    kind: str = "personal"   # personal | gateway (gateway: SPV saja, selalu baca-saja)


# ============== LOGIN RATE LIMIT ==============
# In-memory (per proses). Cukup untuk 1 worker uvicorn; mencegah tebak password massal.
import time
_LOGIN_FAILS: dict = {}
LOGIN_MAX_FAILS = 8
LOGIN_WINDOW_SEC = 15 * 60


def _client_ip(request: Request) -> str:
    return (request.headers.get("CF-Connecting-IP") or request.headers.get("X-Real-IP")
            or (request.client.host if request.client else "-"))


def _login_blocked(keys) -> bool:
    now = time.time()
    for k in keys:
        arr = [t for t in _LOGIN_FAILS.get(k, []) if now - t < LOGIN_WINDOW_SEC]
        _LOGIN_FAILS[k] = arr
        limit = LOGIN_MAX_FAILS if k.startswith("e:") else LOGIN_MAX_FAILS * 4
        if len(arr) >= limit:
            return True
    return False


def _login_fail(keys):
    now = time.time()
    for k in keys:
        _LOGIN_FAILS.setdefault(k, []).append(now)


# ============== HELPERS ==============
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _sanitize(user: dict) -> dict:
    u = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return u


def _set_session_cookie(response: Response, token: str):
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=SESSION_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(key=SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")


async def _create_session(db, user_id: str, source: str = "local") -> str:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "source": source,
        "created_at": datetime.now(timezone.utc),
        "expires_at": expires_at,
    })
    return token


async def get_current_user_optional(request: Request, db):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if sess:
        expires_at = sess.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < datetime.now(timezone.utc):
            await db.user_sessions.delete_one({"session_token": token})
            return None
        return await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    # API key (rs_live_...) TIDAK berlaku untuk REST API; hanya untuk endpoint MCP /api/mcp (lihat agent_mcp.py).
    return None


def make_auth_dependencies(db):
    async def get_current_user(request: Request) -> dict:
        user = await get_current_user_optional(request, db)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if user.get("status") != "approved":
            raise HTTPException(status_code=403, detail=f"Akun {user.get('status', 'pending')} — belum bisa akses.")
        return _sanitize(user)

    async def require_spv(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") != "spv":
            raise HTTPException(status_code=403, detail="Hanya SPV yang bisa mengakses.")
        return user

    return get_current_user, require_spv


# ============== SEED ==============
async def seed_admin(db):
    # Tanpa ADMIN_EMAIL/ADMIN_PASSWORD di env: JANGAN buat akun default (dulu admin@example.com/admin12345).
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    name = os.environ.get("ADMIN_NAME") or "Admin SPV"

    existing = await db.users.find_one({"email": email}) if email else None
    if not email or not password or len(password) < 12:
        pass  # seeding dimatikan; hanya buat index di bawah
    elif existing is None:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "password_hash": hash_password(password),
            "role": "spv",
            "status": "approved",
            "auth_provider": "local",
            "picture": "",
            "anggota_id": None,
            "created_at": datetime.now(timezone.utc),
        })
    # Akun yang sudah ada TIDAK di-reset otomatis (dulu password & role dipaksa ulang setiap restart).

    # Indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.api_keys.create_index("key_hash", unique=True)
        await db.api_keys.create_index("user_id")
    except Exception:
        pass


# ============== ROUTER FACTORY ==============
def build_auth_router(db: AsyncIOMotorDatabase) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])
    get_current_user, require_spv = make_auth_dependencies(db)

    @router.post("/register")
    async def register(payload: RegisterPayload, response: Response):
        email = payload.email.lower()
        existing = await db.users.find_one({"email": email})
        if existing:
            raise HTTPException(400, "Email sudah terdaftar.")
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id,
            "email": email,
            "name": payload.name.strip(),
            "password_hash": hash_password(payload.password),
            "role": "anggota",
            "status": "pending",
            "auth_provider": "local",
            "picture": "",
            "anggota_id": None,
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(doc)
        return {"ok": True, "status": "pending", "message": "Menunggu approval SPV."}

    @router.post("/login")
    async def login(payload: LoginPayload, request: Request, response: Response):
        email = payload.email.lower()
        rl_keys = [f"e:{email}", f"i:{_client_ip(request)}"]
        if _login_blocked(rl_keys):
            raise HTTPException(429, "Terlalu banyak percobaan login gagal. Coba lagi 15 menit lagi.")
        user = await db.users.find_one({"email": email})
        if not user or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
            _login_fail(rl_keys)
            raise HTTPException(401, "Email atau password salah.")
        _LOGIN_FAILS.pop(f"e:{email}", None)
        if user.get("status") == "pending":
            # Return user info so the frontend can route to /pending, but do NOT issue a session cookie.
            return {"ok": False, "status": "pending", "user": _sanitize(user), "message": "Akun menunggu approval SPV."}
        if user.get("status") == "rejected":
            raise HTTPException(403, "Akun Anda ditolak. Hubungi SPV.")
        token = await _create_session(db, user["user_id"], "local")
        _set_session_cookie(response, token)
        return {"ok": True, "status": "approved", "user": _sanitize(user)}

    @router.post("/google/session")
    async def google_session(payload: GoogleSessionPayload, response: Response):
        # Exchange session_id with Emergent auth service
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    EMERGENT_AUTH_URL,
                    headers={"X-Session-ID": payload.session_id},
                )
        except Exception as e:
            raise HTTPException(502, f"Gagal hubungi Emergent Auth: {e}")
        if r.status_code != 200:
            raise HTTPException(401, "Sesi Google tidak valid atau kadaluarsa.")
        data = r.json()
        email = (data.get("email") or "").lower()
        if not email:
            raise HTTPException(400, "Email Google tidak ditemukan.")
        emergent_token = data.get("session_token")
        user = await _upsert_google_user(email, data.get("name"), data.get("picture"))
        # Always issue our own session cookie
        token = await _create_session(db, user["user_id"], "google")
        # Also store the Emergent token for reference
        if emergent_token:
            await db.user_sessions.update_one(
                {"session_token": token},
                {"$set": {"emergent_token": emergent_token}},
            )
        _set_session_cookie(response, token)
        return {"ok": True, "user": _sanitize(user), "status": user.get("status")}

    async def _upsert_google_user(email: str, name: Optional[str], picture: Optional[str]) -> dict:
        data = {"name": name, "picture": picture}
        existing = await db.users.find_one({"email": email})
        if existing:
            upd = {"picture": data.get("picture") or existing.get("picture", "")}
            if not existing.get("name"):
                upd["name"] = data.get("name") or email
            # If Google account exists as local without picture, save it
            await db.users.update_one({"email": email}, {"$set": upd})
            user = await db.users.find_one({"email": email})
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            user = {
                "user_id": user_id,
                "email": email,
                "name": data.get("name") or email,
                "password_hash": None,
                "role": "anggota",
                "status": "pending",
                "auth_provider": "google",
                "picture": data.get("picture") or "",
                "anggota_id": None,
                "created_at": datetime.now(timezone.utc),
            }
            await db.users.insert_one(user)
        return user

    # ---------- Google OAuth mandiri (tanpa Emergent) ----------
    @router.get("/config")
    async def auth_config():
        return {"google_mandiri": _google_cfg() is not None}

    @router.get("/google/start")
    async def google_start():
        cfg = _google_cfg()
        if not cfg:
            raise HTTPException(404, "Login Google mandiri belum dikonfigurasi.")
        state = secrets.token_urlsafe(24)
        q = urlencode({"client_id": cfg["client_id"], "redirect_uri": cfg["redirect_uri"], "response_type": "code",
                       "scope": "openid email profile", "state": state, "prompt": "select_account"})
        resp = RedirectResponse(f"{GOOGLE_AUTH_URL}?{q}", status_code=302)
        resp.set_cookie(GOOGLE_STATE_COOKIE, state, max_age=600, httponly=True, secure=True, samesite="lax", path="/api/auth/google")
        return resp

    def _gagal(pesan: str) -> RedirectResponse:
        resp = RedirectResponse("/login?google_error=" + quote(pesan), status_code=302)
        resp.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/auth/google")
        return resp

    @router.get("/google/callback")
    async def google_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
        cfg = _google_cfg()
        if not cfg:
            return _gagal("Login Google mandiri belum dikonfigurasi.")
        if error:
            return _gagal("Login Google dibatalkan." if error == "access_denied" else f"Google menolak: {error}")
        saved = request.cookies.get(GOOGLE_STATE_COOKIE)
        if not code or not state or not saved or not secrets.compare_digest(saved, state):
            return _gagal("Sesi login kedaluwarsa. Silakan coba lagi.")
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(GOOGLE_TOKEN_URL, data={"code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                                                              "redirect_uri": cfg["redirect_uri"], "grant_type": "authorization_code"})
        except Exception:
            return _gagal("Tidak bisa menghubungi Google. Coba lagi.")
        if r.status_code != 200 or "id_token" not in r.json():
            return _gagal("Kode login Google tidak valid. Coba lagi.")
        c = _jwt_claims(r.json()["id_token"])
        if c.get("aud") != cfg["client_id"] or c.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
            return _gagal("Token Google tidak sah.")
        if int(c.get("exp", 0)) < datetime.now(timezone.utc).timestamp():
            return _gagal("Token Google kedaluwarsa. Coba lagi.")
        email = (c.get("email") or "").lower()
        if not email or not c.get("email_verified"):
            return _gagal("Email Google belum terverifikasi.")
        user = await _upsert_google_user(email, c.get("name"), c.get("picture"))
        if user.get("status") == "rejected":
            return _gagal("Akun Anda ditolak. Hubungi SPV.")
        token = await _create_session(db, user["user_id"], "google")
        resp = RedirectResponse("/pending" if user.get("status") == "pending" else "/", status_code=302)
        _set_session_cookie(resp, token)
        resp.delete_cookie(GOOGLE_STATE_COOKIE, path="/api/auth/google")
        return resp

    @router.get("/me")
    async def me(request: Request):
        user = await get_current_user_optional(request, db)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return _sanitize(user)

    @router.post("/logout")
    async def logout(request: Request, response: Response):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            await db.user_sessions.delete_one({"session_token": token})
        _clear_session_cookie(response)
        return {"ok": True}

    # ---------- USER MANAGEMENT (SPV) ----------
    @router.get("/users")
    async def list_users(status: Optional[str] = None, _: dict = Depends(require_spv)):
        q = {}
        if status:
            q["status"] = status
        rows = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
        return rows

    @router.put("/users/{user_id}")
    async def update_user(user_id: str, payload: UpdateUserPayload, current: dict = Depends(require_spv)):
        upd = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not upd:
            raise HTTPException(400, "Tidak ada perubahan.")
        # Prevent demoting the last SPV
        if upd.get("role") == "anggota" or upd.get("status") in ("pending", "rejected"):
            target = await db.users.find_one({"user_id": user_id})
            if target and target.get("role") == "spv":
                spv_count = await db.users.count_documents({"role": "spv", "status": "approved"})
                if spv_count <= 1:
                    raise HTTPException(400, "Tidak bisa demote SPV terakhir.")
        result = await db.users.find_one_and_update(
            {"user_id": user_id},
            {"$set": upd},
            return_document=True,
            projection={"_id": 0, "password_hash": 0},
        )
        if not result:
            raise HTTPException(404, "User tidak ditemukan.")
        return result

    @router.delete("/users/{user_id}")
    async def delete_user(user_id: str, current: dict = Depends(require_spv)):
        if user_id == current.get("user_id"):
            raise HTTPException(400, "Tidak bisa hapus akun sendiri.")
        target = await db.users.find_one({"user_id": user_id})
        if target and target.get("role") == "spv":
            spv_count = await db.users.count_documents({"role": "spv", "status": "approved"})
            if spv_count <= 1:
                raise HTTPException(400, "Tidak bisa hapus SPV terakhir.")
        r = await db.users.delete_one({"user_id": user_id})
        await db.user_sessions.delete_many({"user_id": user_id})
        await db.api_keys.delete_many({"user_id": user_id})
        return {"ok": True, "deleted": r.deleted_count}

    # ---------- API KEYS UNTUK AGENT AI (MCP) ----------
    # Setiap user boleh membuat kunci personal (bertindak sebagai dirinya). Gateway (Hermes bersama) hanya SPV.
    MAX_KEYS = 5

    @router.get("/api-keys")
    async def list_api_keys(request: Request):
        current = await get_current_user(request)
        q = {"user_id": current["user_id"]}
        if current.get("role") == "spv" and request.query_params.get("semua") == "1":
            q = {}
        rows = await db.api_keys.find(q, {"_id": 0, "key_hash": 0}).sort("created_at", -1).to_list(200)
        if q == {}:
            names = {u["user_id"]: u.get("name") for u in await db.users.find({}, {"_id": 0, "user_id": 1, "name": 1}).to_list(1000)}
            for r in rows:
                r["owner_name"] = names.get(r["user_id"])
        return rows

    @router.post("/api-keys")
    async def create_api_key(payload: ApiKeyCreatePayload, request: Request):
        current = await get_current_user(request)
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Nama integrasi wajib diisi.")
        if payload.kind not in ("personal", "gateway"):
            raise HTTPException(400, "Jenis kunci tidak valid.")
        if payload.kind == "gateway" and current.get("role") != "spv":
            raise HTTPException(403, "Kunci gateway (Hermes bersama) hanya bisa dibuat SPV.")
        if payload.scope not in ("read", "write"):
            raise HTTPException(400, "Scope harus read atau write.")
        active = await db.api_keys.count_documents({"user_id": current["user_id"], "revoked_at": None})
        if active >= MAX_KEYS:
            raise HTTPException(400, f"Maksimal {MAX_KEYS} kunci aktif. Cabut kunci lama dulu.")
        raw_key = f"rs_live_{secrets.token_urlsafe(32)}"
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current["user_id"],
            "name": name,
            "kind": payload.kind,
            "scope": "read" if payload.kind == "gateway" else payload.scope,
            "prefix": raw_key[:16],
            "key_hash": hashlib.sha256(raw_key.encode("utf-8")).hexdigest(),
            "created_at": datetime.now(timezone.utc),
            "last_used_at": None,
            "revoked_at": None,
        }
        await db.api_keys.insert_one(doc)
        return {**{k: v for k, v in doc.items() if k not in ("_id", "key_hash")}, "key": raw_key}

    @router.delete("/api-keys/{key_id}")
    async def revoke_api_key(key_id: str, request: Request):
        current = await get_current_user(request)
        q = {"id": key_id, "revoked_at": None}
        if current.get("role") != "spv":
            q["user_id"] = current["user_id"]  # SPV boleh mencabut kunci siapa pun
        result = await db.api_keys.update_one(q, {"$set": {"revoked_at": datetime.now(timezone.utc)}})
        if not result.modified_count:
            raise HTTPException(404, "API key tidak ditemukan atau sudah dicabut.")
        await db.agent_chat_links.delete_many({"gateway_key_id": key_id})
        return {"ok": True}

    # ---------- PENAUTAN AKUN CHAT (HERMES BERSAMA) ----------
    @router.post("/agent/link-code")
    async def create_link_code(request: Request):
        current = await get_current_user(request)
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        code = "WS-" + "".join(secrets.choice(alphabet) for _ in range(6))
        expires = datetime.now(timezone.utc) + timedelta(minutes=10)
        await db.agent_link_codes.delete_many({"user_id": current["user_id"]})
        await db.agent_link_codes.insert_one({"code": code, "user_id": current["user_id"], "expires_at": expires})
        return {"kode": code, "berlaku_sampai": expires}

    @router.get("/agent/links")
    async def list_links(request: Request):
        current = await get_current_user(request)
        return await db.agent_chat_links.find({"user_id": current["user_id"]}, {"_id": 0}).to_list(50)

    @router.delete("/agent/links")
    async def delete_link(chat_id: str, request: Request):
        current = await get_current_user(request)
        r = await db.agent_chat_links.delete_many({"user_id": current["user_id"], "chat_id": chat_id})
        return {"ok": True, "deleted": r.deleted_count}

    @router.get("/agent/audit")
    async def agent_audit(request: Request):
        current = await get_current_user(request)
        q = {} if current.get("role") == "spv" else {"user_id": current["user_id"]}
        rows = await db.agent_audit.find(q, {"_id": 0}).sort("at", -1).to_list(100)
        if rows:
            names = {u["user_id"]: u.get("name") for u in await db.users.find({}, {"_id": 0, "user_id": 1, "name": 1}).to_list(1000)}
            for r in rows:
                r["user_name"] = names.get(r["user_id"])
        return rows

    # ---------- PROFILE (SELF-SERVICE) ----------
    @router.put("/profile")
    async def update_profile(payload: UpdateProfilePayload, request: Request):
        user = await get_current_user(request)
        upd = {}
        if payload.name is not None and payload.name.strip():
            upd["name"] = payload.name.strip()
        if payload.email is not None:
            email = payload.email.lower()
            existing = await db.users.find_one({"email": email})
            if existing and existing["user_id"] != user["user_id"]:
                raise HTTPException(400, "Email sudah dipakai akun lain.")
            upd["email"] = email
        if payload.new_password:
            full = await db.users.find_one({"user_id": user["user_id"]})
            if not full.get("password_hash"):
                raise HTTPException(400, "Akun Google tidak punya password lokal. Minta SPV untuk reset password.")
            if not payload.current_password or not verify_password(payload.current_password, full["password_hash"]):
                raise HTTPException(400, "Password saat ini salah.")
            upd["password_hash"] = hash_password(payload.new_password)
        if not upd:
            raise HTTPException(400, "Tidak ada perubahan.")
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": upd})
        if payload.new_password:
            # Cabut sesi lain, pertahankan sesi saat ini
            token = request.cookies.get(SESSION_COOKIE)
            if not token:
                auth = request.headers.get("Authorization", "")
                if auth.startswith("Bearer "):
                    token = auth[7:]
            q = {"user_id": user["user_id"]}
            if token:
                q["session_token"] = {"$ne": token}
            await db.user_sessions.delete_many(q)
        return {"ok": True}

    # ---------- MANUAL USER MANAGEMENT (SPV) ----------
    @router.post("/users")
    async def create_user(payload: CreateUserPayload, _: dict = Depends(require_spv)):
        email = payload.email.lower()
        if await db.users.find_one({"email": email}):
            raise HTTPException(400, "Email sudah terdaftar.")
        if payload.role not in ("spv", "anggota"):
            raise HTTPException(400, "Role tidak valid.")
        doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "name": payload.name.strip(),
            "password_hash": hash_password(payload.password),
            "role": payload.role,
            "status": "approved",
            "auth_provider": "local",
            "picture": "",
            "anggota_id": payload.anggota_id,
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(doc)
        return _sanitize(doc)

    @router.put("/users/{user_id}/password")
    async def reset_user_password(user_id: str, payload: ResetPasswordPayload, _: dict = Depends(require_spv)):
        target = await db.users.find_one({"user_id": user_id})
        if not target:
            raise HTTPException(404, "User tidak ditemukan.")
        await db.users.update_one({"user_id": user_id}, {"$set": {"password_hash": hash_password(payload.new_password)}})
        await db.user_sessions.delete_many({"user_id": user_id})
        return {"ok": True}

    return router
