"""Modul Sasaran: Sasaran → Ukuran → Tugas, dengan check-in mingguan.

Menggantikan BSC / OKR / KPI / Action Plan / Inisiatif (koleksi lama tetap disimpan, tidak dihapus).

Koleksi:
- strategy_periods  : {id, nama, start, end, siklus_bulan, active, archived}
- sasaran           : {id, period_id, judul, level LEMBAGA|TIM, divisi_id?, pj_id?, tim_ids[], perspektif?, parent_id?, urutan}
- ukuran            : {id, sasaran_id, period_id, nama, pic_id?, arah NAIK|TURUN|JAGA, satuan, awal?, target, capaian?,
                       confidence?, last_checkin_at?, urutan}
- ukuran_checkins   : {id, ukuran_id, nilai, confidence, catatan, user_id, actor_name, at}
- tasks.sasaran_id  : tugas yang mendukung sebuah sasaran

Status (satu aturan untuk semua ukuran, berbasis waktu):
  capaian% dibanding "seharusnya" (porsi waktu periode yang sudah berjalan).
  rasio >= 0.9 SESUAI · >= 0.7 PERHATIAN · < 0.7 TERTINGGAL · belum ada capaian = BELUM_ADA_DATA.
  Hanya ukuran NAIK/TURUN yang punya angka awal diukur sebagai progres terhadap waktu; tanpa angka awal
  (atau JAGA) ukuran dibaca sebagai tingkat dan dibanding target penuh.
  Check-in > 10 hari lalu ditandai perlu_update.
"""
import io
import re
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

# Label UI memakai istilah manajemen: Objective (sasaran), Key Result (ukuran), KPI (KR ber-PIC), perspektif BSC.
PERSPEKTIF = {"KEUANGAN": "Financial", "SANTRI": "Customer", "OPERASIONAL": "Internal Process", "SDM": "Learning & Growth"}
ARAH = {"NAIK": "Naikkan", "TURUN": "Turunkan", "JAGA": "Pertahankan"}
CONFIDENCE = ("YAKIN", "RAGU", "BERISIKO")
STALE_DAYS = 10


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_angka(val) -> tuple:
    """'10%' -> (10.0, '%'), '230 Juta' -> (230000000.0, 'Rp'), '840' -> (840.0, ''), '95&' -> (95.0, '%')."""
    if val is None:
        return None, ""
    if isinstance(val, (int, float)):
        return float(val), ""
    s = str(val).strip().lower().replace("rp", "").strip()
    if not s:
        return None, ""
    m = re.search(r"-?\d+(?:[.,]\d+)?", s)
    if not m:
        return None, ""
    num = float(m.group(0).replace(",", "."))
    unit = ""
    if "%" in s or "&" in s:
        unit = "%"
    if "miliar" in s or "milyar" in s:
        num *= 1_000_000_000; unit = "Rp"
    elif "juta" in s or "jt" in s:
        num *= 1_000_000; unit = "Rp"
    elif "ribu" in s or "rb" in s:
        num *= 1_000; unit = "Rp"
    return num, unit


def build_sasaran_router(db, get_current_user, user_scope) -> APIRouter:
    router = APIRouter(prefix="/sasaran", tags=["sasaran"])

    # ------------------------------------------------------------ models
    class SasaranIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        period_id: str
        judul: str = Field(min_length=3, max_length=300)
        level: str = "TIM"
        divisi_id: Optional[str] = None
        pj_id: Optional[str] = None
        tim_ids: List[str] = Field(default_factory=list)
        perspektif: Optional[str] = None
        parent_id: Optional[str] = None

    class SasaranUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        level: Optional[str] = None
        divisi_id: Optional[str] = None
        pj_id: Optional[str] = None
        tim_ids: Optional[List[str]] = None
        perspektif: Optional[str] = None
        parent_id: Optional[str] = None
        urutan: Optional[int] = None

    class UkuranIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        nama: str = Field(min_length=2, max_length=300)
        pic_id: Optional[str] = None
        arah: str = "NAIK"
        satuan: str = ""
        awal: Optional[float] = None
        target: float

    class UkuranUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        nama: Optional[str] = None
        pic_id: Optional[str] = None
        arah: Optional[str] = None
        satuan: Optional[str] = None
        awal: Optional[float] = None
        target: Optional[float] = None
        urutan: Optional[int] = None

    class CheckinIn(BaseModel):
        nilai: float
        confidence: str = "YAKIN"
        catatan: str = Field(default="", max_length=500)

    class PeriodIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        nama: Optional[str] = None
        start: str
        end: str
        active: bool = False

    class EvalIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        summary: Optional[str] = None
        kesimpulan: Optional[str] = None
        highlights: Optional[List[str]] = None
        improvements: Optional[List[str]] = None
        next_focus: Optional[List[str]] = None

    class VisiIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        visi: Optional[str] = None
        misi: Optional[List[str]] = None
        nilai: Optional[List[str]] = None

    # ------------------------------------------------------------ helpers
    def _elapsed(period: dict) -> float:
        try:
            s, e = date.fromisoformat(period["start"]), date.fromisoformat(period["end"])
        except Exception:
            return 0.0
        total = max((e - s).days + 1, 1)
        done = (min(date.today(), e) - s).days + 1
        return round(max(0.0, min(1.0, done / total)) * 100, 1)

    def _pct(u: dict) -> Optional[float]:
        cap, tgt, awal, arah = u.get("capaian"), u.get("target"), u.get("awal"), u.get("arah") or "NAIK"
        if cap is None or tgt is None:
            return None
        try:
            cap, tgt = float(cap), float(tgt)
            awal = float(awal) if awal is not None else None
        except (TypeError, ValueError):
            return None
        if arah == "TURUN":
            if awal is not None and awal != tgt:
                p = (awal - cap) / (awal - tgt) * 100
            elif cap > 0:
                p = tgt / cap * 100
            else:
                p = 100.0
        else:  # NAIK / JAGA
            if arah == "NAIK" and awal is not None and tgt != awal:
                p = (cap - awal) / (tgt - awal) * 100
            elif tgt != 0:
                p = cap / tgt * 100
            else:
                p = 100.0
        return round(max(0.0, min(150.0, p)), 1)

    def _status(pct: Optional[float], expected: float, arah: str, ada_awal: bool = False) -> str:
        """Dengan angka awal (NAIK/TURUN): progres dibanding porsi waktu berjalan.
        Tanpa angka awal, atau JAGA: ukuran dianggap TINGKAT, dibanding target penuh (100%)."""
        if pct is None:
            return "BELUM_ADA_DATA"
        exp = max(expected, 1.0) if (arah in ("NAIK", "TURUN") and ada_awal) else 100.0
        r = pct / exp
        if r >= 0.9 or pct >= 100:
            return "SESUAI"
        if r >= 0.7:
            return "PERHATIAN"
        return "TERTINGGAL"

    def _stale(u: dict) -> bool:
        t = u.get("last_checkin_at")
        if not t:
            return True
        try:
            dt = datetime.fromisoformat(t)
            dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) - dt > timedelta(days=STALE_DAYS)
        except Exception:
            return True

    async def _maps():
        ang = {a["id"]: a for a in await db.anggota.find({}, {"_id": 0}).to_list(1000)}
        div = {d["id"]: d for d in await db.divisi.find({}, {"_id": 0}).to_list(200)}
        return ang, div

    async def _period(period_id: str) -> dict:
        p = await db.strategy_periods.find_one({"id": period_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Periode tidak ditemukan.")
        return p

    async def _can_edit_sasaran(scope: dict, s: dict) -> bool:
        if scope["is_spv"]:
            return True
        if s.get("level") == "TIM" and scope["head_divisi_id"] and s.get("divisi_id") == scope["head_divisi_id"]:
            return True
        return bool(scope["anggota_id"]) and s.get("pj_id") == scope["anggota_id"]

    async def _require_edit(user: dict, s: dict):
        scope = await user_scope(user)
        if not await _can_edit_sasaran(scope, s):
            raise HTTPException(403, "Hanya SPV, kepala tim terkait, atau penanggung jawab sasaran yang bisa mengubah.")
        return scope

    async def _require_create(user: dict, level: str, divisi_id: Optional[str]):
        scope = await user_scope(user)
        if scope["is_spv"]:
            return scope
        if level == "TIM" and scope["head_divisi_id"] and divisi_id == scope["head_divisi_id"]:
            return scope
        raise HTTPException(403, "Sasaran baru hanya bisa dibuat SPV, atau kepala tim untuk timnya sendiri.")

    def _validate_s(data: dict):
        if data.get("level") and data["level"] not in ("LEMBAGA", "TIM"):
            raise HTTPException(400, "Level harus LEMBAGA atau TIM.")
        if data.get("perspektif") and data["perspektif"] not in PERSPEKTIF:
            raise HTTPException(400, "Perspektif tidak dikenal.")
        if data.get("level") == "TIM" and "divisi_id" in data and not data.get("divisi_id"):
            raise HTTPException(400, "Sasaran tim wajib memilih tim.")

    def _validate_u(data: dict):
        if data.get("arah") and data["arah"] not in ARAH:
            raise HTTPException(400, "Arah harus NAIK, TURUN, atau JAGA.")

    def _decorate_u(u: dict, expected: float, ang: dict) -> dict:
        pct = _pct(u)
        pic = ang.get(u.get("pic_id"))
        return {**u, "pct": pct, "status": _status(pct, expected, u.get("arah") or "NAIK", u.get("awal") is not None),
                "mode": "progres" if (u.get("awal") is not None and (u.get("arah") or "NAIK") != "JAGA") else "tingkat",
                "perlu_update": _stale(u), "pic": {"id": pic["id"], "nama": pic["nama"]} if pic else None}

    async def _overview(period_id: str, user: dict) -> dict:
        period = await _period(period_id)
        expected = _elapsed(period)
        ang, div = await _maps()
        scope = await user_scope(user)
        ss = await db.sasaran.find({"period_id": period_id}, {"_id": 0}).sort([("level", 1), ("urutan", 1), ("created_at", 1)]).to_list(500)
        us = await db.ukuran.find({"period_id": period_id}, {"_id": 0}).sort([("urutan", 1), ("created_at", 1)]).to_list(2000)
        sids = [s["id"] for s in ss]
        tasks = await db.tasks.find({"sasaran_id": {"$in": sids}, "archived": {"$ne": True}},
                                    {"_id": 0, "id": 1, "nama": 1, "status": 1, "deadline": 1, "sasaran_id": 1, "penerima_tugas_id": 1}).to_list(3000)
        by_s_u, by_s_t = {}, {}
        for u in us:
            by_s_u.setdefault(u["sasaran_id"], []).append(_decorate_u(u, expected, ang))
        for t in tasks:
            by_s_t.setdefault(t["sasaran_id"], []).append({**t, "R": ang.get(t.get("penerima_tugas_id"), {}).get("nama")})
        out = []
        for s in ss:
            ulist = by_s_u.get(s["id"], [])
            pcts = [min(u["pct"], 100.0) for u in ulist if u["pct"] is not None]
            pct = round(sum(pcts) / len(pcts), 1) if pcts else None
            stats = [u["status"] for u in ulist]
            if not ulist or all(x == "BELUM_ADA_DATA" for x in stats):
                st = "BELUM_ADA_DATA"
            elif "TERTINGGAL" in stats:
                st = "TERTINGGAL"
            elif "PERHATIAN" in stats:
                st = "PERHATIAN"
            else:
                st = "SESUAI"
            tl = by_s_t.get(s["id"], [])
            pj = ang.get(s.get("pj_id"))
            out.append({
                **s, "ukuran": ulist, "pct": pct, "status": st,
                "perspektif_label": PERSPEKTIF.get(s.get("perspektif")),
                "divisi": {"id": s["divisi_id"], "nama": div.get(s["divisi_id"], {}).get("nama")} if s.get("divisi_id") else None,
                "pj": {"id": pj["id"], "nama": pj["nama"]} if pj else None,
                "tim": [{"id": i, "nama": ang[i]["nama"]} for i in s.get("tim_ids") or [] if i in ang],
                "tugas": tl, "tugas_summary": {
                    "total": len(tl), "selesai": sum(1 for t in tl if t["status"] == "SELESAI"),
                    "review": sum(1 for t in tl if t["status"] == "MENUNGGU_REVIEW")},
                "bisa_ubah": await _can_edit_sasaran(scope, s),
            })
        me = scope["anggota_id"]
        mine = [u for s in out for u in s["ukuran"] if me and u.get("pic_id") == me]
        all_u = [u for s in out for u in s["ukuran"]]
        return {
            "period": period, "expected_pct": expected, "sasaran": out,
            "stats": {"sasaran": len(out), "ukuran": len(all_u),
                      "sesuai": sum(1 for u in all_u if u["status"] == "SESUAI"),
                      "perhatian": sum(1 for u in all_u if u["status"] == "PERHATIAN"),
                      "tertinggal": sum(1 for u in all_u if u["status"] == "TERTINGGAL"),
                      "belum_data": sum(1 for u in all_u if u["status"] == "BELUM_ADA_DATA"),
                      "perlu_update": sum(1 for u in all_u if u["perlu_update"])},
            "ukuran_saya": mine,
            "checkin_saya_perlu": [u for u in mine if u["perlu_update"]],
            "bisa_buat": scope["is_spv"] or bool(scope["head_divisi_id"]),
            "head_divisi_id": scope["head_divisi_id"], "is_spv": scope["is_spv"],
            "perspektif_opsi": PERSPEKTIF, "arah_opsi": ARAH,
        }

    # ------------------------------------------------------------ periods
    def _check_dates(start: str, end: str):
        try:
            s, e = date.fromisoformat(start), date.fromisoformat(end)
        except ValueError:
            raise HTTPException(400, "Format tanggal harus YYYY-MM-DD.")
        if e < s:
            raise HTTPException(400, "Tanggal akhir sebelum tanggal mulai.")
        return s, e

    def _auto_nama(start: str, end: str) -> str:
        bl = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
        s, e = date.fromisoformat(start), date.fromisoformat(end)
        if s.year == e.year:
            return f"{bl[s.month-1]}–{bl[e.month-1]} {e.year}" if s.month != e.month else f"{bl[s.month-1]} {e.year}"
        return f"{bl[s.month-1]} {s.year} – {bl[e.month-1]} {e.year}"

    async def _overlap(start: str, end: str, exclude: Optional[str] = None):
        q = {"archived": {"$ne": True}, "start": {"$lte": end}, "end": {"$gte": start}}
        if exclude:
            q["id"] = {"$ne": exclude}
        o = await db.strategy_periods.find_one(q, {"_id": 0, "nama": 1})
        if o:
            raise HTTPException(400, f"Tanggal bertumpang tindih dengan periode \"{o['nama']}\". Arsipkan atau ubah periode itu dulu.")

    @router.get("/periods")
    async def periods(_: dict = Depends(get_current_user)):
        rows = await db.strategy_periods.find({}, {"_id": 0}).sort("start", -1).to_list(200)
        for r in rows:
            r["expected_pct"] = _elapsed(r)
        return rows

    @router.post("/periods")
    async def create_period(payload: PeriodIn, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        _check_dates(payload.start, payload.end)
        await _overlap(payload.start, payload.end)
        doc = {"id": str(uuid.uuid4()), "nama": (payload.nama or "").strip() or _auto_nama(payload.start, payload.end),
               "start": payload.start, "end": payload.end, "active": False, "archived": False, "created_at": _now()}
        await db.strategy_periods.insert_one(doc)
        if payload.active:
            await db.strategy_periods.update_many({}, {"$set": {"active": False}})
            await db.strategy_periods.update_one({"id": doc["id"]}, {"$set": {"active": True}})
            doc["active"] = True
        doc.pop("_id", None)
        return doc

    @router.put("/periods/{pid}")
    async def update_period(pid: str, payload: PeriodIn, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        _check_dates(payload.start, payload.end)
        await _overlap(payload.start, payload.end, exclude=pid)
        upd = {"start": payload.start, "end": payload.end, "nama": (payload.nama or "").strip() or _auto_nama(payload.start, payload.end)}
        r = await db.strategy_periods.find_one_and_update({"id": pid}, {"$set": upd}, return_document=True, projection={"_id": 0})
        if not r:
            raise HTTPException(404, "Periode tidak ditemukan.")
        return r

    @router.post("/periods/{pid}/activate")
    async def activate(pid: str, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        p = await _period(pid)
        await db.strategy_periods.update_many({}, {"$set": {"active": False}})
        await db.strategy_periods.update_one({"id": pid}, {"$set": {"active": True, "archived": False}})
        return {"ok": True, "nama": p["nama"]}

    @router.post("/periods/{pid}/archive")
    async def archive(pid: str, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        await _period(pid)
        await db.strategy_periods.update_one({"id": pid}, {"$set": {"archived": True, "active": False}})
        return {"ok": True}

    @router.post("/periods/{pid}/copy-from/{src}")
    async def copy_sasaran(pid: str, src: str, user: dict = Depends(get_current_user)):
        """Salin sasaran & ukuran (tanpa capaian) dari periode lain — untuk memulai siklus baru."""
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        await _period(pid); await _period(src)
        idmap, n = {}, 0
        for s in await db.sasaran.find({"period_id": src}, {"_id": 0}).to_list(500):
            nid = str(uuid.uuid4()); idmap[s["id"]] = nid
            await db.sasaran.insert_one({**s, "id": nid, "period_id": pid, "created_at": _now(), "disalin_dari": s["id"]})
            n += 1
        for s_old, s_new in idmap.items():
            await db.sasaran.update_many({"period_id": pid, "parent_id": s_old}, {"$set": {"parent_id": s_new}})
        for u in await db.ukuran.find({"period_id": src}, {"_id": 0}).to_list(2000):
            if u["sasaran_id"] in idmap:
                await db.ukuran.insert_one({**u, "id": str(uuid.uuid4()), "sasaran_id": idmap[u["sasaran_id"]], "period_id": pid,
                                            "awal": u.get("capaian") if u.get("capaian") is not None else u.get("awal"),
                                            "capaian": None, "confidence": None, "last_checkin_at": None, "created_at": _now()})
        return {"ok": True, "sasaran_disalin": n}

    # ------------------------------------------------------------ overview & sasaran
    @router.get("/overview")
    async def overview(period_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        if not period_id:
            p = await db.strategy_periods.find_one({"active": True}, {"_id": 0, "id": 1})
            if not p:
                return {"period": None, "sasaran": [], "stats": {}, "ukuran_saya": [], "checkin_saya_perlu": [],
                        "bisa_buat": (await user_scope(user))["is_spv"], "perspektif_opsi": PERSPEKTIF, "arah_opsi": ARAH}
            period_id = p["id"]
        return await _overview(period_id, user)

    @router.post("")
    async def create_sasaran(payload: SasaranIn, user: dict = Depends(get_current_user)):
        data = payload.model_dump()
        _validate_s(data)
        await _period(data["period_id"])
        await _require_create(user, data["level"], data.get("divisi_id"))
        if data["level"] == "LEMBAGA":
            data["divisi_id"] = None
        n = await db.sasaran.count_documents({"period_id": data["period_id"]})
        doc = {**data, "id": str(uuid.uuid4()), "urutan": n + 1, "created_at": _now()}
        await db.sasaran.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.put("/s/{sid}")
    async def update_sasaran(sid: str, payload: SasaranUpd, user: dict = Depends(get_current_user)):
        s = await db.sasaran.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(404, "Sasaran tidak ditemukan.")
        scope = await _require_edit(user, s)
        upd = payload.model_dump(exclude_unset=True)
        _validate_s({**s, **upd})
        if not scope["is_spv"] and ("level" in upd and upd["level"] != s.get("level") or "divisi_id" in upd and upd["divisi_id"] != s.get("divisi_id")):
            raise HTTPException(403, "Hanya SPV yang bisa memindahkan sasaran ke level/tim lain.")
        r = await db.sasaran.find_one_and_update({"id": sid}, {"$set": upd}, return_document=True, projection={"_id": 0})
        return r

    @router.delete("/s/{sid}")
    async def delete_sasaran(sid: str, user: dict = Depends(get_current_user)):
        s = await db.sasaran.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(404, "Sasaran tidak ditemukan.")
        scope = await user_scope(user)
        if not (scope["is_spv"] or (s.get("level") == "TIM" and scope["head_divisi_id"] == s.get("divisi_id"))):
            raise HTTPException(403, "Hanya SPV atau kepala tim terkait yang bisa menghapus sasaran.")
        uids = [u["id"] for u in await db.ukuran.find({"sasaran_id": sid}, {"_id": 0, "id": 1}).to_list(500)]
        await db.ukuran_checkins.delete_many({"ukuran_id": {"$in": uids}})
        await db.ukuran.delete_many({"sasaran_id": sid})
        await db.sasaran.update_many({"parent_id": sid}, {"$set": {"parent_id": None}})
        await db.tasks.update_many({"sasaran_id": sid}, {"$set": {"sasaran_id": None}})
        await db.sasaran.delete_one({"id": sid})
        return {"ok": True}

    # ------------------------------------------------------------ ukuran & check-in
    @router.post("/s/{sid}/ukuran")
    async def create_ukuran(sid: str, payload: UkuranIn, user: dict = Depends(get_current_user)):
        s = await db.sasaran.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(404, "Sasaran tidak ditemukan.")
        await _require_edit(user, s)
        data = payload.model_dump()
        _validate_u(data)
        n = await db.ukuran.count_documents({"sasaran_id": sid})
        doc = {**data, "id": str(uuid.uuid4()), "sasaran_id": sid, "period_id": s["period_id"],
               "pic_id": data.get("pic_id") or s.get("pj_id"), "capaian": None, "confidence": None,
               "last_checkin_at": None, "urutan": n + 1, "created_at": _now()}
        await db.ukuran.insert_one(doc)
        doc.pop("_id", None)
        return doc

    async def _ukuran_and_sasaran(uid: str):
        u = await db.ukuran.find_one({"id": uid}, {"_id": 0})
        if not u:
            raise HTTPException(404, "Ukuran tidak ditemukan.")
        s = await db.sasaran.find_one({"id": u["sasaran_id"]}, {"_id": 0}) or {}
        return u, s

    @router.put("/ukuran/{uid}")
    async def update_ukuran(uid: str, payload: UkuranUpd, user: dict = Depends(get_current_user)):
        u, s = await _ukuran_and_sasaran(uid)
        await _require_edit(user, s)
        upd = payload.model_dump(exclude_unset=True)
        _validate_u(upd)
        return await db.ukuran.find_one_and_update({"id": uid}, {"$set": upd}, return_document=True, projection={"_id": 0})

    @router.delete("/ukuran/{uid}")
    async def delete_ukuran(uid: str, user: dict = Depends(get_current_user)):
        u, s = await _ukuran_and_sasaran(uid)
        await _require_edit(user, s)
        await db.ukuran_checkins.delete_many({"ukuran_id": uid})
        await db.ukuran.delete_one({"id": uid})
        return {"ok": True}

    async def do_checkin(uid: str, payload: CheckinIn, user: dict) -> dict:
        u, s = await _ukuran_and_sasaran(uid)
        scope = await user_scope(user)
        allowed = (scope["is_spv"] or (scope["anggota_id"] and scope["anggota_id"] in (u.get("pic_id"), s.get("pj_id")))
                   or (scope["head_divisi_id"] and s.get("divisi_id") == scope["head_divisi_id"]))
        if not allowed:
            raise HTTPException(403, "Check-in hanya oleh PIC ukuran, penanggung jawab sasaran, kepala tim, atau SPV.")
        if payload.confidence not in CONFIDENCE:
            raise HTTPException(400, "Keyakinan harus YAKIN, RAGU, atau BERISIKO.")
        now = _now()
        await db.ukuran_checkins.insert_one({"id": str(uuid.uuid4()), "ukuran_id": uid, "nilai": payload.nilai,
                                             "confidence": payload.confidence, "catatan": payload.catatan.strip(),
                                             "user_id": user["user_id"], "actor_name": user.get("name") or user.get("email"), "at": now})
        r = await db.ukuran.find_one_and_update({"id": uid}, {"$set": {"capaian": payload.nilai, "confidence": payload.confidence,
                                                                        "last_checkin_at": now, "catatan_terakhir": payload.catatan.strip()}},
                                                return_document=True, projection={"_id": 0})
        period = await _period(u["period_id"])
        ang, _ = await _maps()
        return _decorate_u(r, _elapsed(period), ang)

    @router.post("/ukuran/{uid}/checkin")
    async def checkin(uid: str, payload: CheckinIn, user: dict = Depends(get_current_user)):
        return await do_checkin(uid, payload, user)

    @router.get("/ukuran/{uid}/checkins")
    async def checkins(uid: str, _: dict = Depends(get_current_user)):
        return await db.ukuran_checkins.find({"ukuran_id": uid}, {"_id": 0}).sort("at", 1).to_list(500)

    # ------------------------------------------------------------ evaluasi, visi, PDF
    @router.get("/evaluasi")
    async def evaluasi(period_id: str, user: dict = Depends(get_current_user)):
        ov = await _overview(period_id, user)
        uids = [u["id"] for s in ov["sasaran"] for u in s["ukuran"]]
        hist = {}
        for c in await db.ukuran_checkins.find({"ukuran_id": {"$in": uids}}, {"_id": 0}).sort("at", 1).to_list(5000):
            hist.setdefault(c["ukuran_id"], []).append(c)
        for s in ov["sasaran"]:
            for u in s["ukuran"]:
                h = hist.get(u["id"], [])
                u["riwayat"] = [{"nilai": c["nilai"], "at": c["at"], "confidence": c["confidence"], "catatan": c.get("catatan", "")} for c in h]
                u["jumlah_checkin"] = len(h)
        note = await db.strategy_evaluations.find_one({"period_id": period_id}, {"_id": 0}) or {
            "period_id": period_id, "summary": "", "kesimpulan": "NETRAL", "highlights": [], "improvements": [], "next_focus": []}
        return {**ov, "catatan": note}

    @router.put("/evaluasi")
    async def save_evaluasi(period_id: str, payload: EvalIn, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        upd = {**payload.model_dump(exclude_unset=True), "period_id": period_id, "updated_at": _now()}
        await db.strategy_evaluations.update_one({"period_id": period_id}, {"$set": upd}, upsert=True)
        return await db.strategy_evaluations.find_one({"period_id": period_id}, {"_id": 0})

    @router.get("/visi")
    async def get_visi(_: dict = Depends(get_current_user)):
        return await db.strategy_vision.find_one({"period_id": "GLOBAL"}, {"_id": 0}) or {"period_id": "GLOBAL", "visi": "", "misi": [], "nilai": []}

    @router.put("/visi")
    async def put_visi(payload: VisiIn, user: dict = Depends(get_current_user)):
        if not (await user_scope(user))["is_spv"]:
            raise HTTPException(403, "Hanya SPV.")
        upd = {**payload.model_dump(exclude_unset=True), "period_id": "GLOBAL", "updated_at": _now()}
        await db.strategy_vision.update_one({"period_id": "GLOBAL"}, {"$set": upd}, upsert=True)
        return await db.strategy_vision.find_one({"period_id": "GLOBAL"}, {"_id": 0})

    @router.get("/pdf/{jenis}")
    async def pdf(jenis: str, period_id: str, divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        if jenis not in ("komitmen", "evaluasi"):
            raise HTTPException(404, "Jenis PDF tidak dikenal.")
        from sasaran_pdf import build_sasaran_pdf
        data = await evaluasi(period_id, user)
        if divisi_id:
            data["sasaran"] = [s for s in data["sasaran"] if s.get("level") == "LEMBAGA" or s.get("divisi_id") == divisi_id]
        visi = await get_visi(user)
        div = await db.divisi.find_one({"id": divisi_id}, {"_id": 0, "nama": 1}) if divisi_id else None
        buf = build_sasaran_pdf(jenis, data, visi, div.get("nama") if div else None)
        safe = re.sub(r"[^A-Za-z0-9]+", "-", data["period"]["nama"]).strip("-")
        fname = f"{jenis}-{safe}.pdf"
        return StreamingResponse(io.BytesIO(buf), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    router.do_checkin = do_checkin  # dipakai tool MCP
    router.overview_fn = _overview
    return router
