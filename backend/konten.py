"""Produksi Konten (tim Multimedia): satu konten = satu kartu; tiap tahap otomatis menjadi tugas.

Tahap baku (deadline dihitung mundur dari tanggal tayang; bisa diubah di pengaturan):
  NASKAH (H-5) -> TASHIH (H-4) -> PRODUKSI (H-2) -> APPROVAL (H-1) -> POSTING (H) -> LAPORAN (H+3)
Tahap konten = tahap pertama yang tugasnya belum Selesai. Keterlambatan terpantau di Tugas & Pusat Kendali.
Akses: SPV + anggota tim konten (default divisi "Multimedia"). Buat/hapus/pengaturan/impor: kepala tim atau SPV.
"""
import csv
import io
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

TAHAP = ["NASKAH", "TASHIH", "PRODUKSI", "APPROVAL", "POSTING", "LAPORAN"]
LABEL = {"NASKAH": "Naskah", "TASHIH": "Tashih guru", "PRODUKSI": "Produksi & edit", "APPROVAL": "Approval",
         "POSTING": "Posting", "LAPORAN": "Laporan 72 jam"}
INSTRUKSI = {
    "NASKAH": "Tulis naskah + caption + CTA di Google Doc, tempel link naskah di kartu konten.",
    "TASHIH": "Kirim naskah ke guru untuk ditashih (tajwid/hadits/sanad). Catat nama guru di kartu konten (tombol Tashih).",
    "PRODUKSI": "Shooting/desain dan editing sesuai naskah & brand (teal #0B5C61, gold #B8923B). Tempel link hasil di kartu konten.",
    "APPROVAL": "Cek akhir: materi sesuai tashih, subtitle, cover, caption, CTA. Selesai = siap tayang.",
    "POSTING": "Posting/jadwalkan di semua platform tujuan, lalu tempel link tiap platform di kartu konten.",
    "LAPORAN": "Isi performa 72 jam setelah tayang (views, reach, interaksi, DM/leads).",
}
OFFSET = {"NASKAH": -5, "TASHIH": -4, "PRODUKSI": -2, "APPROVAL": -1, "POSTING": 0, "LAPORAN": 3}
PLATFORM = {"IG": "Instagram", "TIKTOK": "TikTok", "SHORT": "YT Short", "YT": "YouTube"}
BULAN = {"januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6, "juli": 7, "agustus": 8,
         "september": 9, "oktober": 10, "november": 11, "desember": 12}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tgl_indo(s: str) -> Optional[str]:
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", s or "")
    if not m or m.group(2).lower() not in BULAN:
        return None
    try:
        return date(int(m.group(3)), BULAN[m.group(2).lower()], int(m.group(1))).isoformat()
    except ValueError:
        return None


def jadwal(tayang: date, offsets: Dict[str, int], hari_ini: Optional[date] = None) -> Dict[str, str]:
    """Deadline per tahap. Bila tanggal tayang terlalu dekat, tahap sebelum tayang dipadatkan secara proporsional
    antara hari ini dan tanggal tayang (tidak ada deadline yang sudah lewat saat konten dibuat/digeser)."""
    hari_ini = hari_ini or date.today()
    off = {t: offsets.get(t, OFFSET[t]) for t in TAHAP}
    terjauh = -min(off.values())  # mis. 5 (H-5)
    tersedia = (tayang - hari_ini).days
    out = {}
    for t in TAHAP:
        o = off[t]
        if o < 0 and terjauh > 0 and tersedia < terjauh:
            o = -int(max(0, tersedia) * (-o) / terjauh)  # skala ke rentang yang tersedia
        out[t] = max(tayang + timedelta(days=o), hari_ini if o < 0 else tayang + timedelta(days=o)).isoformat()
    return out


PERFORMA_FIELD = ["views", "reach", "likes", "comments", "saves", "shares", "follows", "dm"]


def build_konten_router(srv) -> APIRouter:
    db = srv.db
    get_current_user, user_scope = srv.get_current_user, srv.user_scope
    router = APIRouter(prefix="/konten", tags=["konten"])

    # ------------------------------------------------------------------ pengaturan & akses
    async def _settings() -> dict:
        st = await db.konten_settings.find_one({"id": "utama"}, {"_id": 0})
        if st:
            return st
        div = await db.divisi.find_one({"nama": {"$regex": "^multimedia$", "$options": "i"}}, {"_id": 0, "id": 1, "head_anggota_id": 1})
        pic: Dict[str, Optional[str]] = {k: None for k in TAHAP}
        if div:
            ang = await db.anggota.find({"divisi_id": div["id"]}, {"_id": 0, "id": 1, "nama": 1}).to_list(50)
            cari = lambda kata: next((a["id"] for a in ang if kata in a["nama"].lower()), None)  # noqa: E731
            lead = div.get("head_anggota_id") or cari("indhy")
            pic = {"NASKAH": lead, "TASHIH": lead, "PRODUKSI": cari("rizki") or lead, "APPROVAL": lead,
                   "POSTING": cari("fatya") or lead, "LAPORAN": cari("fatya") or lead}
        st = {"id": "utama", "divisi_id": div["id"] if div else None, "pic": pic, "offset": dict(OFFSET), "updated_at": _now()}
        await db.konten_settings.insert_one(dict(st))
        st.pop("_id", None)
        return st

    async def _akses(user: dict, kelola: bool = False) -> dict:
        sc = await user_scope(user)
        st = await _settings()
        anggota_tim = bool(st.get("divisi_id")) and sc["divisi_id"] == st["divisi_id"]
        lead = sc["is_spv"] or (bool(st.get("divisi_id")) and sc["head_divisi_id"] == st["divisi_id"])
        if not (sc["is_spv"] or anggota_tim):
            raise HTTPException(403, "Produksi Konten khusus tim Multimedia dan SPV.")
        if kelola and not lead:
            raise HTTPException(403, "Hanya kepala tim Multimedia atau SPV.")
        return {**sc, "st": st, "lead": lead}

    router.akses_fn = _akses

    class KontenIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: str = Field(min_length=3, max_length=300)
        tanggal_tayang: str
        jenis: str = "ORGANIK"  # ORGANIK | KOLAB
        pilar: str = ""
        bucket: str = ""   # VALUE | HUMAN | SELL
        funnel: str = ""   # Awareness | Consideration | Conversion
        format: str = ""   # Reels | Carousel | Single post | Video panjang
        platforms: List[str] = Field(default_factory=lambda: ["IG", "TIKTOK", "SHORT"])
        cta_keyword: str = ""
        brief: str = Field(default="", max_length=3000)
        naskah_url: str = ""

    class KontenUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        tanggal_tayang: Optional[str] = None
        jenis: Optional[str] = None
        pilar: Optional[str] = None
        bucket: Optional[str] = None
        funnel: Optional[str] = None
        format: Optional[str] = None
        platforms: Optional[List[str]] = None
        cta_keyword: Optional[str] = None
        brief: Optional[str] = None
        naskah_url: Optional[str] = None
        aset_url: Optional[str] = None
        links: Optional[Dict[str, str]] = None

    class TashihIn(BaseModel):
        guru: str = Field(min_length=2, max_length=120)
        catatan: str = Field(default="", max_length=500)

    class PengaturanIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        pic: Optional[Dict[str, Optional[str]]] = None
        offset: Optional[Dict[str, int]] = None

    def _cek_tanggal(t: str) -> date:
        try:
            return date.fromisoformat(t)
        except (ValueError, TypeError):
            raise HTTPException(400, "Tanggal tayang tidak valid (format YYYY-MM-DD).")

    def _cek_platform(p: List[str]) -> List[str]:
        p = [x for x in dict.fromkeys(p or []) if x in PLATFORM]
        if not p:
            raise HTTPException(400, "Pilih minimal satu platform.")
        return p

    async def _kode_baru() -> str:
        mx = 0
        async for k in db.konten.find({}, {"_id": 0, "kode": 1}):
            m = re.match(r"RS-(\d+)", k.get("kode") or "")
            if m:
                mx = max(mx, int(m.group(1)))
        # Konten baru mulai RS-200 agar tidak bentrok dengan kode lama di spreadsheet (s.d. RS-18x) yang mungkin diimpor kemudian.
        return f"RS-{max(mx + 1, 200):03d}"

    async def _buat_tugas(k: dict, user: dict, selesai: Optional[List[str]] = None) -> Dict[str, str]:
        st = await _settings()
        tayang = date.fromisoformat(k["tanggal_tayang"])
        sc = await user_scope(user)
        ids = {}
        jd = jadwal(tayang, st.get("offset") or OFFSET)
        for t in TAHAP:
            r_id = (st.get("pic") or {}).get(t) or sc["anggota_id"]
            if not r_id:
                raise HTTPException(400, f"PIC tahap {LABEL[t]} belum diatur di pengaturan Produksi Konten.")
            dl = jd[t]
            tb = srv.TaskBase(nama=f"[{k['kode']}] {LABEL[t]}: {k['judul']}"[:300], kategori="PROJECT",
                              penerima_tugas_id=r_id, pemberi_id=r_id, deadline=dl,
                              catatan_tim=INSTRUKSI[t] + (f"\nNaskah: {k['naskah_url']}" if k.get("naskah_url") else ""))
            task = await srv.create_task(tb, user)
            task = task if isinstance(task, dict) else task.model_dump()
            upd = {"konten_id": k["id"], "konten_tahap": t}
            if selesai and t in selesai:
                upd.update({"status": "SELESAI", "selesai_at": _now()})
            await db.tasks.update_one({"id": task["id"]}, {"$set": upd})
            ids[t] = task["id"]
        return ids

    async def _hiasi(rows: List[dict]) -> List[dict]:
        tids = [tid for k in rows for tid in (k.get("task_ids") or {}).values()]
        tasks = {t["id"]: t for t in await db.tasks.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "status": 1, "deadline": 1,
                                                                                   "penerima_tugas_id": 1, "selesai_at": 1}).to_list(10000)}
        amap = {a["id"]: a["nama"] for a in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        today = date.today().isoformat()
        for k in rows:
            tahapan, sekarang, telat = [], None, False
            for t in TAHAP:
                task = tasks.get((k.get("task_ids") or {}).get(t))
                if not task:
                    continue
                done = task.get("status") == "SELESAI"
                lewat = not done and bool(task.get("deadline")) and task["deadline"] < today
                telat = telat or lewat
                if not done and sekarang is None:
                    sekarang = t
                tahapan.append({"tahap": t, "label": LABEL[t], "task_id": task["id"], "status": task.get("status"), "selesai": done,
                                "deadline": task.get("deadline"), "telat": lewat, "pic_id": task.get("penerima_tugas_id"),
                                "pic_nama": amap.get(task.get("penerima_tugas_id"))})
            if k.get("status") in ("ARSIP", "BATAL"):
                sekarang = k["status"]
            k["tahap"] = sekarang or ("SELESAI" if tahapan else "ARSIP")
            k["tahap_label"] = {"ARSIP": "Arsip (sudah tayang)", "BATAL": "Dibatalkan", "SELESAI": "Selesai"}.get(k["tahap"], LABEL.get(k["tahap"]))
            k["tahapan"] = tahapan
            k["terlambat"] = telat and k["tahap"] not in ("ARSIP", "BATAL")
            k["progres"] = round(sum(1 for x in tahapan if x["selesai"]) / len(tahapan) * 100) if tahapan else 100
        return rows

    # ------------------------------------------------------------------ endpoint
    @router.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        a = await _akses(user)
        st = a["st"]
        amap = {x["id"]: x["nama"] for x in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        return {"tahap": [{"k": t, "label": LABEL[t], "offset": (st.get("offset") or OFFSET).get(t), "pic_id": (st.get("pic") or {}).get(t),
                           "pic_nama": amap.get((st.get("pic") or {}).get(t)), "instruksi": INSTRUKSI[t]} for t in TAHAP],
                "platform": PLATFORM, "bisa_kelola": a["lead"], "divisi_id": st.get("divisi_id")}

    @router.get("")
    async def daftar(dari: Optional[str] = None, sampai: Optional[str] = None, q: Optional[str] = None,
                     arsip: bool = False, user: dict = Depends(get_current_user)):
        await _akses(user)
        f: dict = {} if arsip else {"status": "AKTIF"}
        if dari or sampai:
            f["tanggal_tayang"] = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
        if q:
            rx = {"$regex": re.escape(q), "$options": "i"}
            f["$or"] = [{"judul": rx}, {"kode": rx}, {"pilar": rx}]
        rows = await db.konten.find(f, {"_id": 0}).sort("tanggal_tayang", 1).to_list(3000)
        return await _hiasi(rows)

    @router.post("")
    async def buat(payload: KontenIn, user: dict = Depends(get_current_user)):
        await _akses(user, kelola=True)
        _cek_tanggal(payload.tanggal_tayang)
        doc = {**payload.model_dump(), "platforms": _cek_platform(payload.platforms), "id": str(uuid.uuid4()),
               "kode": await _kode_baru(), "status": "AKTIF", "links": {}, "aset_url": "", "tashih": None,
               "sumber": "workspace", "dibuat_oleh": user.get("name"), "created_at": _now()}
        doc["judul"] = doc["judul"].strip()
        await db.konten.insert_one(dict(doc))
        doc["task_ids"] = await _buat_tugas(doc, user)
        await db.konten.update_one({"id": doc["id"]}, {"$set": {"task_ids": doc["task_ids"]}})
        doc.pop("_id", None)
        return (await _hiasi([doc]))[0]

    @router.get("/{kid}")
    async def detail(kid: str, user: dict = Depends(get_current_user)):
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        return (await _hiasi([k]))[0]

    async def _selesaikan(k: dict, tahap: str, user: dict):
        tid = (k.get("task_ids") or {}).get(tahap)
        t = await db.tasks.find_one({"id": tid}, {"_id": 0}) if tid else None
        if t and t.get("status") != "SELESAI":
            try:
                await srv.update_task(tid, srv.TaskUpdate(status="SELESAI"), user)
            except HTTPException:
                pass  # bukan R/SPV: biarkan PIC yang menandai selesai di Tugas

    @router.put("/{kid}")
    async def ubah(kid: str, payload: KontenUpd, user: dict = Depends(get_current_user)):
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        upd = payload.model_dump(exclude_unset=True)
        if "platforms" in upd:
            upd["platforms"] = _cek_platform(upd["platforms"])
        if "links" in upd:
            upd["links"] = {p: (u or "").strip() for p, u in (upd["links"] or {}).items() if p in PLATFORM}
        if upd.get("tanggal_tayang") and upd["tanggal_tayang"] != k.get("tanggal_tayang"):
            baru = _cek_tanggal(upd["tanggal_tayang"])
            st = await _settings()
            jd = jadwal(baru, st.get("offset") or OFFSET)
            for t, tid in (k.get("task_ids") or {}).items():
                dl = jd[t]
                await db.tasks.update_one({"id": tid, "status": {"$ne": "SELESAI"}}, {"$set": {"deadline": dl, "updated_at": _now()}})
        if upd.get("judul"):
            upd["judul"] = upd["judul"].strip()
            for t, tid in (k.get("task_ids") or {}).items():
                await db.tasks.update_one({"id": tid}, {"$set": {"nama": f"[{k['kode']}] {LABEL[t]}: {upd['judul']}"[:300]}})
        upd["updated_at"] = _now()
        k2 = await db.konten.find_one_and_update({"id": kid}, {"$set": upd}, return_document=True, projection={"_id": 0})
        # Semua platform tujuan sudah punya link -> tahap Posting otomatis selesai.
        if "links" in upd and k2.get("status") == "AKTIF" and all((k2.get("links") or {}).get(p) for p in k2.get("platforms") or []):
            await _selesaikan(k2, "POSTING", user)
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.post("/{kid}/tashih")
    async def tashih(kid: str, payload: TashihIn, user: dict = Depends(get_current_user)):
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        await db.konten.update_one({"id": kid}, {"$set": {"tashih": {"guru": payload.guru.strip(), "catatan": payload.catatan.strip(),
                                                                       "oleh": user.get("name"), "at": _now()}}})
        tid = (k.get("task_ids") or {}).get("TASHIH")
        if tid:
            await srv.add_comment(tid, srv.CommentPayload(text=f"Ditashih oleh {payload.guru.strip()}. {payload.catatan.strip()}".strip()), user)
        await _selesaikan(k, "TASHIH", user)
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.get("/jadwal/pratinjau")
    async def pratinjau(tanggal_tayang: str, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        tayang = _cek_tanggal(tanggal_tayang)
        off = a["st"].get("offset") or OFFSET
        jd = jadwal(tayang, off)
        normal = {t: (tayang + timedelta(days=off.get(t, OFFSET[t]))).isoformat() for t in TAHAP}
        return {"deadline": jd, "dipadatkan": jd != normal, "minimal_hari": -min(off.values())}

    class PerformaIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        platform: str
        views: Optional[int] = Field(default=None, ge=0)
        reach: Optional[int] = Field(default=None, ge=0)
        likes: Optional[int] = Field(default=None, ge=0)
        comments: Optional[int] = Field(default=None, ge=0)
        saves: Optional[int] = Field(default=None, ge=0)
        shares: Optional[int] = Field(default=None, ge=0)
        follows: Optional[int] = Field(default=None, ge=0)
        dm: Optional[int] = Field(default=None, ge=0)

    @router.put("/{kid}/performa")
    async def isi_performa(kid: str, payload: PerformaIn, user: dict = Depends(get_current_user)):
        """Performa 72 jam per platform. Semua platform tujuan terisi -> tahap Laporan otomatis selesai."""
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        if payload.platform not in PLATFORM:
            raise HTTPException(400, "Platform tidak dikenal.")
        data = {f: getattr(payload, f) for f in PERFORMA_FIELD if getattr(payload, f) is not None}
        if not data:
            raise HTTPException(400, "Isi minimal satu angka.")
        data.update({"diisi_at": _now(), "oleh": user.get("name")})
        await db.konten.update_one({"id": kid}, {"$set": {f"performa.{payload.platform}": data}})
        k2 = await db.konten.find_one({"id": kid}, {"_id": 0})
        if k2.get("status") == "AKTIF" and all((k2.get("performa") or {}).get(p) for p in k2.get("platforms") or []):
            await _selesaikan(k2, "LAPORAN", user)
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.get("/rekap/performa")
    async def rekap(dari: Optional[str] = None, sampai: Optional[str] = None, user: dict = Depends(get_current_user)):
        """Rekap performa per platform, pilar, format, bucket + konten teratas. Interaksi = likes+comments+saves+shares."""
        await _akses(user)
        f: dict = {"performa": {"$exists": True}}
        if dari or sampai:
            f["tanggal_tayang"] = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
        rows = await db.konten.find(f, {"_id": 0, "id": 1, "kode": 1, "judul": 1, "pilar": 1, "format": 1, "bucket": 1,
                                         "tanggal_tayang": 1, "performa": 1, "cta_keyword": 1}).to_list(5000)
        def kosong():
            return {"konten": 0, "views": 0, "reach": 0, "interaksi": 0, "follows": 0, "dm": 0}
        grup = {"platform": {}, "pilar": {}, "format": {}, "bucket": {}}
        per_konten = []
        for k in rows:
            tot = kosong()
            for p, m in (k.get("performa") or {}).items():
                inter = sum(m.get(x) or 0 for x in ("likes", "comments", "saves", "shares"))
                g = grup["platform"].setdefault(PLATFORM.get(p, p), kosong())
                g["konten"] += 1
                for key, val in (("views", m.get("views") or 0), ("reach", m.get("reach") or 0), ("interaksi", inter),
                                 ("follows", m.get("follows") or 0), ("dm", m.get("dm") or 0)):
                    g[key] += val
                    tot[key] += val
            for dim in ("pilar", "format", "bucket"):
                g = grup[dim].setdefault((k.get(dim) or "—").strip() or "—", kosong())
                g["konten"] += 1
                for key in ("views", "reach", "interaksi", "follows", "dm"):
                    g[key] += tot[key]
            per_konten.append({"id": k["id"], "kode": k["kode"], "judul": k["judul"], "tanggal_tayang": k.get("tanggal_tayang"),
                               "pilar": k.get("pilar"), "format": k.get("format"), **tot})

        def selesaikan(d):
            out = []
            for nama, v in d.items():
                out.append({"nama": nama, **v, "rata_views": round(v["views"] / v["konten"]) if v["konten"] else 0,
                            "er": round(v["interaksi"] / v["reach"] * 100, 1) if v["reach"] else None})
            return sorted(out, key=lambda x: -x["rata_views"])
        return {"jumlah_konten": len(rows), **{d: selesaikan(v) for d, v in grup.items()},
                "top_views": sorted(per_konten, key=lambda x: -x["views"])[:5],
                "top_dm": [x for x in sorted(per_konten, key=lambda x: -x["dm"]) if x["dm"] > 0][:5]}

    @router.post("/{kid}/batal")
    async def batal(kid: str, user: dict = Depends(get_current_user)):
        await _akses(user, kelola=True)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        await db.konten.update_one({"id": kid}, {"$set": {"status": "BATAL", "updated_at": _now()}})
        await db.tasks.update_many({"id": {"$in": list((k.get("task_ids") or {}).values())}, "status": {"$ne": "SELESAI"}},
                                   {"$set": {"archived": True, "archived_at": _now()}})
        return {"ok": True}

    @router.put("/pengaturan/tahap")
    async def ubah_pengaturan(payload: PengaturanIn, user: dict = Depends(get_current_user)):
        a = await _akses(user, kelola=True)
        st = a["st"]
        upd = {}
        if payload.pic is not None:
            for t, aid in payload.pic.items():
                if t in TAHAP and aid and not await db.anggota.find_one({"id": aid}, {"_id": 1}):
                    raise HTTPException(400, "Anggota PIC tidak ditemukan.")
            upd["pic"] = {**(st.get("pic") or {}), **{t: v for t, v in payload.pic.items() if t in TAHAP}}
        if payload.offset is not None:
            upd["offset"] = {**(st.get("offset") or OFFSET), **{t: max(-30, min(30, int(v))) for t, v in payload.offset.items() if t in TAHAP}}
        await db.konten_settings.update_one({"id": "utama"}, {"$set": {**upd, "updated_at": _now()}})
        return await meta(user)

    @router.post("/impor/csv")
    async def impor_csv(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Impor tab 'jadwal konten' (File > Download > CSV). Idempoten per kode RS-xxx.
        Sudah posted di semua platform -> arsip. Belum tayang -> konten aktif + tugas (tahap yang sudah lewat ditandai selesai)."""
        await _akses(user, kelola=True)
        raw = (await file.read(5 * 1024 * 1024)).decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(raw)))
        hdr = next((i for i, r in enumerate(rows) if len(r) > 1 and r[0].strip() == "ID" and "Topik" in r[1]), None)
        if hdr is None:
            raise HTTPException(400, "Header tidak dikenali. Pastikan mengunduh tab 'jadwal konten' (baris kolom 'ID, Topik dan Brief, …').")
        ada = {k["kode"] for k in await db.konten.find({}, {"_id": 0, "kode": 1}).to_list(10000)}
        hasil = {"arsip": 0, "aktif": 0, "lewati": 0, "gagal": []}
        sudah_lewat = {"scripted": ["NASKAH"], "shooted": ["NASKAH", "TASHIH"], "editing": ["NASKAH", "TASHIH"],
                       "edited": ["NASKAH", "TASHIH", "PRODUKSI"], "scheduled": ["NASKAH", "TASHIH", "PRODUKSI", "APPROVAL"]}
        for r in rows[hdr + 1:]:
            r = (r + [""] * 21)[:21]
            kode = r[0].strip()
            if not re.match(r"^RS-\d+$", kode):
                continue
            if kode in ada:
                hasil["lewati"] += 1
                continue
            plat = {"IG": (r[2], r[3], r[16]), "TIKTOK": (r[4], r[5], r[17]), "SHORT": (r[6], r[7], r[18]), "YT": (r[8], r[9], r[19])}
            tgl = {p: _tgl_indo(v[0]) for p, v in plat.items()}
            dipakai = [p for p, v in plat.items() if tgl[p] or v[2].strip()]
            tanggal = min([x for x in tgl.values() if x] or [None]) if any(tgl.values()) else None
            st_list = [plat[p][1].strip().lower() for p in dipakai if plat[p][1].strip()]
            tayang = bool(dipakai) and all(s == "posted" for s in st_list) and len(st_list) > 0
            doc = {"id": str(uuid.uuid4()), "kode": kode, "judul": (r[1].strip() or kode)[:300], "tanggal_tayang": tanggal,
                   "jenis": "ORGANIK", "pilar": r[13].strip(), "bucket": r[11].strip().upper(), "funnel": r[14].strip(),
                   "format": r[15].strip(), "platforms": dipakai or ["IG"], "cta_keyword": "", "brief": "",
                   "naskah_url": r[20].strip(), "aset_url": "", "links": {p: plat[p][2].strip() for p in dipakai if plat[p][2].strip()},
                   "tashih": None, "sumber": "spreadsheet", "dibuat_oleh": user.get("name"), "created_at": _now()}
            try:
                if tayang or not tanggal or tanggal < (date.today() - timedelta(days=14)).isoformat():
                    doc.update({"status": "ARSIP", "task_ids": {}})
                    await db.konten.insert_one(dict(doc))
                    hasil["arsip"] += 1
                else:
                    doc["status"] = "AKTIF"
                    await db.konten.insert_one(dict(doc))
                    paling_jauh = max(st_list, key=lambda s: len(sudah_lewat.get(s, [])), default="")
                    ids = await _buat_tugas(doc, user, selesai=sudah_lewat.get(paling_jauh, []))
                    await db.konten.update_one({"id": doc["id"]}, {"$set": {"task_ids": ids}})
                    hasil["aktif"] += 1
                ada.add(kode)
            except HTTPException as e:
                hasil["gagal"].append(f"{kode}: {e.detail}")
        return hasil

    return router
