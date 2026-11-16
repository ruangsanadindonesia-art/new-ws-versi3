from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Depends, Response, Query, Request
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import io
import re
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, BeforeValidator
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, date, timedelta
import openpyxl

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from auth import build_auth_router, seed_admin, make_auth_dependencies, get_current_user_optional
from monitoring import build_monitoring_router
from strategy import build_strategy_router
from pdf_export import build_raport_pdf

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Workspace Ruang Sanad API")
api_router = APIRouter(prefix="/api")

get_current_user, require_spv = make_auth_dependencies(db)


# ============ SCOPE HELPERS ============
async def user_scope(user: dict) -> dict:
    """Return effective scope: {is_spv, user_id, anggota_id, divisi_id, is_head, head_divisi_id}"""
    is_spv = user.get("role") == "spv"
    anggota_id = user.get("anggota_id")
    divisi_id = None
    head_divisi_id = None
    if anggota_id:
        a = await db.anggota.find_one({"id": anggota_id}, {"_id": 0})
        if a:
            divisi_id = a.get("divisi_id")
        hd = await db.divisi.find_one({"head_anggota_id": anggota_id}, {"_id": 0, "id": 1})
        if hd:
            head_divisi_id = hd["id"]
    return {"is_spv": is_spv, "user_id": user["user_id"], "anggota_id": anggota_id,
            "divisi_id": divisi_id, "is_head": head_divisi_id is not None, "head_divisi_id": head_divisi_id}


async def _assert_task_access(task_id: str, user: dict) -> dict:
    """Load a task and verify user is SPV, penerima, pemberi, or task belongs to their divisi (rutin only)."""
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(404, "Task not found")
    scope = await user_scope(user)
    if scope["is_spv"]:
        return task
    my_ang = scope["anggota_id"]
    is_rutin = task.get("kategori") in ("HARIAN", "MINGGUAN", "BULANAN")
    if my_ang and (task.get("penerima_tugas_id") == my_ang or task.get("pemberi_id") == my_ang
                   or my_ang in (task.get("consulted_ids") or []) or my_ang in (task.get("informed_ids") or [])):
        return task
    if is_rutin and scope["divisi_id"] and task.get("divisi_id") == scope["divisi_id"]:
        return task
    raise HTTPException(403, "Tugas ini bukan bagian dari workspace Anda.")


def _can_manage_task(task: dict, scope: dict, action: str) -> bool:
    """action: 'archive' (setara edit: SPV/penerima) | 'delete' (SPV, atau tugas milik sendiri)."""
    if scope["is_spv"]:
        return True
    me = scope["anggota_id"]
    if not me:
        return False
    is_penerima = task.get("penerima_tugas_id") == me
    is_pemberi = task.get("pemberi_id") == me
    if action == "archive":
        return is_penerima
    if action == "delete":
        return is_penerima and is_pemberi
    return False


async def _assert_bulk_manage(ids: List[str], user: dict, action: str) -> None:
    if not ids:
        return
    scope = await user_scope(user)
    rows = await db.tasks.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "nama": 1, "pemberi_id": 1, "penerima_tugas_id": 1}).to_list(len(ids))
    bad = [r.get("nama") or r["id"] for r in rows if not _can_manage_task(r, scope, action)]
    if bad:
        verb = "menghapus" if action == "delete" else "mengarsipkan"
        raise HTTPException(403, f"Anda tidak berhak {verb} {len(bad)} tugas: " + ", ".join(bad[:3]) + ("…" if len(bad) > 3 else ""))


async def _assert_bulk_task_access(ids: List[str], user: dict) -> List[dict]:
    scope = await user_scope(user)
    if not ids:
        return []
    rows = await db.tasks.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "divisi_id": 1}).to_list(len(ids))
    if not scope["is_spv"]:
        if not scope["divisi_id"]:
            raise HTTPException(403, "Akun belum terhubung ke tim.")
        for r in rows:
            if r.get("divisi_id") != scope["divisi_id"]:
                raise HTTPException(403, "Ada tugas di luar tim Anda dalam seleksi.")
    return rows


PUBLIC_PATHS = {"/api", "/api/"}
AUTH_PUBLIC_PREFIXES = ("/api/auth/register", "/api/auth/login", "/api/auth/google", "/api/auth/me", "/api/auth/logout",
                        "/api/mcp")  # /api/mcp mengautentikasi API key sendiri (agent_mcp.py)


@app.middleware("http")
async def require_auth_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") and path != "/api":
        return await call_next(request)
    if path in PUBLIC_PATHS or path.startswith(AUTH_PUBLIC_PREFIXES):
        return await call_next(request)
    # All other /api/* require an active session
    user = await get_current_user_optional(request, db)
    if not user:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    if user.get("status") != "approved":
        return JSONResponse({"detail": f"Akun {user.get('status', 'pending')} — belum bisa akses."}, status_code=403)
    return await call_next(request)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _log_activity(task_id: str, user: dict, kind: str, text: str):
    """Append a comment/activity entry for a task's history feed."""
    await db.task_activity.insert_one({
        "id": str(uuid.uuid4()),
        "task_id": task_id,
        "user_id": user.get("user_id"),
        "actor_name": user.get("name") or user.get("email") or "-",
        "kind": kind,  # create | status | revisi | move | comment
        "text": text,
        "created_at": now_iso(),
    })


# ============ TASK MODELS ============
class TaskBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nama: str
    kategori: str = "HARIAN"  # HARIAN | MINGGUAN | BULANAN | PROJECT
    frekuensi: str = "RUTIN"  # RUTIN | TIDAK RUTIN | SEKALI
    status: str = "BELUM_MULAI"  # BELUM_MULAI | DALAM_PROSES | MENUNGGU_REVIEW | REVISI | TERKENDALA | SELESAI
    pemberi_tugas: Optional[str] = ""
    penerima_tugas: Optional[str] = ""
    tanggal_mulai: Optional[str] = None  # ISO date
    deadline: Optional[str] = None  # ISO date
    durasi: Optional[str] = ""
    catatan_tim: Optional[str] = ""
    catatan_spv: Optional[str] = ""
    link_output: Optional[str] = ""
    divisi: Optional[str] = "Umum"
    divisi_id: Optional[str] = None
    urutan: int = 0
    list_id: Optional[str] = None
    label_ids: List[str] = Field(default_factory=list)
    kategori_id: Optional[str] = None
    penerima_tugas_id: Optional[str] = None
    pemberi_id: Optional[str] = None  # anggota_id yg mendelegasikan (auto-set on create for anggota)
    brief_link: Optional[str] = ""  # URL brief eksternal (opsional)
    hasil_link: Optional[str] = ""  # URL hasil dari penerima
    hasil_catatan: Optional[str] = ""  # Catatan hasil dari penerima
    revisi_catatan: Optional[str] = ""  # Catatan revisi dari pemberi/SPV
    revisi_at: Optional[str] = None
    revisi_count: int = 0
    moved_at: Optional[str] = None
    # RACI: R = penerima_tugas_id, A = pemberi_id, C/I = daftar anggota_id
    consulted_ids: List[str] = Field(default_factory=list)
    informed_ids: List[str] = Field(default_factory=list)
    sasaran_id: Optional[str] = None  # tugas ini mendukung sasaran mana (modul Sasaran)


class Task(TaskBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    archived: bool = False
    archived_at: Optional[str] = None


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nama: Optional[str] = None
    kategori: Optional[str] = None
    frekuensi: Optional[str] = None
    status: Optional[str] = None
    pemberi_tugas: Optional[str] = None
    penerima_tugas: Optional[str] = None
    tanggal_mulai: Optional[str] = None
    deadline: Optional[str] = None
    durasi: Optional[str] = None
    catatan_tim: Optional[str] = None
    catatan_spv: Optional[str] = None
    link_output: Optional[str] = None
    divisi: Optional[str] = None
    divisi_id: Optional[str] = None
    urutan: Optional[int] = None
    list_id: Optional[str] = None
    label_ids: Optional[List[str]] = None
    archived: Optional[bool] = None
    kategori_id: Optional[str] = None
    penerima_tugas_id: Optional[str] = None
    pemberi_id: Optional[str] = None
    brief_link: Optional[str] = None
    hasil_link: Optional[str] = None
    hasil_catatan: Optional[str] = None
    revisi_catatan: Optional[str] = None
    revisi_at: Optional[str] = None
    revisi_count: Optional[int] = None
    moved_at: Optional[str] = None
    consulted_ids: Optional[List[str]] = None
    informed_ids: Optional[List[str]] = None
    sasaran_id: Optional[str] = None


class MoveTaskPayload(BaseModel):
    divisi_id: Optional[str] = None
    list_id: Optional[str] = None
    urutan: Optional[int] = None
    penerima_tugas_id: Optional[str] = None  # pindah/delegasi ke orang lain (boleh lintas divisi)


# ============ DIVISI (TIM) MODEL ============
class Divisi(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama: str
    warna: str = "#10b981"
    urutan: int = 0
    head_anggota_id: Optional[str] = None  # 1 head/leader per divisi (read-only monitoring)
    created_at: str = Field(default_factory=now_iso)


class DivisiCreate(BaseModel):
    nama: str
    warna: Optional[str] = "#10b981"


class SetHeadPayload(BaseModel):
    anggota_id: Optional[str] = None


class CommentPayload(BaseModel):
    text: str = Field(min_length=1)


# ============ KATEGORI (USER-MANAGED) MODEL ============
class Kategori(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama: str
    warna: str = "#8b5cf6"
    urutan: int = 0
    created_at: str = Field(default_factory=now_iso)


class KategoriCreate(BaseModel):
    nama: str
    warna: Optional[str] = "#8b5cf6"


# ============ ANGGOTA (MEMBER PER DIVISI) MODEL ============
class Anggota(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    divisi_id: str
    nama: str
    warna: str = "#0ea5e9"
    urutan: int = 0
    created_at: str = Field(default_factory=now_iso)


class AnggotaCreate(BaseModel):
    divisi_id: str
    nama: str
    warna: Optional[str] = "#0ea5e9"


class BulkIdsRequest(BaseModel):
    ids: List[str]


class BulkMoveRequest(BaseModel):
    ids: List[str]
    divisi_id: Optional[str] = None
    list_id: Optional[str] = None


class ReorderRequest(BaseModel):
    task_ids: List[str]


# ============ TASK LIST & LABEL MODELS ============
class TaskList(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama: str
    warna: str = "#10b981"
    urutan: int = 0
    is_done: bool = False
    divisi_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class TaskListCreate(BaseModel):
    nama: str
    warna: Optional[str] = "#10b981"
    is_done: Optional[bool] = False
    urutan: Optional[int] = None
    divisi_id: Optional[str] = None


class TaskLabel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama: str
    warna: str = "#f59e0b"
    created_at: str = Field(default_factory=now_iso)


class TaskLabelCreate(BaseModel):
    nama: str
    warna: Optional[str] = "#f59e0b"


class TodoEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str
    period: str  # YYYY-MM-DD (harian) | YYYY-Www (mingguan) | YYYY-MM (bulanan)
    checked: bool = True
    created_at: str = Field(default_factory=now_iso)


class TodoEntryCreate(BaseModel):
    task_id: str
    period: str
    checked: bool = True


# ============ AMALIYAH MODELS ============
class AmaliyahItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    nama: str
    target_metrik: str = "1x/hari"
    keterangan: Optional[str] = ""
    urutan: int = 0
    aktif: bool = True
    created_at: str = Field(default_factory=now_iso)


class AmaliyahItemCreate(BaseModel):
    nama: str
    target_metrik: str = "1x/hari"
    keterangan: Optional[str] = ""


class AmaliyahEntry(BaseModel):
    """Single check-in for an amaliyah on a specific date, scoped to a user."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    item_id: str
    tanggal: str  # YYYY-MM-DD
    checked: bool = True
    catatan: Optional[str] = ""
    user_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class AmaliyahEntryCreate(BaseModel):
    item_id: str
    tanggal: str
    checked: bool = True
    catatan: Optional[str] = ""


# ============ RAPORT MODELS ============
class RaportNote(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "singleton"
    catatan_spv: str = ""
    rekomendasi: str = "NETRAL"  # REWARD | EVALUASI | NETRAL
    updated_at: str = Field(default_factory=now_iso)


class RaportNoteUpdate(BaseModel):
    catatan_spv: str = ""
    rekomendasi: str = "NETRAL"


# ============ TASK ROUTES ============
@api_router.get("/")
async def root():
    return {"message": "Workspace Ruang Sanad API", "version": "1.2"}


# ============ RACI ============
RACI_FIELD = {"R": "penerima_tugas_id", "A": "pemberi_id", "C": "consulted_ids", "I": "informed_ids"}
# Field yang boleh diubah tiap peran (SPV boleh semua). Field lain dari form dibuang diam-diam.
FIELDS_A = {"nama", "kategori", "tanggal_mulai", "deadline", "label_ids", "brief_link", "catatan_tim",
            "penerima_tugas_id", "pemberi_id", "consulted_ids", "informed_ids", "kategori_id", "sasaran_id"}
FIELDS_R = {"status", "list_id", "urutan", "hasil_link", "hasil_catatan", "label_ids", "tanggal_mulai"}
# catatan_tim = "Instruksi" dari A; catatan R ada di hasil_catatan & komentar.


def _needs_review(task: dict) -> bool:
    """Tugas dari orang lain (R != A) wajib di-review A sebelum Selesai."""
    return bool(task.get("pemberi_id")) and task.get("pemberi_id") != task.get("penerima_tugas_id")


def _raci_roles(task: dict, my_ang: Optional[str]) -> set:
    if not my_ang:
        return set()
    roles = set()
    if task.get("penerima_tugas_id") == my_ang:
        roles.add("R")
    if task.get("pemberi_id") == my_ang:
        roles.add("A")
    if my_ang in (task.get("consulted_ids") or []):
        roles.add("C")
    if my_ang in (task.get("informed_ids") or []):
        roles.add("I")
    return roles


async def _clean_raci(data: dict, r_id: Optional[str], a_id: Optional[str]) -> None:
    """Validasi C/I: anggota harus ada, unik, dan bukan R/A tugas itu."""
    for key in ("consulted_ids", "informed_ids"):
        if key not in data or data[key] is None:
            continue
        ids = [i for i in dict.fromkeys(data[key]) if i and i not in (r_id, a_id)]
        if ids:
            found = await db.anggota.find({"id": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(len(ids))
            ok = {f["id"] for f in found}
            ids = [i for i in ids if i in ok]
        data[key] = ids
    if data.get("consulted_ids") and data.get("informed_ids"):
        data["informed_ids"] = [i for i in data["informed_ids"] if i not in data["consulted_ids"]]


async def _anggota_nama(ids) -> str:
    ids = [i for i in ids if i]
    if not ids:
        return "-"
    rows = await db.anggota.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "nama": 1}).to_list(len(ids))
    m = {r["id"]: r["nama"] for r in rows}
    return ", ".join(m.get(i, "?") for i in ids)


async def _log_raci_changes(task_id: str, user: dict, before: dict, after: dict) -> None:
    if after.get("penerima_tugas_id") != before.get("penerima_tugas_id") and "penerima_tugas_id" in after:
        await _log_activity(task_id, user, "raci", f"R (penanggung kerja) → {await _anggota_nama([after['penerima_tugas_id']])}")
    if after.get("pemberi_id") != before.get("pemberi_id") and "pemberi_id" in after:
        await _log_activity(task_id, user, "raci", f"A (penyetuju) → {await _anggota_nama([after['pemberi_id']])}")
    for key, label in (("consulted_ids", "C (dimintai masukan)"), ("informed_ids", "I (diberi info)")):
        if key in after:
            added = [i for i in after[key] if i not in (before.get(key) or [])]
            if added:
                await _log_activity(task_id, user, "raci", f"Ditambahkan sebagai {label}: {await _anggota_nama(added)}")


@api_router.get("/tasks", response_model=List[Task])
async def list_tasks(
    kategori: Optional[str] = None,
    status: Optional[str] = None,
    list_id: Optional[str] = None,
    label_id: Optional[str] = None,
    divisi_id: Optional[str] = None,
    archived: bool = False,
    search: Optional[str] = None,
    tipe: Optional[str] = None,
    peran: Optional[str] = None,  # R | A | C | I — tugas di mana saya memegang peran itu (lintas divisi)
    perlu_review: bool = False,  # tugas MENUNGGU_REVIEW di mana saya A (SPV: semua)
    user: dict = Depends(get_current_user),
):
    scope = await user_scope(user)
    if archived:
        q: dict = {"archived": True}
    else:
        q = {"archived": {"$ne": True}}
    if kategori:
        q["kategori"] = kategori
    if status:
        q["status"] = status
    if list_id:
        q["list_id"] = list_id
    if label_id:
        q["label_ids"] = label_id
    if search:
        q["nama"] = {"$regex": re.escape(search), "$options": "i"}
    if tipe == "PROJECT":
        q["kategori"] = "PROJECT"
    elif tipe == "RUTIN":
        q["kategori"] = {"$in": ["HARIAN", "MINGGUAN", "BULANAN"]}
    # Scope: anggota melihat tugas yang ditugaskan ke/dari dia (LINTAS divisi — delegasi),
    # plus tugas rutin di divisinya. JANGAN terapkan filter divisi_id top-level untuk anggota,
    # karena itu menyembunyikan tugas delegasi lintas divisi.
    if not scope["is_spv"]:
        my_ang = scope["anggota_id"]
        my_div = scope["divisi_id"]
        or_clauses = []
        if my_ang:
            or_clauses.append({"penerima_tugas_id": my_ang})
            or_clauses.append({"pemberi_id": my_ang})
            or_clauses.append({"consulted_ids": my_ang})
            or_clauses.append({"informed_ids": my_ang})
        if my_div:
            or_clauses.append({
                "kategori": {"$in": ["HARIAN", "MINGGUAN", "BULANAN"]},
                "divisi_id": my_div,
            })
        if not or_clauses:
            return []
        q["$or"] = or_clauses
    elif divisi_id and not peran:
        q["divisi_id"] = divisi_id
    if peran:
        field = RACI_FIELD.get(peran.upper())
        if not field:
            raise HTTPException(400, "peran harus R, A, C, atau I")
        if not scope["anggota_id"]:
            return []
        q[field] = scope["anggota_id"]
    if perlu_review:
        q["status"] = "MENUNGGU_REVIEW"
        q.pop("divisi_id", None)
        if not scope["is_spv"]:
            if not scope["anggota_id"]:
                return []
            q["pemberi_id"] = scope["anggota_id"]
    rows = await db.tasks.find(q, {"_id": 0}).sort([("urutan", 1), ("created_at", -1)]).to_list(3000)
    return rows


@api_router.post("/tasks", response_model=Task)
async def create_task(payload: TaskBase, user: dict = Depends(get_current_user)):
    """Buat tugas + tetapkan RACI sekaligus (tanpa langkah 'Pindahkan').
    R default = pembuat, A default = pembuat. Tugas tersimpan di divisi pembuat (kolom kanban pembuat)."""
    scope = await user_scope(user)
    data = payload.model_dump()
    me = scope["anggota_id"]
    r_id = data.get("penerima_tugas_id") or me
    a_id = data.get("pemberi_id") or me
    if not me and not scope["is_spv"]:
        raise HTTPException(403, "Akun Anda belum ditautkan ke anggota. Minta SPV menautkan akun Anda ke salah satu anggota agar bisa membuat tugas.")
    if not r_id:
        raise HTTPException(400, "Pilih R (penanggung kerja).")
    for aid in {r_id, a_id} - {None}:
        if not await db.anggota.find_one({"id": aid}, {"_id": 1}):
            raise HTTPException(400, "Anggota R/A tidak ditemukan.")
    if me:
        divisi_id = scope["divisi_id"]
    else:  # SPV tanpa tautan anggota: tugas masuk ke divisi R
        r_doc = await db.anggota.find_one({"id": r_id}, {"_id": 0, "divisi_id": 1})
        divisi_id = r_doc.get("divisi_id") if r_doc else None
    data.update({"penerima_tugas_id": r_id, "pemberi_id": a_id, "divisi_id": divisi_id, "pemberi_tugas": ""})
    await _clean_raci(data, r_id, a_id)
    if r_id != me:
        data["delegated_at"] = now_iso()
    # Kolom: harus milik divisi tugas, fallback kolom pertama (Backlog)
    lid = data.get("list_id")
    if lid and not await db.task_lists.find_one({"id": lid, "divisi_id": divisi_id}, {"_id": 1}):
        lid = None
    if not lid:
        first = await db.task_lists.find_one({"divisi_id": divisi_id, "is_done": {"$ne": True}}, {"_id": 0, "id": 1}, sort=[("urutan", 1)])
        lid = first["id"] if first else None
    data["list_id"] = lid
    data["status"] = "BELUM_MULAI"
    task = Task(**data)
    doc = task.model_dump()
    if data.get("delegated_at"):
        doc["delegated_at"] = data["delegated_at"]
    await db.tasks.insert_one(doc)
    await _log_activity(task.id, user, "create", f"Tugas dibuat · R: {await _anggota_nama([r_id])} · A: {await _anggota_nama([a_id])}")
    if data.get("consulted_ids") or data.get("informed_ids"):
        await _log_raci_changes(task.id, user, {}, {"consulted_ids": data.get("consulted_ids", []), "informed_ids": data.get("informed_ids", [])})
    return task


@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    return await _assert_task_access(task_id, user)


# ============ STATUS <-> KOLOM KANBAN (satu aturan, dipakai semua endpoint) ============
# Bucket kolom: "first" = kolom belum-selesai paling kiri, "done" = kolom is_done, "mid" = kolom lain.
def _status_bucket(status: Optional[str]) -> str:
    if status == "SELESAI":
        return "done"
    if status == "BELUM_MULAI":
        return "first"
    return "mid"  # DALAM_PROSES, MENUNGGU_REVIEW, REVISI, TERKENDALA


async def _divisi_lists(divisi_id: Optional[str]) -> List[dict]:
    if not divisi_id:
        return []
    return await db.task_lists.find({"divisi_id": divisi_id}, {"_id": 0}).sort("urutan", 1).to_list(100)


def _list_bucket(list_id: Optional[str], lists: List[dict]) -> Optional[str]:
    tl = next((l for l in lists if l["id"] == list_id), None)
    if not tl:
        return None
    if tl.get("is_done"):
        return "done"
    open_lists = [l for l in lists if not l.get("is_done")]
    return "first" if open_lists and open_lists[0]["id"] == list_id else "mid"


def _list_for_bucket(bucket: str, lists: List[dict]) -> Optional[str]:
    open_lists = [l for l in lists if not l.get("is_done")]
    done = [l for l in lists if l.get("is_done")]
    if bucket == "done":
        return done[0]["id"] if done else None
    if bucket == "first":
        return open_lists[0]["id"] if open_lists else None
    if len(open_lists) >= 2:
        return open_lists[1]["id"]
    return open_lists[0]["id"] if open_lists else None


async def _sync_status_list(task: dict, update: dict) -> None:
    """Kolom berubah -> status mengikuti kolom. Hanya status berubah -> pindah ke kolom yang sesuai."""
    list_changed = "list_id" in update and update["list_id"] != task.get("list_id")
    status_changed = "status" in update and update["status"] != task.get("status")
    if not list_changed and not status_changed:
        return
    lists = await _divisi_lists(update.get("divisi_id") or task.get("divisi_id"))
    if list_changed:
        b = _list_bucket(update["list_id"], lists)
        if b is None and update["list_id"]:
            tl = await db.task_lists.find_one({"id": update["list_id"]}, {"_id": 0})
            if tl:
                b = _list_bucket(tl["id"], await _divisi_lists(tl.get("divisi_id")))
        if b == "done":
            update["status"] = "SELESAI"
        elif b == "first":
            update["status"] = "BELUM_MULAI"
        elif b == "mid":
            new_status = update.get("status") or task.get("status")
            # REVISI / TERKENDALA tetap dipertahankan di kolom tengah
            update["status"] = new_status if new_status in ("DALAM_PROSES", "MENUNGGU_REVIEW", "REVISI", "TERKENDALA") else "DALAM_PROSES"
        return
    # hanya status yang berubah
    want = _status_bucket(update["status"])
    if _list_bucket(task.get("list_id"), lists) != want:
        target = _list_for_bucket(want, lists)
        if target:
            update["list_id"] = target


@api_router.put("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, payload: TaskUpdate, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    # penerima/pemberi boleh dikirim null secara eksplisit? Tidak: R & A wajib ada.
    if not scope["is_spv"]:
        roles = _raci_roles(task, scope["anggota_id"])
        allowed = set()
        if "A" in roles:
            allowed |= FIELDS_A
        if "R" in roles:
            allowed |= FIELDS_R
        if not allowed:
            raise HTTPException(403, "Peran Anda di tugas ini Consulted/Informed — hanya bisa melihat" + (" dan berkomentar." if "C" in roles else "."))
        # Form mengirim semua field; buang diam-diam field di luar wewenang peran.
        update = {k: v for k, v in update.items() if k in allowed}
    if "sasaran_id" in update:
        if update["sasaran_id"] in ("", "none"):
            update["sasaran_id"] = None
        elif not await db.sasaran.find_one({"id": update["sasaran_id"]}, {"_id": 1}):
            raise HTTPException(400, "Sasaran tidak ditemukan.")
    for k in ("penerima_tugas_id", "pemberi_id"):
        if k in update and not await db.anggota.find_one({"id": update[k]}, {"_id": 1}):
            raise HTTPException(400, "Anggota R/A tidak ditemukan.")
    if "consulted_ids" in update or "informed_ids" in update or "penerima_tugas_id" in update or "pemberi_id" in update:
        r_id = update.get("penerima_tugas_id", task.get("penerima_tugas_id"))
        a_id = update.get("pemberi_id", task.get("pemberi_id"))
        update.setdefault("consulted_ids", task.get("consulted_ids") or [])
        update.setdefault("informed_ids", task.get("informed_ids") or [])
        await _clean_raci(update, r_id, a_id)
    if update.get("penerima_tugas_id") and update["penerima_tugas_id"] != task.get("penerima_tugas_id"):
        update["delegated_at"] = now_iso()
        update["moved_at"] = now_iso()
    if update.get("hasil_link") is not None and update.get("hasil_link") != (task.get("hasil_link") or ""):
        await _log_activity(task_id, user, "hasil", "Link hasil diperbarui")
    await _sync_status_list(task, update)
    submitted_review = False
    if not scope["is_spv"] and update.get("status") == "SELESAI" and task.get("status") != "SELESAI" \
            and _needs_review({**task, **update}) and "A" not in _raci_roles(task, scope["anggota_id"]):
        # R menandai selesai / menyeret ke kolom Selesai -> otomatis dikirim untuk review A
        update["status"] = "MENUNGGU_REVIEW"
        mid = _list_for_bucket("mid", await _divisi_lists(task.get("divisi_id")))
        if mid:
            update["list_id"] = mid
        submitted_review = True
    update["updated_at"] = now_iso()
    result = await db.tasks.find_one_and_update(
        {"id": task_id},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Task not found")
    if submitted_review:
        await _log_activity(task_id, user, "review", "Dikirim untuk review A")
    elif "status" in update and update["status"] != task.get("status"):
        await _log_activity(task_id, user, "status", f"Status diubah menjadi {update['status']}")
    await _log_raci_changes(task_id, user, task, update)
    return result


async def _set_status(task: dict, status: str, extra: Optional[dict] = None) -> dict:
    lists = await _divisi_lists(task.get("divisi_id"))
    upd = {"status": status, "updated_at": now_iso(), **(extra or {})}
    target = _list_for_bucket(_status_bucket(status), lists)
    if target:
        upd["list_id"] = target
    return await db.tasks.find_one_and_update({"id": task["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})


@api_router.post("/tasks/{task_id}/submit_review", response_model=Task)
async def submit_review(task_id: str, user: dict = Depends(get_current_user)):
    """R mengirim hasil ke A untuk disetujui."""
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    if not scope["is_spv"] and "R" not in _raci_roles(task, scope["anggota_id"]):
        raise HTTPException(403, "Hanya R (yang mengerjakan) yang dapat mengirim untuk review.")
    if task.get("status") == "SELESAI":
        raise HTTPException(400, "Tugas sudah selesai.")
    if not (task.get("hasil_link") or task.get("hasil_catatan")):
        raise HTTPException(400, "Isi Link Hasil atau Catatan Hasil dulu sebelum mengirim untuk review.")
    result = await _set_status(task, "MENUNGGU_REVIEW", {"review_at": now_iso()})
    await _log_activity(task_id, user, "review", "Dikirim untuk review A")
    return result


@api_router.post("/tasks/{task_id}/approve", response_model=Task)
async def approve_task(task_id: str, user: dict = Depends(get_current_user)):
    """A (atau SPV) menyetujui hasil -> SELESAI."""
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    if not scope["is_spv"] and "A" not in _raci_roles(task, scope["anggota_id"]):
        raise HTTPException(403, "Hanya A (penyetuju) atau SPV yang dapat menyetujui hasil.")
    if task.get("status") == "SELESAI":
        raise HTTPException(400, "Tugas sudah selesai.")
    result = await _set_status(task, "SELESAI", {"approved_at": now_iso()})
    await _log_activity(task_id, user, "approve", "Hasil disetujui — tugas Selesai")
    return result


class RevisiPayload(BaseModel):
    catatan: str = Field(min_length=1)


@api_router.post("/tasks/{task_id}/revisi", response_model=Task)
async def revisi_task(task_id: str, payload: RevisiPayload, user: dict = Depends(get_current_user)):
    """Pemberi tugas (atau SPV) meminta revisi: set status=REVISI + catatan untuk penerima."""
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    if not scope["is_spv"]:
        my_ang = scope["anggota_id"]
        if not my_ang or task.get("pemberi_id") != my_ang:
            raise HTTPException(403, "Hanya A (penyetuju) yang dapat meminta revisi.")
    mid_list = _list_for_bucket("mid", await _divisi_lists(task.get("divisi_id")))
    result = await db.tasks.find_one_and_update(
        {"id": task_id},
        {
            "$set": {"status": "REVISI", "revisi_catatan": payload.catatan, "revisi_at": now_iso(), "updated_at": now_iso(),
                     **({"list_id": mid_list} if mid_list else {})},
            "$inc": {"revisi_count": 1},
        },
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Task not found")
    await _log_activity(task_id, user, "revisi", f"Revisi diminta: {payload.catatan}")
    return result


@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    if not _can_manage_task(task, await user_scope(user), "delete"):
        raise HTTPException(403, "Hanya SPV atau pembuat tugas (yang juga penerimanya) yang dapat menghapus tugas ini. Gunakan Arsip.")
    r = await db.tasks.delete_one({"id": task_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Task not found")
    await db.todo_entries.delete_many({"task_id": task_id})
    await db.task_activity.delete_many({"task_id": task_id})
    return {"ok": True}


@api_router.post("/tasks/{task_id}/archive", response_model=Task)
async def archive_task(task_id: str, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    if not _can_manage_task(task, await user_scope(user), "archive"):
        raise HTTPException(403, "Hanya SPV atau penerima tugas yang dapat mengubah arsip tugas ini.")
    result = await db.tasks.find_one_and_update(
        {"id": task_id},
        {"$set": {"archived": True, "archived_at": now_iso(), "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Task not found")
    return result


@api_router.post("/tasks/{task_id}/unarchive", response_model=Task)
async def unarchive_task(task_id: str, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    if not _can_manage_task(task, await user_scope(user), "archive"):
        raise HTTPException(403, "Hanya SPV atau penerima tugas yang dapat mengubah arsip tugas ini.")
    result = await db.tasks.find_one_and_update(
        {"id": task_id},
        {"$set": {"archived": False, "archived_at": None, "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Task not found")
    return result


@api_router.post("/tasks/{task_id}/move", response_model=Task)
async def move_task(task_id: str, payload: MoveTaskPayload, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    if not scope["is_spv"] and payload.divisi_id and payload.divisi_id != scope["divisi_id"] and payload.divisi_id != task.get("divisi_id"):
        raise HTTPException(403, "Anggota tidak dapat memindahkan tugas ke tim lain.")
    # Pindah ke perorangan (reassign penerima) — boleh lintas divisi.
    # Hanya SPV, pemberi, atau penerima saat ini yang boleh.
    if payload.penerima_tugas_id is not None and payload.penerima_tugas_id != task.get("penerima_tugas_id"):
        my_ang = scope["anggota_id"]
        if not scope["is_spv"] and my_ang not in (task.get("pemberi_id"), task.get("penerima_tugas_id")):
            raise HTTPException(403, "Hanya pemberi/penerima tugas atau SPV yang bisa memindahkan ke orang lain.")
    update: dict = {"updated_at": now_iso()}
    if payload.penerima_tugas_id is not None and payload.penerima_tugas_id != task.get("penerima_tugas_id"):
        update["penerima_tugas_id"] = payload.penerima_tugas_id
        update["moved_at"] = now_iso()
        update["delegated_at"] = now_iso()  # dipakai notifikasi "tugas masuk"
        if not task.get("pemberi_id") and scope["anggota_id"] and scope["anggota_id"] != payload.penerima_tugas_id:
            update["pemberi_id"] = scope["anggota_id"]  # data lama tanpa pemberi: yang menugaskan = pemberi
    if payload.divisi_id is not None:
        update["divisi_id"] = payload.divisi_id
        if payload.divisi_id != task.get("divisi_id"):
            update["moved_at"] = now_iso()
    if payload.list_id is not None:
        update["list_id"] = payload.list_id
        await _sync_status_list(task, update)
    if payload.urutan is not None:
        update["urutan"] = payload.urutan
        target_divisi = update.get("divisi_id", task.get("divisi_id"))
        target_list = update.get("list_id", task.get("list_id"))
        await db.tasks.update_many(
            {
                "id": {"$ne": task_id},
                "divisi_id": target_divisi,
                "list_id": target_list,
                "urutan": {"$gte": payload.urutan},
            },
            {"$inc": {"urutan": 1}},
        )
    result = await db.tasks.find_one_and_update(
        {"id": task_id}, {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    if payload.penerima_tugas_id is not None and payload.penerima_tugas_id != task.get("penerima_tugas_id"):
        newp = await db.anggota.find_one({"id": payload.penerima_tugas_id}, {"_id": 0, "nama": 1})
        await _log_activity(task_id, user, "move", f"Tugas dipindahkan ke {newp.get('nama') if newp else 'anggota lain'}")
    elif payload.divisi_id is not None and payload.divisi_id != task.get("divisi_id"):
        newd = await db.divisi.find_one({"id": payload.divisi_id}, {"_id": 0, "nama": 1})
        await _log_activity(task_id, user, "move", f"Tugas dipindahkan ke tim {newd.get('nama') if newd else '-'}")
    return result


class BulkDeleteRequest(BaseModel):
    ids: List[str]


@api_router.post("/tasks/bulk_delete")
async def bulk_delete_tasks(payload: BulkDeleteRequest, user: dict = Depends(get_current_user)):
    if not payload.ids:
        return {"ok": True, "deleted": 0}
    await _assert_bulk_task_access(payload.ids, user)
    await _assert_bulk_manage(payload.ids, user, "delete")
    r = await db.tasks.delete_many({"id": {"$in": payload.ids}})
    await db.todo_entries.delete_many({"task_id": {"$in": payload.ids}})
    await db.task_activity.delete_many({"task_id": {"$in": payload.ids}})
    return {"ok": True, "deleted": r.deleted_count}


@api_router.post("/tasks/bulk_archive")
async def bulk_archive_tasks(payload: BulkIdsRequest, user: dict = Depends(get_current_user)):
    if not payload.ids:
        return {"ok": True, "archived": 0}
    await _assert_bulk_task_access(payload.ids, user)
    await _assert_bulk_manage(payload.ids, user, "archive")
    r = await db.tasks.update_many(
        {"id": {"$in": payload.ids}},
        {"$set": {"archived": True, "archived_at": now_iso(), "updated_at": now_iso()}},
    )
    return {"ok": True, "archived": r.modified_count}


@api_router.post("/tasks/bulk_unarchive")
async def bulk_unarchive_tasks(payload: BulkIdsRequest, user: dict = Depends(get_current_user)):
    if not payload.ids:
        return {"ok": True, "unarchived": 0}
    await _assert_bulk_task_access(payload.ids, user)
    await _assert_bulk_manage(payload.ids, user, "archive")
    r = await db.tasks.update_many(
        {"id": {"$in": payload.ids}},
        {"$set": {"archived": False, "archived_at": None, "updated_at": now_iso()}},
    )
    return {"ok": True, "unarchived": r.modified_count}


@api_router.post("/tasks/bulk_move")
async def bulk_move_tasks(payload: BulkMoveRequest, user: dict = Depends(get_current_user)):
    if not payload.ids:
        return {"ok": True, "moved": 0}
    scope = await user_scope(user)
    if not scope["is_spv"]:
        raise HTTPException(403, "Hanya SPV yang bisa memindahkan tugas antar tim.")
    update: dict = {"updated_at": now_iso()}
    if payload.divisi_id is not None:
        update["divisi_id"] = payload.divisi_id
        update["moved_at"] = now_iso()
    if payload.list_id is not None:
        update["list_id"] = payload.list_id
    r = await db.tasks.update_many({"id": {"$in": payload.ids}}, {"$set": update})
    return {"ok": True, "moved": r.modified_count}


@api_router.get("/task_unread")
async def unread_tasks(user: dict = Depends(get_current_user)):
    # Status "sudah dilihat" disimpan PER USER (dulu moved_at di-null-kan untuk semua orang).
    scope = await user_scope(user)
    q: dict = {"moved_at": {"$ne": None}, "archived": {"$ne": True}}
    if not scope["is_spv"]:
        if not scope["divisi_id"]:
            return {"total": 0, "by_divisi": {}}
        q["divisi_id"] = scope["divisi_id"]
    seen_doc = await db.user_task_seen.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    moved_seen = seen_doc.get("moved_seen") or {}
    rows = await db.tasks.find(q, {"_id": 0, "id": 1, "divisi_id": 1, "moved_at": 1}).to_list(3000)
    by_divisi: dict = {}
    total = 0
    for r in rows:
        d = r.get("divisi_id") or "none"
        last = max(moved_seen.get(d, ""), moved_seen.get("_all", ""))
        if r["moved_at"] <= last:
            continue
        by_divisi[d] = by_divisi.get(d, 0) + 1
        total += 1
    return {"total": total, "by_divisi": by_divisi}


# ============ NOTIFICATIONS (TUGAS MASUK DARI TIM LAIN) ============
def _delegated_after(ts: str) -> dict:
    """Waktu delegasi = delegated_at (diisi saat Pindahkan ke orang), fallback created_at untuk data lama."""
    return {"$or": [
        {"delegated_at": {"$gt": ts}},
        {"delegated_at": {"$in": [None]}, "created_at": {"$gt": ts}},
    ]}


@api_router.get("/notifications/incoming")
async def incoming_notifications(user: dict = Depends(get_current_user)):
    """Tugas yang didelegasikan KE saya oleh orang lain, sejak terakhir dilihat."""
    scope = await user_scope(user)
    if not scope["anggota_id"]:
        return {"count": 0, "items": []}
    seen = await db.user_task_seen.find_one({"user_id": scope["user_id"]}, {"_id": 0})
    q: dict = {
        "penerima_tugas_id": scope["anggota_id"],
        "pemberi_id": {"$nin": [None, scope["anggota_id"]]},
        "archived": {"$ne": True},
    }
    if seen and seen.get("last_seen_at"):
        q.update(_delegated_after(seen["last_seen_at"]))
    rows = await db.tasks.find(
        q, {"_id": 0, "id": 1, "nama": 1, "pemberi_id": 1, "divisi_id": 1, "created_at": 1, "status": 1}
    ).sort("created_at", -1).to_list(50)
    pemberi_ids = [pid for pid in {r.get("pemberi_id") for r in rows} if pid]
    divisi_ids = [did for did in {r.get("divisi_id") for r in rows} if did]
    anggota_rows = await db.anggota.find({"id": {"$in": pemberi_ids}}, {"_id": 0, "id": 1, "nama": 1}).to_list(200) if pemberi_ids else []
    divisi_rows = await db.divisi.find({"id": {"$in": divisi_ids}}, {"_id": 0, "id": 1, "nama": 1}).to_list(200) if divisi_ids else []
    amap = {a["id"]: a["nama"] for a in anggota_rows}
    dmap = {d["id"]: d["nama"] for d in divisi_rows}
    items = [{**r, "pemberi_nama": amap.get(r.get("pemberi_id"), ""), "divisi_nama": dmap.get(r.get("divisi_id"), "")} for r in rows]
    return {"count": len(items), "items": items}


@api_router.post("/notifications/mark_seen")
async def mark_notifications_seen(user: dict = Depends(get_current_user)):
    await db.user_task_seen.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"last_seen_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/task_mark_seen")
async def mark_seen_tasks(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    key = divisi_id or "_all"
    if not scope["is_spv"]:
        if not scope["divisi_id"]:
            return {"ok": True, "cleared": 0}
        key = scope["divisi_id"]
    await db.user_task_seen.update_one(
        {"user_id": user["user_id"]}, {"$set": {f"moved_seen.{key}": now_iso()}}, upsert=True)
    return {"ok": True, "cleared": 1}


@api_router.post("/tasks/reorder")
async def reorder_tasks(payload: ReorderRequest, user: dict = Depends(get_current_user)):
    await _assert_bulk_task_access(payload.task_ids, user)
    for i, tid in enumerate(payload.task_ids):
        await db.tasks.update_one({"id": tid}, {"$set": {"urutan": i}})
    return {"ok": True, "reordered": len(payload.task_ids)}


# ============ CURRENT USER SCOPE (role/head info for frontend) ============
@api_router.get("/me/scope")
async def my_scope(user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    head_nama = None
    if scope["head_divisi_id"]:
        d = await db.divisi.find_one({"id": scope["head_divisi_id"]}, {"_id": 0, "nama": 1})
        head_nama = d.get("nama") if d else None
    return {**scope, "head_divisi_nama": head_nama, "role": user.get("role"),
            "can_monitor": scope["is_spv"] or scope["is_head"]}


# ============ NOTIFICATION FEED (delegasi + reminder deadline + approval) ============
@api_router.get("/notifications/feed")
async def notifications_feed(user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    ang_rows = await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)
    amap = {a["id"]: a["nama"] for a in ang_rows}
    div_rows = await db.divisi.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(200)
    dmap = {d["id"]: d["nama"] for d in div_rows}

    # 1. Delegasi baru ke saya (belum dilihat)
    delegated = []
    if scope["anggota_id"]:
        seen = await db.user_task_seen.find_one({"user_id": scope["user_id"]}, {"_id": 0})
        q = {"penerima_tugas_id": scope["anggota_id"], "pemberi_id": {"$nin": [None, scope["anggota_id"]]}, "archived": {"$ne": True}}
        if seen and seen.get("last_seen_at"):
            q.update(_delegated_after(seen["last_seen_at"]))
        rows = await db.tasks.find(q, {"_id": 0, "id": 1, "nama": 1, "pemberi_id": 1, "divisi_id": 1}).sort("created_at", -1).to_list(50)
        delegated = [{"id": r["id"], "nama": r["nama"], "pemberi_nama": amap.get(r.get("pemberi_id"), "SPV"),
                      "divisi_nama": dmap.get(r.get("divisi_id"), "")} for r in rows]

    # 2. Reminder deadline (H-1, hari-ini, overdue) — scoped by role
    base = {"archived": {"$ne": True}, "status": {"$ne": "SELESAI"}, "deadline": {"$ne": None, "$lte": tomorrow}}
    scoped_ok = True
    if scope["is_spv"]:
        pass
    elif scope["head_divisi_id"]:
        base["divisi_id"] = scope["head_divisi_id"]
    elif scope["anggota_id"]:
        base["penerima_tugas_id"] = scope["anggota_id"]
    else:
        scoped_ok = False
    reminders = []
    if scoped_ok:
        rrows = await db.tasks.find(base, {"_id": 0, "id": 1, "nama": 1, "deadline": 1, "penerima_tugas_id": 1, "divisi_id": 1}).sort("deadline", 1).to_list(100)
        for r in rrows:
            dl = r.get("deadline")
            urg = "overdue" if dl < today else ("today" if dl == today else "besok")
            reminders.append({"id": r["id"], "nama": r["nama"], "deadline": dl, "urgensi": urg,
                              "penerima_nama": amap.get(r.get("penerima_tugas_id"), "-"), "divisi_nama": dmap.get(r.get("divisi_id"), "")})

    # 3. Aktivitas pada tugas di mana saya A / C / I (oleh orang lain, sejak terakhir dilihat)
    aktivitas = []
    if scope["anggota_id"]:
        me = scope["anggota_id"]
        seen2 = await db.user_task_seen.find_one({"user_id": scope["user_id"]}, {"_id": 0}) or {}
        since = seen2.get("last_seen_at") or (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        my_tasks = await db.tasks.find(
            {"archived": {"$ne": True}, "$or": [{"pemberi_id": me}, {"penerima_tugas_id": me}, {"consulted_ids": me}, {"informed_ids": me}]},
            {"_id": 0, "id": 1, "nama": 1, "pemberi_id": 1, "penerima_tugas_id": 1, "consulted_ids": 1, "informed_ids": 1}).to_list(500)
        tmap = {t["id"]: t for t in my_tasks}
        if tmap:
            acts = await db.task_activity.find(
                {"task_id": {"$in": list(tmap)}, "created_at": {"$gt": since}, "user_id": {"$ne": scope["user_id"]},
                 "kind": {"$in": ["status", "revisi", "hasil", "raci", "comment", "move", "review", "approve"]}},
                {"_id": 0}).sort("created_at", -1).to_list(30)
            for a in acts:
                t = tmap[a["task_id"]]
                roles = _raci_roles(t, me)
                if roles == {"R"} and a["kind"] not in ("approve", "revisi", "comment"):
                    continue  # R cukup diberi kabar saat disetujui / diminta revisi / dikomentari
                if a["kind"] == "comment" and not roles & {"A", "C", "R"}:
                    continue  # Informed tidak perlu notifikasi komentar
                aktivitas.append({"id": a["id"], "task_id": t["id"], "nama": t["nama"], "kind": a["kind"], "text": a.get("text", ""),
                                  "actor_name": a.get("actor_name"), "peran": "".join(sorted(roles)), "created_at": a["created_at"]})

    # 4. Approval user baru (SPV)
    approvals = 0
    if scope["is_spv"]:
        approvals = await db.users.count_documents({"status": "pending"})

    urgent = sum(1 for r in reminders if r["urgensi"] in ("overdue", "today"))
    perlu_review = 0
    if scope["is_spv"]:
        perlu_review = await db.tasks.count_documents({"status": "MENUNGGU_REVIEW", "archived": {"$ne": True}})
    elif scope["anggota_id"]:
        perlu_review = await db.tasks.count_documents({"status": "MENUNGGU_REVIEW", "archived": {"$ne": True}, "pemberi_id": scope["anggota_id"]})
    checkin_perlu = []
    if scope["anggota_id"]:
        ap = await db.strategy_periods.find_one({"active": True}, {"_id": 0, "id": 1})
        if ap:
            batas = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            rows = await db.ukuran.find({"period_id": ap["id"], "pic_id": scope["anggota_id"],
                                         "$or": [{"last_checkin_at": None}, {"last_checkin_at": {"$lt": batas}}]},
                                        {"_id": 0, "id": 1, "nama": 1, "last_checkin_at": 1}).to_list(50)
            checkin_perlu = rows
    count = len(delegated) + urgent + approvals + len(aktivitas) + len(checkin_perlu)
    role = "spv" if scope["is_spv"] else ("head" if scope["head_divisi_id"] else "anggota")
    return {"count": count, "delegated": delegated, "reminders": reminders, "approvals": approvals, "role": role,
            "aktivitas": aktivitas, "perlu_review": perlu_review, "checkin_perlu": checkin_perlu}


# ============ TASK ACTIVITY & COMMENTS ============
@api_router.get("/tasks/{task_id}/activity")
async def task_activity(task_id: str, user: dict = Depends(get_current_user)):
    await _assert_task_access(task_id, user)
    rows = await db.task_activity.find({"task_id": task_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return rows


@api_router.post("/tasks/{task_id}/comment")
async def add_comment(task_id: str, payload: CommentPayload, user: dict = Depends(get_current_user)):
    task = await _assert_task_access(task_id, user)
    scope = await user_scope(user)
    if not scope["is_spv"]:
        roles = _raci_roles(task, scope["anggota_id"])
        if not roles & {"R", "A", "C"} and not (task.get("kategori") in RUTIN_KATEGORI_SET and task.get("divisi_id") == scope["divisi_id"]):
            raise HTTPException(403, "Peran Informed hanya bisa melihat, tidak bisa berkomentar.")
    await _log_activity(task_id, user, "comment", payload.text.strip())
    return {"ok": True}


# ============ KATEGORI ROUTES ============
@api_router.get("/kategori", response_model=List[Kategori])
async def list_kategori():
    rows = await db.kategori.find({}, {"_id": 0}).sort("urutan", 1).to_list(500)
    return rows


@api_router.post("/kategori", response_model=Kategori)
async def create_kategori(payload: KategoriCreate, _: dict = Depends(require_spv)):
    count = await db.kategori.count_documents({})
    item = Kategori(**payload.model_dump(), urutan=count + 1)
    await db.kategori.insert_one(item.model_dump())
    return item


@api_router.put("/kategori/{kategori_id}", response_model=Kategori)
async def update_kategori(kategori_id: str, payload: KategoriCreate, _: dict = Depends(require_spv)):
    result = await db.kategori.find_one_and_update(
        {"id": kategori_id}, {"$set": payload.model_dump()},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Kategori not found")
    return result


@api_router.delete("/kategori/{kategori_id}")
async def delete_kategori(kategori_id: str, _: dict = Depends(require_spv)):
    r = await db.kategori.delete_one({"id": kategori_id})
    await db.tasks.update_many({"kategori_id": kategori_id}, {"$set": {"kategori_id": None}})
    return {"ok": True, "deleted": r.deleted_count}


# ============ ANGGOTA ROUTES ============
@api_router.get("/anggota", response_model=List[Anggota])
async def list_anggota(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    q: dict = {}
    if divisi_id:
        q["divisi_id"] = divisi_id
    # Semua user (termasuk anggota) melihat daftar anggota SEMUA divisi —
    # dibutuhkan untuk delegasi lintas divisi (picker penerima tugas). Read-only nama.
    rows = await db.anggota.find(q, {"_id": 0}).sort("urutan", 1).to_list(1000)
    return rows


@api_router.post("/anggota", response_model=Anggota)
async def create_anggota(payload: AnggotaCreate, _: dict = Depends(require_spv)):
    count = await db.anggota.count_documents({"divisi_id": payload.divisi_id})
    item = Anggota(**payload.model_dump(), urutan=count + 1)
    await db.anggota.insert_one(item.model_dump())
    return item


@api_router.get("/anggota/analytics")
async def anggota_analytics(divisi_id: str, month: Optional[str] = None, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    if not scope["is_spv"]:
        if not scope["divisi_id"] or scope["divisi_id"] != divisi_id:
            raise HTTPException(403, "Analytics tim lain tidak dapat diakses.")
    if not month:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
    year, mm = map(int, month.split("-"))
    nxt = f"{year+1}-01" if mm == 12 else f"{year}-{str(mm+1).zfill(2)}"
    start_iso = f"{month}-01T00:00:00"
    end_iso = f"{nxt}-01T00:00:00"

    anggota = await db.anggota.find({"divisi_id": divisi_id}, {"_id": 0}).sort("urutan", 1).to_list(500)
    result = []
    for a in anggota:
        base = {"divisi_id": divisi_id, "penerima_tugas_id": a["id"], "created_at": {"$gte": start_iso, "$lt": end_iso}}
        total = await db.tasks.count_documents(base)
        selesai = await db.tasks.count_documents({**base, "status": "SELESAI"})
        terkendala = await db.tasks.count_documents({**base, "status": "TERKENDALA"})
        result.append({**a, "total": total, "selesai": selesai, "terkendala": terkendala})
    result.sort(key=lambda x: x["selesai"], reverse=True)
    return {"month": month, "anggota": result}


@api_router.get("/anggota/{anggota_id}")
async def get_anggota(anggota_id: str):
    doc = await db.anggota.find_one({"id": anggota_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Anggota not found")
    return doc


@api_router.put("/anggota/{anggota_id}", response_model=Anggota)
async def update_anggota(anggota_id: str, payload: AnggotaCreate, _: dict = Depends(require_spv)):
    result = await db.anggota.find_one_and_update(
        {"id": anggota_id}, {"$set": payload.model_dump()},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Anggota not found")
    return result


@api_router.delete("/anggota/{anggota_id}")
async def delete_anggota(anggota_id: str, _: dict = Depends(require_spv)):
    r = await db.anggota.delete_one({"id": anggota_id})
    await db.tasks.update_many({"penerima_tugas_id": anggota_id}, {"$set": {"penerima_tugas_id": None}})
    return {"ok": True, "deleted": r.deleted_count}


# ============ DIVISI (TIM/WORKSPACE) ROUTES ============
@api_router.get("/divisi", response_model=List[Divisi])
async def list_divisi(user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    rows = await db.divisi.find({}, {"_id": 0}).sort("urutan", 1).to_list(200)
    if not rows:
        # Auto-migrate from existing tasks.divisi string values
        unique = await db.tasks.distinct("divisi")
        names = [n for n in unique if n and isinstance(n, str)]
        if not names:
            names = ["Umum"]
        created: list = []
        for i, name in enumerate(names):
            d = Divisi(nama=name, urutan=i + 1)
            await db.divisi.insert_one(d.model_dump())
            created.append(d)
            await db.tasks.update_many(
                {"divisi": name, "divisi_id": {"$exists": False}},
                {"$set": {"divisi_id": d.id}},
            )
        first_id = created[0].id
        # Existing lists without divisi_id → assign to first divisi
        await db.task_lists.update_many(
            {"divisi_id": {"$exists": False}}, {"$set": {"divisi_id": first_id}}
        )
        await db.task_lists.update_many(
            {"divisi_id": None}, {"$set": {"divisi_id": first_id}}
        )
        # Seed default lists for other divisi that have none
        for d in created[1:]:
            count = await db.task_lists.count_documents({"divisi_id": d.id})
            if count == 0:
                defaults = [
                    {"nama": "Backlog", "warna": "#94a3b8", "urutan": 1, "is_done": False},
                    {"nama": "Dikerjakan", "warna": "#f59e0b", "urutan": 2, "is_done": False},
                    {"nama": "Selesai", "warna": "#10b981", "urutan": 3, "is_done": True},
                ]
                for x in defaults:
                    tl = TaskList(**x, divisi_id=d.id)
                    await db.task_lists.insert_one(tl.model_dump())
        rows = await db.divisi.find({}, {"_id": 0}).sort("urutan", 1).to_list(200)
    # Semua user melihat semua divisi (read-only nama) — dibutuhkan untuk picker delegasi.
    # Frontend membatasi TAB workspace anggota ke divisinya sendiri.
    return rows


@api_router.post("/divisi", response_model=Divisi)
async def create_divisi(payload: DivisiCreate, _: dict = Depends(require_spv)):
    count = await db.divisi.count_documents({})
    item = Divisi(**payload.model_dump(), urutan=count + 1)
    await db.divisi.insert_one(item.model_dump())
    defaults = [
        {"nama": "Backlog", "warna": "#94a3b8", "urutan": 1, "is_done": False},
        {"nama": "Dikerjakan", "warna": "#f59e0b", "urutan": 2, "is_done": False},
        {"nama": "Selesai", "warna": "#10b981", "urutan": 3, "is_done": True},
    ]
    for d in defaults:
        tl = TaskList(**d, divisi_id=item.id)
        await db.task_lists.insert_one(tl.model_dump())
    return item


@api_router.put("/divisi/{divisi_id}", response_model=Divisi)
async def update_divisi(divisi_id: str, payload: DivisiCreate, _: dict = Depends(require_spv)):
    result = await db.divisi.find_one_and_update(
        {"id": divisi_id}, {"$set": payload.model_dump(exclude_unset=True)},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Divisi not found")
    return result


@api_router.put("/divisi/{divisi_id}/head")
async def set_divisi_head(divisi_id: str, payload: SetHeadPayload, _: dict = Depends(require_spv)):
    d = await db.divisi.find_one({"id": divisi_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Divisi tidak ditemukan.")
    if payload.anggota_id:
        a = await db.anggota.find_one({"id": payload.anggota_id}, {"_id": 0})
        if not a or a.get("divisi_id") != divisi_id:
            raise HTTPException(400, "Head harus anggota dari divisi ini.")
    await db.divisi.update_one({"id": divisi_id}, {"$set": {"head_anggota_id": payload.anggota_id}})
    return {"ok": True, "divisi_id": divisi_id, "head_anggota_id": payload.anggota_id}


@api_router.delete("/divisi/{divisi_id}")
async def delete_divisi(divisi_id: str, _: dict = Depends(require_spv)):
    remaining = await db.divisi.find(
        {"id": {"$ne": divisi_id}}, {"_id": 0}
    ).sort("urutan", 1).to_list(1)
    if not remaining:
        raise HTTPException(400, "Tidak bisa hapus satu-satunya divisi")
    target = remaining[0]["id"]
    await db.tasks.update_many({"divisi_id": divisi_id}, {"$set": {"divisi_id": target}})
    await db.task_lists.delete_many({"divisi_id": divisi_id})
    r = await db.divisi.delete_one({"id": divisi_id})
    return {"ok": True, "deleted": r.deleted_count}


# ============ TASK LISTS ROUTES ============
@api_router.get("/task_lists", response_model=List[TaskList])
async def list_task_lists(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    if not scope["is_spv"]:
        if scope["divisi_id"]:
            divisi_id = scope["divisi_id"]
        else:
            return []
    q: dict = {}
    if divisi_id:
        q["divisi_id"] = divisi_id
    rows = await db.task_lists.find(q, {"_id": 0}).sort("urutan", 1).to_list(500)
    if not rows and divisi_id:
        defaults = [
            {"nama": "Backlog", "warna": "#94a3b8", "urutan": 1, "is_done": False},
            {"nama": "Dikerjakan", "warna": "#f59e0b", "urutan": 2, "is_done": False},
            {"nama": "Selesai", "warna": "#10b981", "urutan": 3, "is_done": True},
        ]
        for d in defaults:
            item = TaskList(**d, divisi_id=divisi_id)
            await db.task_lists.insert_one(item.model_dump())
        rows = await db.task_lists.find(q, {"_id": 0}).sort("urutan", 1).to_list(500)
    return rows


@api_router.post("/task_lists", response_model=TaskList)
async def create_task_list(payload: TaskListCreate, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    scope = await user_scope(user)
    if not scope["is_spv"]:
        if not scope["divisi_id"]:
            raise HTTPException(403, "Akun belum terhubung ke tim.")
        data["divisi_id"] = scope["divisi_id"]  # anggota hanya boleh menambah kolom di timnya sendiri
    if not data.get("divisi_id"):
        first = await db.divisi.find_one({}, {"_id": 0}, sort=[("urutan", 1)])
        if first:
            data["divisi_id"] = first["id"]
    count = await db.task_lists.count_documents({"divisi_id": data.get("divisi_id")})
    if data.get("urutan") is None:
        data["urutan"] = count + 1
    item = TaskList(**data)
    await db.task_lists.insert_one(item.model_dump())
    return item


@api_router.put("/task_lists/{list_id}", response_model=TaskList)
async def update_task_list(list_id: str, payload: TaskListCreate, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    if not scope["is_spv"]:
        tl = await db.task_lists.find_one({"id": list_id}, {"_id": 0, "divisi_id": 1})
        if not tl or not scope["divisi_id"] or tl.get("divisi_id") != scope["divisi_id"]:
            raise HTTPException(403, "Kolom ini milik tim lain.")
        if payload.divisi_id and payload.divisi_id != scope["divisi_id"]:
            raise HTTPException(403, "Tidak bisa memindahkan kolom ke tim lain.")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    result = await db.task_lists.find_one_and_update(
        {"id": list_id},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "List not found")
    return result


@api_router.delete("/task_lists/{list_id}")
async def delete_task_list(list_id: str, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    if not scope["is_spv"]:
        tl = await db.task_lists.find_one({"id": list_id}, {"_id": 0, "divisi_id": 1})
        if not tl or scope["head_divisi_id"] != tl.get("divisi_id"):
            raise HTTPException(403, "Hanya SPV atau kepala divisi yang dapat menghapus kolom.")
    r = await db.task_lists.delete_one({"id": list_id})
    await db.tasks.update_many({"list_id": list_id}, {"$set": {"list_id": None}})
    return {"ok": True, "deleted": r.deleted_count}


# ============ TASK LABELS ROUTES ============
@api_router.get("/task_labels", response_model=List[TaskLabel])
async def list_task_labels():
    rows = await db.task_labels.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return rows


@api_router.post("/task_labels", response_model=TaskLabel)
async def create_task_label(payload: TaskLabelCreate):
    item = TaskLabel(**payload.model_dump())
    await db.task_labels.insert_one(item.model_dump())
    return item


@api_router.put("/task_labels/{label_id}", response_model=TaskLabel)
async def update_task_label(label_id: str, payload: TaskLabelCreate, _: dict = Depends(require_spv)):
    result = await db.task_labels.find_one_and_update(
        {"id": label_id},
        {"$set": payload.model_dump()},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Label not found")
    return result


@api_router.delete("/task_labels/{label_id}")
async def delete_task_label(label_id: str, _: dict = Depends(require_spv)):
    r = await db.task_labels.delete_one({"id": label_id})
    await db.tasks.update_many({}, {"$pull": {"label_ids": label_id}})
    return {"ok": True, "deleted": r.deleted_count}


# ============ TODO TRACKER (RUTIN) ROUTES ============
@api_router.get("/todo/entries", response_model=List[TodoEntry])
async def list_todo_entries(
    start: Optional[str] = None,
    end: Optional[str] = None,
    task_ids: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    scope = await user_scope(user)
    q: dict = {}
    if start or end:
        q["period"] = {}
        if start:
            q["period"]["$gte"] = start
        if end:
            q["period"]["$lte"] = end
    if task_ids:
        q["task_id"] = {"$in": task_ids.split(",")}
    # Checklist rutin bersifat pribadi (seperti amaliyah) — termasuk untuk SPV.
    q["user_id"] = scope["user_id"]
    rows = await db.todo_entries.find(q, {"_id": 0}).to_list(20000)
    return rows


@api_router.post("/todo/entries", response_model=TodoEntry)
async def upsert_todo_entry(payload: TodoEntryCreate, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    filter_q = {"task_id": payload.task_id, "period": payload.period, "user_id": scope["user_id"]}
    existing = await db.todo_entries.find_one(filter_q, {"_id": 0})
    if existing:
        await db.todo_entries.update_one(
            {"id": existing["id"]}, {"$set": {"checked": payload.checked}}
        )
        existing["checked"] = payload.checked
        return existing
    entry = TodoEntry(**payload.model_dump())
    doc = entry.model_dump()
    doc["user_id"] = scope["user_id"]
    await db.todo_entries.insert_one(doc)
    return doc


# ============ AMALIYAH ITEMS ROUTES ============
@api_router.get("/amaliyah/items", response_model=List[AmaliyahItem])
async def list_amaliyah_items():
    rows = await db.amaliyah_items.find({}, {"_id": 0}).sort("urutan", 1).to_list(500)
    if not rows:
        # seed default
        defaults = [
            {"nama": "Sedekah Subuh", "target_metrik": "1x/hari", "urutan": 1},
            {"nama": "Tilawah 1 Lembar", "target_metrik": "1 lembar/hari", "urutan": 2},
            {"nama": "Dzikir Pagi", "target_metrik": "1x/hari", "urutan": 3},
            {"nama": "Dzikir Petang", "target_metrik": "1x/hari", "urutan": 4},
            {"nama": "Tahajud", "target_metrik": "1x/hari", "urutan": 5},
        ]
        for d in defaults:
            item = AmaliyahItem(**d)
            await db.amaliyah_items.insert_one(item.model_dump())
        rows = await db.amaliyah_items.find({}, {"_id": 0}).sort("urutan", 1).to_list(500)
    return rows


@api_router.post("/amaliyah/items", response_model=AmaliyahItem)
async def create_amaliyah_item(payload: AmaliyahItemCreate, _: dict = Depends(require_spv)):
    count = await db.amaliyah_items.count_documents({})
    item = AmaliyahItem(**payload.model_dump(), urutan=count + 1)
    await db.amaliyah_items.insert_one(item.model_dump())
    return item


@api_router.put("/amaliyah/items/{item_id}", response_model=AmaliyahItem)
async def update_amaliyah_item(item_id: str, payload: AmaliyahItemCreate, _: dict = Depends(require_spv)):
    update = payload.model_dump()
    result = await db.amaliyah_items.find_one_and_update(
        {"id": item_id}, {"$set": update}, return_document=True, projection={"_id": 0}
    )
    if not result:
        raise HTTPException(404, "Item not found")
    return result


@api_router.delete("/amaliyah/items/{item_id}")
async def delete_amaliyah_item(item_id: str, _: dict = Depends(require_spv)):
    r = await db.amaliyah_items.delete_one({"id": item_id})
    await db.amaliyah_entries.delete_many({"item_id": item_id})
    return {"ok": True, "deleted": r.deleted_count}


class AmaliyahReorder(BaseModel):
    item_ids: List[str]


@api_router.post("/amaliyah/items/reorder")
async def reorder_amaliyah_items(payload: AmaliyahReorder, _: dict = Depends(require_spv)):
    for i, iid in enumerate(payload.item_ids):
        await db.amaliyah_items.update_one({"id": iid}, {"$set": {"urutan": i + 1}})
    return {"ok": True, "reordered": len(payload.item_ids)}


@api_router.post("/amaliyah/items/bulk_delete")
async def bulk_delete_amaliyah_items(payload: BulkIdsRequest, _: dict = Depends(require_spv)):
    if not payload.ids:
        return {"ok": True, "deleted": 0}
    r = await db.amaliyah_items.delete_many({"id": {"$in": payload.ids}})
    await db.amaliyah_entries.delete_many({"item_id": {"$in": payload.ids}})
    return {"ok": True, "deleted": r.deleted_count}


@api_router.get("/amaliyah/streak")
async def amaliyah_streak(user: dict = Depends(get_current_user)):
    """Streak = consecutive days ending today where user checked >=1 amaliyah.
    Returns streak count + longest + earned badges (7/14/30/60/100/180/365)."""
    scope = await user_scope(user)
    from datetime import timedelta as _td
    today = date.today()
    # Fetch last 400 days of checked entries
    start = (today - _td(days=400)).isoformat()
    rows = await db.amaliyah_entries.find(
        {"user_id": scope["user_id"], "checked": True, "tanggal": {"$gte": start}},
        {"_id": 0, "tanggal": 1},
    ).to_list(20000)
    checked_days = set(r["tanggal"] for r in rows)
    # current streak
    current = 0
    d = today
    while d.isoformat() in checked_days:
        current += 1
        d = d - _td(days=1)
    # longest streak (walk backwards)
    longest = 0
    run = 0
    d = today
    for _ in range(400):
        if d.isoformat() in checked_days:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
        d = d - _td(days=1)
    # Total checked distinct days
    total_days = len(checked_days)
    tiers = [7, 14, 30, 60, 100, 180, 365]
    badges = [t for t in tiers if longest >= t]
    next_target = next((t for t in tiers if t > longest), None)
    return {
        "current_streak": current,
        "longest_streak": longest,
        "total_days": total_days,
        "badges": badges,
        "next_target": next_target,
    }


# ============ AMALIYAH ENTRIES ROUTES ============
@api_router.get("/amaliyah/entries", response_model=List[AmaliyahEntry])
async def list_entries(start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    q: dict = {}
    if start or end:
        q["tanggal"] = {}
        if start:
            q["tanggal"]["$gte"] = start
        if end:
            q["tanggal"]["$lte"] = end
    # Amaliyah is strictly personal — each user sees only their own entries.
    q["user_id"] = scope["user_id"]
    rows = await db.amaliyah_entries.find(q, {"_id": 0}).to_list(5000)
    return rows


@api_router.post("/amaliyah/entries", response_model=AmaliyahEntry)
async def upsert_entry(payload: AmaliyahEntryCreate, user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    existing = await db.amaliyah_entries.find_one(
        {"item_id": payload.item_id, "tanggal": payload.tanggal, "user_id": scope["user_id"]},
        {"_id": 0},
    )
    if existing:
        await db.amaliyah_entries.update_one(
            {"id": existing["id"]},
            {"$set": {"checked": payload.checked, "catatan": payload.catatan or ""}},
        )
        existing["checked"] = payload.checked
        existing["catatan"] = payload.catatan or ""
        return existing
    entry = AmaliyahEntry(**payload.model_dump(), user_id=scope["user_id"])
    await db.amaliyah_entries.insert_one(entry.model_dump())
    return entry


# ============ RAPORT ROUTES ============
RUTIN_KATEGORI = ("HARIAN", "MINGGUAN", "BULANAN")
RUTIN_KATEGORI_SET = set(RUTIN_KATEGORI)


def _amaliyah_target_per_item(target_metrik: str, days: int) -> int:
    """target_metrik berupa teks bebas. 'minggu/pekan' -> mingguan, 'bulan' -> bulanan, selain itu harian."""
    t = (target_metrik or "").lower()
    if "minggu" in t or "pekan" in t:
        return max(1, -(-days // 7))
    if "bulan" in t:
        return max(1, -(-days // 30))
    return days


async def _raport_summary_impl(start: Optional[str], end: Optional[str], user: dict, anggota_id: Optional[str] = None) -> dict:
    """Raport = 60% tugas + 40% amaliyah.
    - Tugas: non-rutin, dihitung dari DEADLINE dalam periode (tanpa deadline: tanggal dibuat). Rutin dilacak di Tugas Rutin Tracker.
    - Individu: semua tugas dengan penerima = anggota itu (termasuk delegasi lintas divisi).
    - Relasi orang: users.anggota_id (satu anggota bisa tertaut ke >1 akun).
    - Bila satu komponen tidak punya data, skor gabungan memakai komponen yang ada saja.
    """
    scope = await user_scope(user)
    today = date.today().isoformat()
    if not start or not end:
        end_d = date.today()
        start_d = end_d - timedelta(days=29)
        start = start or start_d.isoformat()
        end = end or end_d.isoformat()
    try:
        days = max((date.fromisoformat(end[:10]) - date.fromisoformat(start[:10])).days + 1, 1)
    except Exception:
        days = 30

    # Anggota sendiri bila non-SPV tanpa anggota_id (dulu: seluruh tugas divisi tercampur amaliyah pribadi)
    if not anggota_id and not scope["is_spv"]:
        anggota_id = scope["anggota_id"] or "__none__"

    ang = None
    div_nama = None
    if anggota_id:
        ang = await db.anggota.find_one({"id": anggota_id}, {"_id": 0})
        if ang and ang.get("divisi_id"):
            div = await db.divisi.find_one({"id": ang["divisi_id"]}, {"_id": 0, "nama": 1})
            div_nama = div.get("nama") if div else None

    # ---- Tugas
    period_q = {"$or": [
        {"deadline": {"$gte": start, "$lte": end}},
        {"deadline": {"$in": [None, ""]}, "created_at": {"$gte": start, "$lte": end + "T23:59:59"}},
    ]}
    task_query: dict = {"archived": {"$ne": True}, "kategori": {"$nin": list(RUTIN_KATEGORI)}, **period_q}
    if anggota_id:
        task_query["penerima_tugas_id"] = anggota_id
    all_tasks = await db.tasks.find(task_query, {"_id": 0}).to_list(5000)

    total = len(all_tasks)
    selesai = sum(1 for t in all_tasks if t.get("status") == "SELESAI")
    dalam_proses = sum(1 for t in all_tasks if t.get("status") in ("DALAM_PROSES", "REVISI", "MENUNGGU_REVIEW"))
    terkendala = sum(1 for t in all_tasks if t.get("status") == "TERKENDALA")
    belum_mulai = sum(1 for t in all_tasks if t.get("status") == "BELUM_MULAI")
    overdue = sum(1 for t in all_tasks if t.get("deadline") and t["deadline"] < today and t.get("status") != "SELESAI")
    task_score = round((selesai / total * 100) if total else 0, 1)

    # ---- Amaliyah
    items = await db.amaliyah_items.find({"aktif": {"$ne": False}}, {"_id": 0, "id": 1, "target_metrik": 1}).to_list(200)
    item_ids = [i["id"] for i in items]
    target_per_user = sum(_amaliyah_target_per_item(i.get("target_metrik", ""), days) for i in items)
    if anggota_id:
        users = await db.users.find({"anggota_id": anggota_id, "status": "approved"}, {"_id": 0, "user_id": 1}).to_list(20)
        participant_ids = [u["user_id"] for u in users]
        n_participants = 1 if participant_ids else 0  # beberapa akun untuk 1 orang = 1 peserta
    else:
        users = await db.users.find({"anggota_id": {"$nin": [None, ""]}, "status": "approved"}, {"_id": 0, "user_id": 1, "anggota_id": 1}).to_list(1000)
        participant_ids = [u["user_id"] for u in users]
        n_participants = len({u["anggota_id"] for u in users})
    entry_q = {"checked": True, "tanggal": {"$gte": start, "$lte": end}, "item_id": {"$in": item_ids},
               "user_id": {"$in": participant_ids or ["__none__"]}}
    # 1 check-in per (anggota, item, tanggal) — akun ganda tidak dihitung dua kali
    u2a = {u["user_id"]: (u.get("anggota_id") or anggota_id) for u in users}
    rows = await db.amaliyah_entries.find(entry_q, {"_id": 0, "user_id": 1, "item_id": 1, "tanggal": 1}).to_list(100000)
    entries = len({(u2a.get(r["user_id"]), r["item_id"], r["tanggal"]) for r in rows})
    target = target_per_user * n_participants
    amaliyah_score = round(min(entries / target * 100, 100) if target else 0, 1)

    # ---- Gabungan
    # Ada aktivitas (tugas atau check-in) -> amaliyah 0 dihitung sebagai 0, bukan "tanpa data".
    has_task = total > 0
    data_cukup = has_task or entries > 0
    if has_task and target > 0:
        combined = round(task_score * 0.6 + amaliyah_score * 0.4, 1)
    elif has_task:
        combined = task_score
    elif entries > 0:
        combined = amaliyah_score
    else:
        combined = 0
    if not data_cukup:
        auto_rec = "NETRAL"  # belum ada data != kinerja buruk
    elif combined >= 80:
        auto_rec = "REWARD"
    elif combined < 50:
        auto_rec = "EVALUASI"
    else:
        auto_rec = "NETRAL"

    note_key = {"id": f"anggota:{anggota_id}"} if anggota_id and anggota_id != "__none__" else {"id": "singleton"}
    note = await db.raport_notes.find_one(note_key, {"_id": 0}) or {
        **note_key, "catatan_spv": "", "rekomendasi": "NETRAL", "updated_at": now_iso(),
    }

    result = {
        "periode": {"start": start, "end": end, "days": days},
        "task": {"total": total, "selesai": selesai, "dalam_proses": dalam_proses, "terkendala": terkendala,
                 "belum_mulai": belum_mulai, "overdue": overdue, "score": task_score},
        "amaliyah": {"total_entries": entries, "target": target, "items_count": len(items), "days": days,
                     "peserta": n_participants, "score": amaliyah_score},
        "combined_score": combined,
        "auto_rekomendasi": auto_rec,
        "data_cukup": data_cukup,
        "spv_note": note,
    }
    if anggota_id and ang:
        result["anggota"] = {"id": ang["id"], "nama": ang.get("nama"), "divisi_nama": div_nama}
        result["tasks_list"] = sorted(all_tasks, key=lambda x: (x.get("deadline") or "9999", x.get("nama") or ""))
    return result


@api_router.get("/raport/summary")
async def raport_summary(start: Optional[str] = None, end: Optional[str] = None, anggota_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    # RBAC: anggota_id filter is SPV-only (or self, if anggota is linked to current user)
    if anggota_id:
        scope = await user_scope(user)
        if not scope["is_spv"]:
            if anggota_id != scope["anggota_id"]:
                raise HTTPException(403, "Hanya SPV yang bisa melihat raport anggota lain.")
    return await _raport_summary_impl(start, end, user, anggota_id)


@api_router.put("/raport/note")
async def update_raport_note(payload: RaportNoteUpdate, anggota_id: Optional[str] = None, _: dict = Depends(require_spv)):
    key_id = f"anggota:{anggota_id}" if anggota_id else "singleton"
    doc = {
        "id": key_id,
        "catatan_spv": payload.catatan_spv,
        "rekomendasi": payload.rekomendasi,
        "updated_at": now_iso(),
    }
    await db.raport_notes.update_one({"id": key_id}, {"$set": doc}, upsert=True)
    return doc


# ============ DASHBOARD DIGEST (SPV) ============
@api_router.get("/dashboard/digest")
async def dashboard_digest(user: dict = Depends(get_current_user)):
    scope = await user_scope(user)
    today = date.today().isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    week_ahead = (date.today() + timedelta(days=3)).isoformat()

    base = {"archived": {"$ne": True}, "status": {"$ne": "SELESAI"}}
    if not scope["is_spv"] and scope["divisi_id"]:
        base["divisi_id"] = scope["divisi_id"]
    elif not scope["is_spv"]:
        return {"overdue": [], "today": [], "upcoming": [], "stagnant": [], "counts": {"overdue": 0, "today": 0, "upcoming": 0, "stagnant": 0}}

    overdue = await db.tasks.find({**base, "deadline": {"$lt": today, "$ne": None}}, {"_id": 0}).sort("deadline", 1).limit(50).to_list(50)
    today_t = await db.tasks.find({**base, "deadline": today}, {"_id": 0}).limit(50).to_list(50)
    upcoming = await db.tasks.find({**base, "deadline": {"$gt": today, "$lte": week_ahead}}, {"_id": 0}).sort("deadline", 1).limit(50).to_list(50)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    stg_q = {**base, "status": {"$in": ["BELUM_MULAI", "DALAM_PROSES", "TERKENDALA"]}, "updated_at": {"$lt": cutoff}}
    stagnant = await db.tasks.find(stg_q, {"_id": 0}).sort("updated_at", 1).limit(30).to_list(30)

    ang_list = await db.anggota.find({}, {"_id": 0}).to_list(500)
    ang_map = {a["id"]: a["nama"] for a in ang_list}
    div_list = await db.divisi.find({}, {"_id": 0}).to_list(200)
    div_map = {d["id"]: d["nama"] for d in div_list}

    def _dec(rows):
        return [{**r, "penerima_nama": ang_map.get(r.get("penerima_tugas_id"), r.get("penerima_tugas") or "-"),
                 "divisi_nama": div_map.get(r.get("divisi_id"), "-")} for r in rows]

    return {
        "overdue": _dec(overdue),
        "today": _dec(today_t),
        "upcoming": _dec(upcoming),
        "stagnant": _dec(stagnant),
        "counts": {"overdue": len(overdue), "today": len(today_t), "upcoming": len(upcoming), "stagnant": len(stagnant)},
    }


# ============ EXCEL IMPORT ============
def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def _map_kategori(val: str) -> str:
    v = _norm(val)
    if "harian" in v:
        return "HARIAN"
    if "mingguan" in v:
        return "MINGGUAN"
    if "bulanan" in v:
        return "BULANAN"
    if "project" in v or "proyek" in v:
        return "PROJECT"
    return "HARIAN"


def _map_status(val: str) -> str:
    v = _norm(val)
    if "selesai" in v or "done" in v:
        return "SELESAI"
    if "proses" in v or "progress" in v:
        return "DALAM_PROSES"
    if "kendala" in v or "block" in v:
        return "TERKENDALA"
    return "BELUM_MULAI"


def _cell_to_iso(val: Any) -> Optional[str]:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val.date().isoformat()
    try:
        # excel serial number
        n = float(val)
        base = datetime(1899, 12, 30)
        from datetime import timedelta

        return (base + timedelta(days=n)).date().isoformat()
    except Exception:
        return str(val)


@api_router.post("/import/excel")
async def import_excel(file: UploadFile = File(...), _: dict = Depends(require_spv)):
    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"Gagal baca Excel: {e}")

    imported_tasks = 0
    imported_amaliyah = 0
    log: List[str] = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        # Find header row (first row with recognizable header)
        header_row_idx = None
        headers: List[str] = []
        for r_idx in range(1, min(ws.max_row + 1, 20)):
            row_vals = [str(c.value or "").strip().lower() for c in ws[r_idx]]
            joined = " ".join(row_vals)
            if any(k in joined for k in ["nama tugas", "initiative", "to do", "todo"]):
                header_row_idx = r_idx
                headers = row_vals
                break
            if "nama amalan" in joined or "amaliyah" in joined or "habit" in joined:
                header_row_idx = r_idx
                headers = row_vals
                break

        if header_row_idx is None:
            continue

        # detect type
        is_amaliyah = any(
            "amalan" in h or "habit" in h or "amaliyah" in h for h in headers
        )

        # Build header index map
        def find_col(*keys: str) -> Optional[int]:
            for i, h in enumerate(headers):
                for k in keys:
                    if k in h:
                        return i
            return None

        if is_amaliyah:
            col_nama = find_col("nama amalan", "habit", "amaliyah", "amalan")
            col_target = find_col("target")
            col_ket = find_col("keterangan", "catatan")
            for r_idx in range(header_row_idx + 1, ws.max_row + 1):
                row = [c.value for c in ws[r_idx]]
                if col_nama is None or col_nama >= len(row):
                    continue
                nama = row[col_nama]
                if not nama or not str(nama).strip():
                    continue
                target = (
                    str(row[col_target])
                    if col_target is not None
                    and col_target < len(row)
                    and row[col_target]
                    else "1x/hari"
                )
                ket = (
                    str(row[col_ket])
                    if col_ket is not None and col_ket < len(row) and row[col_ket]
                    else ""
                )
                # Deduplicate by name
                exists = await db.amaliyah_items.find_one({"nama": str(nama).strip()})
                if exists:
                    continue
                count = await db.amaliyah_items.count_documents({})
                item = AmaliyahItem(
                    nama=str(nama).strip(),
                    target_metrik=target,
                    keterangan=ket,
                    urutan=count + 1,
                )
                await db.amaliyah_items.insert_one(item.model_dump())
                imported_amaliyah += 1
        else:
            col_nama = find_col("nama tugas", "initiative", "to do", "todo")
            col_kat = find_col("kategori", "frekuensi")
            col_freq = find_col("frekuensi")
            col_status = find_col("status")
            col_pemberi = find_col("pemberi")
            col_mulai = find_col("waktu mulai", "start", "mulai")
            col_deadline = find_col("batas waktu", "deadline")
            col_catatan_tim = find_col("catatan tim", "hambatan")
            col_catatan_spv = find_col("catatan spv", "arahan")
            col_link = find_col("link", "output")

            for r_idx in range(header_row_idx + 1, ws.max_row + 1):
                row = [c.value for c in ws[r_idx]]
                if col_nama is None or col_nama >= len(row):
                    continue
                nama = row[col_nama]
                if not nama or not str(nama).strip():
                    continue
                nama_str = str(nama).strip()
                if len(nama_str) < 2:
                    continue

                def rv(i):
                    return row[i] if i is not None and i < len(row) else None

                task = TaskBase(
                    nama=nama_str,
                    kategori=_map_kategori(rv(col_kat) or rv(col_freq) or "HARIAN"),
                    frekuensi=str(rv(col_freq) or "RUTIN").upper()[:30],
                    status=_map_status(rv(col_status) or ""),
                    pemberi_tugas=str(rv(col_pemberi) or ""),
                    tanggal_mulai=_cell_to_iso(rv(col_mulai)),
                    deadline=_cell_to_iso(rv(col_deadline)),
                    catatan_tim=str(rv(col_catatan_tim) or ""),
                    catatan_spv=str(rv(col_catatan_spv) or ""),
                    link_output=str(rv(col_link) or ""),
                    divisi=sheet_name,
                )
                t = Task(**task.model_dump())
                await db.tasks.insert_one(t.model_dump())
                imported_tasks += 1

        log.append(
            f"Sheet '{sheet_name}': {'amaliyah' if is_amaliyah else 'tasks'} imported"
        )

    return {
        "ok": True,
        "imported_tasks": imported_tasks,
        "imported_amaliyah": imported_amaliyah,
        "log": log,
    }


# ============ RAPORT PDF EXPORT ============
@api_router.get("/raport/export.pdf")
async def export_raport_pdf(
    start: Optional[str] = None,
    end: Optional[str] = None,
    anggota_id: Optional[str] = None,
    user: dict = Depends(require_spv),
):
    summary = await _raport_summary_impl(start, end, user, anggota_id)
    ang = summary.get("anggota") or {}
    if anggota_id:
        subject = f"Raport Individu — {ang.get('nama', '')}"
        anggota_nama = ang.get("nama")
        divisi_nama = ang.get("divisi_nama")
        slug = (ang.get("nama") or "anggota").lower().replace(" ", "-")
    else:
        subject = "Raport Kinerja Tim"
        anggota_nama = None
        divisi_nama = None
        slug = "tim"
    pdf_bytes = build_raport_pdf(
        summary, start or "-", end or "-",
        subject=subject, anggota_nama=anggota_nama, divisi_nama=divisi_nama,
    )
    fname = f"raport-ruang-sanad-{slug}-{(start or 'all')}_{(end or 'all')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ============ GLOBAL SEARCH ============
@api_router.get("/search")
async def global_search(q: str = "", user: dict = Depends(get_current_user)):
    q = (q or "").strip()
    if len(q) < 2:
        return {"tasks": [], "amaliyah": [], "anggota": [], "divisi": []}
    scope = await user_scope(user)
    regex = {"$regex": re.escape(q), "$options": "i"}

    # Tasks
    task_q = {"nama": regex, "archived": {"$ne": True}}
    if not scope["is_spv"]:
        if scope["divisi_id"]:
            task_q["divisi_id"] = scope["divisi_id"]
        else:
            task_q["_never"] = True
    tasks = await db.tasks.find(task_q, {"_id": 0, "id": 1, "nama": 1, "status": 1, "divisi_id": 1, "deadline": 1}).limit(20).to_list(20)

    # Amaliyah items (shared list)
    amal = await db.amaliyah_items.find({"nama": regex}, {"_id": 0, "id": 1, "nama": 1, "target_metrik": 1}).limit(10).to_list(10)

    # Anggota (peers in own divisi, or all for SPV)
    ang_q = {"nama": regex}
    if not scope["is_spv"]:
        if scope["divisi_id"]:
            ang_q["divisi_id"] = scope["divisi_id"]
        else:
            ang_q["_never"] = True
    anggota = await db.anggota.find(ang_q, {"_id": 0, "id": 1, "nama": 1, "divisi_id": 1, "warna": 1}).limit(10).to_list(10)

    # Divisi (SPV only sees all; anggota only theirs)
    div_q = {"nama": regex}
    divisi = await db.divisi.find(div_q, {"_id": 0, "id": 1, "nama": 1, "warna": 1}).limit(10).to_list(10)
    if not scope["is_spv"]:
        divisi = [d for d in divisi if d["id"] == scope["divisi_id"]] if scope["divisi_id"] else []

    # Decorate tasks with divisi_nama
    d_map = {d["id"]: d for d in await db.divisi.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(200)}
    tasks = [{**t, "divisi_nama": d_map.get(t.get("divisi_id"), {}).get("nama", "-")} for t in tasks]

    return {"tasks": tasks, "amaliyah": amal, "anggota": anggota, "divisi": divisi}


# Attach auth & monitoring routers to /api
api_router.include_router(build_auth_router(db))
api_router.include_router(build_monitoring_router(db, get_current_user, user_scope))
api_router.include_router(build_strategy_router(db, get_current_user, require_spv, user_scope))

from sasaran import build_sasaran_router
sasaran_router = build_sasaran_router(db, get_current_user, user_scope)
api_router.include_router(sasaran_router)

import sys as _sys
from agent_mcp import build_mcp_router
api_router.include_router(build_mcp_router(_sys.modules[__name__]))

# Include router
app.include_router(api_router)

_cors_env = os.environ.get('CORS_ORIGINS', '*').strip()
if _cors_env in ("", "*"):
    _cors_origins = ["*"]
    _allow_credentials = False  # credentials + wildcard is invalid
else:
    _cors_origins = [o.strip() for o in _cors_env.split(',') if o.strip()]
    _allow_credentials = True

# Always allow the configured frontend host + credentials when available
_frontend_url = os.environ.get('FRONTEND_URL', '').strip()
if _frontend_url and _frontend_url not in _cors_origins:
    _cors_origins.append(_frontend_url)
    _allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await seed_admin(db)
    try:
        await db.agent_link_codes.create_index("expires_at", expireAfterSeconds=0)
        await db.agent_chat_links.create_index([("chat_id", 1), ("gateway_key_id", 1)], unique=True)
        await db.agent_audit.create_index("at", expireAfterSeconds=60 * 60 * 24 * 180)  # simpan 180 hari
        await db.sasaran.create_index([("period_id", 1), ("urutan", 1)])
        await db.ukuran.create_index([("period_id", 1), ("pic_id", 1)])
        await db.ukuran_checkins.create_index([("ukuran_id", 1), ("at", 1)])
        await db.tasks.create_index("sasaran_id")
    except Exception:
        pass
    # Migrate existing amaliyah_entries without user_id → assign to first SPV
    spv = await db.users.find_one({"role": "spv", "status": "approved"}, {"_id": 0})
    if spv:
        await db.amaliyah_entries.update_many(
            {"user_id": {"$in": [None, "", False]}}, {"$set": {"user_id": spv["user_id"]}}
        )
        await db.amaliyah_entries.update_many(
            {"user_id": {"$exists": False}}, {"$set": {"user_id": spv["user_id"]}}
        )
        await db.todo_entries.update_many(
            {"user_id": {"$exists": False}}, {"$set": {"user_id": spv["user_id"]}}
        )

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
