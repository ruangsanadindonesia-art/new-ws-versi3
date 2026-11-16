"""Ritme Target: Rapat Target Mingguan, daftar isu, dan komitmen mingguan.

Alur rapat (agenda tetap, 30–45 menit):
 1. Papan skor   — hanya KR merah/kuning dibahas; pemilik angka menjelaskan penyebab.
 2. Komitmen lalu — setiap orang menjawab selesai / tidak untuk komitmen pekan lalu (status tugas).
 3. Isu (IDS)     — Identify, Discuss, Solve: isu dibahas sampai ada keputusan + penanggung jawab.
 4. Komitmen baru — 1–2 per orang, otomatis menjadi tugas (R = orangnya, A = fasilitator).
 5. Penutup       — nilai rapat 1–10 dan catatan.

Koleksi: rapat_target, isu_target; komitmen = tasks dengan field komitmen_rapat_id.
Akses: lihat = SPV & kepala tim; ubah = SPV.
"""
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_ritme_router(srv) -> APIRouter:
    db = srv.db
    get_current_user, user_scope = srv.get_current_user, srv.user_scope
    router = APIRouter(prefix="/ritme", tags=["ritme"])

    class RapatIn(BaseModel):
        tanggal: Optional[str] = None

    class IsuIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: str = Field(min_length=3, max_length=300)
        ukuran_id: Optional[str] = None

    class IsuUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        keputusan: Optional[str] = None
        pj_id: Optional[str] = None
        status: Optional[str] = None  # TERBUKA | SELESAI

    class KomitmenIn(BaseModel):
        penerima_id: str
        nama: str = Field(min_length=3, max_length=300)
        deadline: Optional[str] = None
        sasaran_id: Optional[str] = None
        isu_id: Optional[str] = None

    class SelesaiIn(BaseModel):
        nilai: Optional[int] = Field(default=None, ge=1, le=10)
        catatan: str = ""

    async def _scope(user, write=False):
        sc = await user_scope(user)
        if write and not sc["is_spv"]:
            raise HTTPException(403, "Hanya SPV yang menjalankan rapat target.")
        if not (sc["is_spv"] or sc["head_divisi_id"]):
            raise HTTPException(403, "Hanya SPV dan kepala tim.")
        return sc

    async def _active_period():
        p = await db.strategy_periods.find_one({"active": True}, {"_id": 0})
        if not p:
            raise HTTPException(400, "Belum ada periode aktif di Target Bersama.")
        return p

    async def _anggota_nama():
        return {a["id"]: a["nama"] for a in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}

    def _week(d: date) -> str:
        y, w, _ = d.isocalendar()
        return f"{y}-W{w:02d}"

    async def _auto_isu(period_id: str, rapat_id: str, user: dict) -> int:
        """KR At risk / Off track yang belum punya isu terbuka -> isu baru."""
        pap = await srv.sasaran_router.papan_fn(period_id, user)
        n = 0
        for r in pap["baris"]:
            if r["status"] not in ("PERHATIAN", "TERTINGGAL"):
                continue
            if await db.isu_target.find_one({"ukuran_id": r["id"], "status": "TERBUKA"}):
                continue
            label = "Off track" if r["status"] == "TERTINGGAL" else "At risk"
            await db.isu_target.insert_one({"id": str(uuid.uuid4()), "period_id": period_id, "ukuran_id": r["id"],
                                            "judul": f"{label}: {r['nama']} ({r['capaian']} dari target {r['target']} {r.get('satuan') or ''})".strip(),
                                            "status": "TERBUKA", "keputusan": "", "pj_id": r.get("pic_id"), "sumber": "otomatis",
                                            "rapat_dibuat": rapat_id, "created_at": _now()})
            n += 1
        return n

    @router.get("/rapat")
    async def list_rapat(user: dict = Depends(get_current_user)):
        await _scope(user)
        p = await _active_period()
        rows = await db.rapat_target.find({"period_id": p["id"]}, {"_id": 0}).sort("tanggal", -1).to_list(100)
        return {"period": p, "rapat": rows}

    @router.post("/rapat")
    async def mulai_rapat(payload: RapatIn, user: dict = Depends(get_current_user)):
        await _scope(user, write=True)
        p = await _active_period()
        tgl = payload.tanggal or date.today().isoformat()
        minggu = _week(date.fromisoformat(tgl))
        ex = await db.rapat_target.find_one({"period_id": p["id"], "minggu": minggu}, {"_id": 0})
        if ex:
            return ex
        st = await db.target_settings.find_one({"id": "ritme"}, {"_id": 0}) or {}
        doc = {"id": str(uuid.uuid4()), "period_id": p["id"], "tanggal": tgl, "minggu": minggu, "status": "BERLANGSUNG",
               "fasilitator_id": st.get("fasilitator_id"), "nilai": None, "catatan": "", "mulai_at": _now(),
               "selesai_at": None, "dibuat_oleh": user.get("name")}
        await db.rapat_target.insert_one(doc)
        doc.pop("_id", None)
        doc["isu_otomatis_baru"] = await _auto_isu(p["id"], doc["id"], user)
        return doc

    async def _komitmen(rapat_id: str, nama: dict) -> list:
        rows = await db.tasks.find({"komitmen_rapat_id": rapat_id}, {"_id": 0, "id": 1, "nama": 1, "status": 1, "deadline": 1,
                                                                     "penerima_tugas_id": 1, "sasaran_id": 1}).to_list(200)
        return [{**t, "R": nama.get(t.get("penerima_tugas_id")), "selesai": t.get("status") == "SELESAI"} for t in rows]

    @router.get("/rapat/{rid}")
    async def detail_rapat(rid: str, user: dict = Depends(get_current_user)):
        await _scope(user)
        r = await db.rapat_target.find_one({"id": rid}, {"_id": 0})
        if not r:
            raise HTTPException(404, "Rapat tidak ditemukan.")
        nama = await _anggota_nama()
        pap = await srv.sasaran_router.papan_fn(r["period_id"], user)
        urut = {"TERTINGGAL": 0, "PERHATIAN": 1}
        perhatian = sorted([x for x in pap["baris"] if x["status"] in urut], key=lambda x: (urut[x["status"]], x["jenis"] != "LEAD"))
        belum = [{"id": x["id"], "nama": x["nama"], "pic": (x.get("pic") or {}).get("nama")} for x in pap["baris"] if x["perlu_update"]]
        prev = await db.rapat_target.find_one({"period_id": r["period_id"], "tanggal": {"$lt": r["tanggal"]}}, {"_id": 0}, sort=[("tanggal", -1)])
        isu = await db.isu_target.find({"period_id": r["period_id"], "$or": [{"status": "TERBUKA"}, {"rapat_selesai": rid}]}, {"_id": 0}).sort("created_at", 1).to_list(200)
        for i in isu:
            i["pj_nama"] = nama.get(i.get("pj_id"))
        # disiplin komitmen 4 rapat terakhir
        last4 = await db.rapat_target.find({"period_id": r["period_id"], "tanggal": {"$lt": r["tanggal"]}}, {"_id": 0, "id": 1}).sort("tanggal", -1).to_list(4)
        per_orang = {}
        for rr in last4:
            for k in await _komitmen(rr["id"], nama):
                o = per_orang.setdefault(k.get("R") or "-", {"total": 0, "selesai": 0})
                o["total"] += 1
                o["selesai"] += 1 if k["selesai"] else 0
        st = await db.target_settings.find_one({"id": "ritme"}, {"_id": 0}) or {}
        return {"rapat": {**r, "fasilitator_nama": nama.get(r.get("fasilitator_id") or st.get("fasilitator_id"))},
                "papan_perhatian": perhatian, "belum_checkin": belum, "jumlah_kr": len(pap["baris"]),
                "komitmen_lalu": await _komitmen(prev["id"], nama) if prev else [], "rapat_lalu": prev,
                "isu": isu, "komitmen_ini": await _komitmen(rid, nama),
                "disiplin_komitmen": [{"nama": k, **v, "pct": round(v["selesai"] / v["total"] * 100) if v["total"] else None} for k, v in per_orang.items()]}

    @router.post("/isu")
    async def tambah_isu(payload: IsuIn, user: dict = Depends(get_current_user)):
        await _scope(user)
        p = await _active_period()
        doc = {"id": str(uuid.uuid4()), "period_id": p["id"], "ukuran_id": payload.ukuran_id, "judul": payload.judul.strip(),
               "status": "TERBUKA", "keputusan": "", "pj_id": None, "sumber": "manual", "created_at": _now(), "dibuat_oleh": user.get("name")}
        await db.isu_target.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.put("/isu/{iid}")
    async def ubah_isu(iid: str, payload: IsuUpd, rapat_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        await _scope(user, write=True)
        upd = payload.model_dump(exclude_unset=True)
        if upd.get("status") and upd["status"] not in ("TERBUKA", "SELESAI"):
            raise HTTPException(400, "Status isu TERBUKA atau SELESAI.")
        if upd.get("status") == "SELESAI":
            upd["selesai_at"] = _now()
            if rapat_id:
                upd["rapat_selesai"] = rapat_id
        r = await db.isu_target.find_one_and_update({"id": iid}, {"$set": upd}, return_document=True, projection={"_id": 0})
        if not r:
            raise HTTPException(404, "Isu tidak ditemukan.")
        return r

    @router.post("/rapat/{rid}/komitmen")
    async def tambah_komitmen(rid: str, payload: KomitmenIn, user: dict = Depends(get_current_user)):
        sc = await _scope(user, write=True)
        r = await db.rapat_target.find_one({"id": rid}, {"_id": 0})
        if not r:
            raise HTTPException(404, "Rapat tidak ditemukan.")
        if not await db.anggota.find_one({"id": payload.penerima_id}, {"_id": 1}):
            raise HTTPException(400, "Anggota tidak ditemukan.")
        st = await db.target_settings.find_one({"id": "ritme"}, {"_id": 0}) or {}
        a_id = st.get("fasilitator_id") or sc["anggota_id"]
        deadline = payload.deadline or (date.fromisoformat(r["tanggal"]) + timedelta(days=6)).isoformat()
        tb = srv.TaskBase(nama=payload.nama.strip(), kategori="PROJECT", penerima_tugas_id=payload.penerima_id, pemberi_id=a_id,
                          deadline=deadline, sasaran_id=payload.sasaran_id or None,
                          catatan_tim=f"Komitmen Rapat Target {r['tanggal']}. Laporkan selesai/tidak di rapat berikutnya.")
        t = await srv.create_task(tb, user)
        t = t if isinstance(t, dict) else t.model_dump()
        await db.tasks.update_one({"id": t["id"]}, {"$set": {"komitmen_rapat_id": rid, "isu_id": payload.isu_id}})
        if payload.isu_id:
            await db.isu_target.update_one({"id": payload.isu_id}, {"$addToSet": {"task_ids": t["id"]}})
        return {"ok": True, "task_id": t["id"], "deadline": deadline}

    @router.post("/rapat/{rid}/selesai")
    async def selesai_rapat(rid: str, payload: SelesaiIn, user: dict = Depends(get_current_user)):
        await _scope(user, write=True)
        r = await db.rapat_target.find_one_and_update({"id": rid}, {"$set": {"status": "SELESAI", "nilai": payload.nilai,
                                                                             "catatan": payload.catatan.strip(), "selesai_at": _now()}},
                                                      return_document=True, projection={"_id": 0})
        if not r:
            raise HTTPException(404, "Rapat tidak ditemukan.")
        return r

    return router
