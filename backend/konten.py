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
# ---- Kanal teks (Threads, IG Story, WA Channel): dikelola per PAKET MINGGUAN, 3 tahap.
TAHAP_TEKS = ["COPY", "REVIEW", "POSTING"]
LABEL.update({"COPY": "Tulis copy", "REVIEW": "Review isi"})
INSTRUKSI.update({
    "COPY": "Tulis semua copy paket pekan ini di kartu paket (hook, isi, CTA per post).",
    "REVIEW": "Baca seluruh paket: akurasi tajwid/sanad, adab, CTA. Setujui, atau minta revisi ke penulis.",
})
OFFSET_TEKS = {"COPY": -3, "REVIEW": -2}
LEADS = [["tanya_harga", "Tanya harga"], ["tanya_program", "Tanya program"], ["voice_note", "Voice note"], ["pendaftaran", "Pendaftaran"]]
KANAL_TEKS = {
    "THREADS": {"label": "Threads", "prefix": "TH", "slot": [["07:30", "Post 1"], ["12:00", "Post 2"], ["15:30", "Post 3"]],
                "field": [["label", "Utas", "teks"], ["format", "Format", "teks"], ["hook", "Hook", "area"], ["isi", "Isi", "area"], ["cta", "CTA", "area"],
                          ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
                "metrik": [["views", "Views"], ["likes", "Likes"], ["replies", "Replies"], ["reposts", "Reposts"], ["quotes", "Quotes"],
                           ["shares", "Shares"], ["link_clicks", "Klik link"], ["profile_visits", "Kunjungan profil"], ["follows", "Follow"]]},
    "STORY": {"label": "IG Story", "prefix": "SG", "slot": [["08:00", "Slide 1"], ["14:30", "Slide 2"]],
              "field": [["label", "Slide", "teks"], ["isi", "Copy", "area"], ["stiker", "Stiker", "pilih:—,Polling,Kuis,Pertanyaan,Link,Slider"],
                        ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
              "metrik": [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["replies", "Replies"], ["shares", "Shares"],
                         ["link_clicks", "Klik link"], ["sticker_taps", "Sticker taps"], ["follows", "Follow"], ["profile_visits", "Kunjungan profil"],
                         ["forward", "Forward"], ["back", "Back"], ["exits", "Exits"]]},
    "WA": {"label": "WA Channel", "prefix": "WA", "slot": [["09:00", ""]],
           "field": [["format", "Format", "pilih:Teks,Copywriting + Link,PDF,Audio,Polling,Video,Stiker"], ["topik", "Topik", "teks"],
                     ["isi", "Copywriting", "area"], ["lampiran_url", "Link / lampiran", "teks"], ["terkait_kode", "Terkait konten (RS-xxx)", "teks"]],
           "metrik": [["views", "Views"], ["reaksi", "Reaksi"], ["link_clicks", "Klik link"]]},
}
POST_FIELD = ["label", "hook", "isi", "cta", "bucket", "pilar", "stiker", "format", "topik", "lampiran_url", "terkait_kode"]


def tahap_of(k: dict) -> List[str]:
    return TAHAP_TEKS if k.get("kanal") in KANAL_TEKS else TAHAP


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


def jadwal(tayang: date, offsets: Dict[str, int], hari_ini: Optional[date] = None, urutan: Optional[List[str]] = None) -> Dict[str, str]:
    """Deadline per tahap. Bila tanggal tayang terlalu dekat, tahap sebelum tayang dipadatkan secara proporsional
    antara hari ini dan tanggal tayang (tidak ada deadline yang sudah lewat saat konten dibuat/digeser)."""
    hari_ini = hari_ini or date.today()
    urutan = urutan or TAHAP
    off = {t: offsets.get(t, OFFSET.get(t, 0)) for t in urutan}
    terjauh = -min(off.values())  # mis. 5 (H-5)
    tersedia = (tayang - hari_ini).days
    out = {}
    for t in urutan:
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
        if st and st.get("teks"):
            return st
        if st:  # dokumen lama: tambahkan PIC kanal teks (penulis & posting = PIC Posting video, review = PIC Approval)
            pic = st.get("pic") or {}
            st["teks"] = {kn: {"COPY": pic.get("POSTING"), "REVIEW": pic.get("APPROVAL"), "POSTING": pic.get("POSTING")} for kn in KANAL_TEKS}
            await db.konten_settings.update_one({"id": "utama"}, {"$set": {"teks": st["teks"]}})
            return st
        div = await db.divisi.find_one({"nama": {"$regex": "^multimedia$", "$options": "i"}}, {"_id": 0, "id": 1, "head_anggota_id": 1})
        pic: Dict[str, Optional[str]] = {k: None for k in TAHAP}
        if div:
            ang = await db.anggota.find({"divisi_id": div["id"]}, {"_id": 0, "id": 1, "nama": 1}).to_list(50)
            cari = lambda kata: next((a["id"] for a in ang if kata in a["nama"].lower()), None)  # noqa: E731
            lead = div.get("head_anggota_id") or cari("indhy")
            pic = {"NASKAH": lead, "TASHIH": lead, "PRODUKSI": cari("rizki") or lead, "APPROVAL": lead,
                   "POSTING": cari("fatya") or lead, "LAPORAN": cari("fatya") or lead}
        teks = {kn: {"COPY": pic.get("POSTING"), "REVIEW": pic.get("APPROVAL"), "POSTING": pic.get("POSTING")} for kn in KANAL_TEKS}
        st = {"id": "utama", "divisi_id": div["id"] if div else None, "pic": pic, "offset": dict(OFFSET), "teks": teks, "updated_at": _now()}
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
        teks: Optional[Dict[str, Dict[str, Optional[str]]]] = None

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
        urutan = tahap_of(k)
        if k.get("kanal") in KANAL_TEKS:
            akhir = max([p["tanggal"] for p in k.get("posts") or [] if p.get("tanggal")] or [k["tanggal_tayang"]])
            jd = jadwal(tayang, {**OFFSET_TEKS, "POSTING": (date.fromisoformat(akhir) - tayang).days}, urutan=urutan)
            pics = (st.get("teks") or {}).get(k["kanal"]) or {}
        else:
            jd = jadwal(tayang, st.get("offset") or OFFSET)
            pics = st.get("pic") or {}
        for t in urutan:
            r_id = pics.get(t) or sc["anggota_id"]
            if not r_id:
                raise HTTPException(400, f"PIC tahap {LABEL[t]} belum diatur di pengaturan Produksi Konten.")
            dl = jd[t]
            tb = srv.TaskBase(nama=f"[{k['kode']}] {LABEL[t]}: {k['judul']}"[:300], kategori="PROJECT",
                              penerima_tugas_id=r_id, pemberi_id=r_id, deadline=dl,
                              catatan_tim=INSTRUKSI[t] + (f"\nNaskah: {k['naskah_url']}" if k.get("naskah_url") else ""),
                              deadline_jam=None)
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
                                                                                   "penerima_tugas_id": 1, "selesai_at": 1, "revisi_catatan": 1, "revisi_count": 1}).to_list(10000)}
        amap = {a["id"]: a["nama"] for a in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        today = date.today().isoformat()
        now_wib = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%dT%H:%M")
        for k in rows:
            tahapan, sekarang, telat = [], None, False
            if k.get("kanal") in KANAL_TEKS:
                posts = k.get("posts") or []
                k["post_jumlah"] = len(posts)
                k["post_diposting"] = sum(1 for p in posts if p.get("diposting"))
                k["post_telat"] = sum(1 for p in posts if not p.get("diposting") and k.get("status") == "AKTIF"
                                      and f"{p.get('tanggal')}T{p.get('jam') or '23:59'}" < now_wib)
                telat = k["post_telat"] > 0
            for t in tahap_of(k):
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
                                "pic_nama": amap.get(task.get("penerima_tugas_id")),
                                "revisi_catatan": task.get("revisi_catatan") if task.get("status") == "REVISI" else None})
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
                "platform": PLATFORM, "bisa_kelola": a["lead"], "divisi_id": st.get("divisi_id"),
                "kanal_teks": {kn: {**v, "pic": {t: {"id": ((st.get("teks") or {}).get(kn) or {}).get(t),
                                                      "nama": amap.get(((st.get("teks") or {}).get(kn) or {}).get(t))} for t in TAHAP_TEKS}}
                               for kn, v in KANAL_TEKS.items()},
                "tahap_teks": [{"k": t, "label": LABEL[t], "instruksi": INSTRUKSI.get(t, "")} for t in TAHAP_TEKS],
                "leads": LEADS, "anggota_id": a["anggota_id"]}

    @router.get("")
    async def daftar(dari: Optional[str] = None, sampai: Optional[str] = None, q: Optional[str] = None,
                     arsip: bool = False, user: dict = Depends(get_current_user)):
        await _akses(user)
        f: dict = {} if arsip else {"status": "AKTIF"}
        if dari or sampai:
            rng = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
            f["$and"] = [{"$or": [{"tanggal_tayang": rng}, {"posts.tanggal": rng}]}]
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

    async def _boleh_tahap(k: dict, tahap: str, user: dict) -> bool:
        """PIC tahap itu, kepala tim konten, atau SPV."""
        a = await _akses(user)
        if a["lead"]:
            return True
        tid = (k.get("task_ids") or {}).get(tahap)
        t = await db.tasks.find_one({"id": tid}, {"_id": 0, "penerima_tugas_id": 1}) if tid else None
        return bool(t and a["anggota_id"] and t.get("penerima_tugas_id") == a["anggota_id"])

    async def _tahap_terbuka_sebelum(k: dict, tahap: str) -> Optional[str]:
        ids = k.get("task_ids") or {}
        urutan = tahap_of(k)
        for t in urutan[:urutan.index(tahap) if tahap in urutan else 0]:
            if ids.get(t):
                x = await db.tasks.find_one({"id": ids[t]}, {"_id": 0, "status": 1, "archived": 1})
                if x and x.get("status") != "SELESAI" and not x.get("archived"):
                    return t
        return None


    async def _tandai(k: dict, tahap: str, user: dict, catatan: str = "", wajib: bool = True) -> bool:
        """Selesaikan tugas tahap (langsung di DB, dengan log). wajib=False: diam bila tidak berhak/urutan belum sampai."""
        tid = (k.get("task_ids") or {}).get(tahap)
        t = await db.tasks.find_one({"id": tid}, {"_id": 0}) if tid else None
        if not t or t.get("status") == "SELESAI":
            return False
        if tahap == "COPY" and not (k.get("posts") or []):
            if wajib:
                raise HTTPException(400, "Paket masih kosong. Tulis minimal satu post dulu.")
            return False
        if not await _boleh_tahap(k, tahap, user):
            if wajib:
                raise HTTPException(403, f"Tahap {LABEL[tahap]} dikerjakan oleh PIC-nya (atau kepala tim/SPV).")
            return False
        sebelum = await _tahap_terbuka_sebelum(k, tahap)
        if sebelum:
            if wajib:
                raise HTTPException(400, f"Selesaikan dulu tahap {LABEL[sebelum]}.")
            return False
        upd = {"status": "SELESAI", "selesai_at": _now(), "updated_at": _now()}
        await srv._sync_status_list(t, upd)
        await db.tasks.update_one({"id": tid}, {"$set": upd})
        await srv._log_activity(tid, user, "status", f"{LABEL[tahap]} selesai" + (f" — {catatan}" if catatan else ""))
        return True

    router.tahap_terbuka_fn = _tahap_terbuka_sebelum

    async def _selesaikan(k: dict, tahap: str, user: dict):
        await _tandai(k, tahap, user, wajib=False)

    class AksiIn(BaseModel):
        catatan: str = Field(default="", max_length=1000)

    @router.post("/{kid}/tahap/{tahap}/selesai")
    async def tahap_selesai(kid: str, tahap: str, payload: AksiIn, user: dict = Depends(get_current_user)):
        """Tombol aksi tahap di kartu konten (Naskah selesai, Hasil siap, Setujui, Sudah diposting, Laporan selesai)."""
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k or tahap not in tahap_of(k):
            raise HTTPException(404, "Konten/tahap tidak ditemukan.")
        if tahap == "TASHIH" and not k.get("tashih"):
            raise HTTPException(400, "Isi nama guru yang mentashih dulu.")
        await _tandai(k, tahap, user, payload.catatan.strip())
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.post("/{kid}/revisi")
    async def minta_revisi(kid: str, payload: AksiIn, user: dict = Depends(get_current_user)):
        """Approval ditolak: tugas Produksi dibuka lagi (status Revisi + catatan, tenggat besok) dan PIC-nya diberi kabar."""
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        teks = k.get("kanal") in KANAL_TEKS
        if not await _boleh_tahap(k, "REVIEW" if teks else "APPROVAL", user):
            raise HTTPException(403, "Hanya PIC Approval/Review, kepala tim, atau SPV.")
        if len(payload.catatan.strip()) < 3:
            raise HTTPException(400, "Tulis apa yang perlu diperbaiki.")
        tid = (k.get("task_ids") or {}).get("COPY" if teks else "PRODUKSI")
        t = await db.tasks.find_one({"id": tid}, {"_id": 0}) if tid else None
        if not t:
            raise HTTPException(400, "Tugas yang direvisi tidak ditemukan.")
        besok = (date.today() + timedelta(days=1)).isoformat()
        upd = {"status": "REVISI", "selesai_at": None, "revisi_catatan": payload.catatan.strip(), "revisi_at": _now(),
               "deadline": max(besok, t.get("deadline") or besok), "updated_at": _now()}
        await srv._sync_status_list(t, upd)
        await db.tasks.update_one({"id": tid}, {"$set": upd, "$inc": {"revisi_count": 1}})
        await srv._log_activity(tid, user, "revisi", payload.catatan.strip())
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.put("/{kid}")
    async def ubah(kid: str, payload: KontenUpd, user: dict = Depends(get_current_user)):
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        if k.get("kanal") in KANAL_TEKS:
            raise HTTPException(400, "Paket mingguan diubah lewat daftar post-nya.")
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
        if not await _boleh_tahap(k, "TASHIH", user):
            raise HTTPException(403, "Tashih dicatat oleh PIC Tashih (atau kepala tim/SPV).")
        sebelum = await _tahap_terbuka_sebelum(k, "TASHIH")
        if sebelum:
            raise HTTPException(400, f"Selesaikan dulu tahap {LABEL[sebelum]}.")
        await db.konten.update_one({"id": kid}, {"$set": {"tashih": {"guru": payload.guru.strip(), "catatan": payload.catatan.strip(),
                                                                       "oleh": user.get("name"), "at": _now()}}})
        await _tandai(k, "TASHIH", user, f"ditashih oleh {payload.guru.strip()}" + (f". {payload.catatan.strip()}" if payload.catatan.strip() else ""))
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
        f: dict = {"performa": {"$exists": True}, "kanal": {"$nin": list(KANAL_TEKS)}}
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
        # Kanal teks: agregasi per post
        kanal_rows = {}
        tf: dict = {"kanal": {"$in": list(KANAL_TEKS)}}
        if dari or sampai:
            tf["posts.tanggal"] = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
        async for pk in db.konten.find(tf, {"_id": 0, "kanal": 1, "posts": 1}):
            for po in pk.get("posts") or []:
                if (dari and po.get("tanggal", "") < dari) or (sampai and po.get("tanggal", "") > sampai):
                    continue
                g = kanal_rows.setdefault(KANAL_TEKS[pk["kanal"]]["label"], {"post": 0, "diposting": 0, "berdata": 0, "views": 0, "interaksi": 0, "leads": 0, "pendaftaran": 0})
                g["post"] += 1
                g["diposting"] += 1 if po.get("diposting") else 0
                m = po.get("performa") or {}
                if m:
                    g["berdata"] += 1
                    g["views"] += m.get("views") or 0
                    g["interaksi"] += sum(m.get(x) or 0 for x in ("likes", "replies", "reposts", "quotes", "shares", "sticker_taps", "reaksi"))
                    g["leads"] += (m.get("tanya_harga") or 0) + (m.get("tanya_program") or 0) + (m.get("voice_note") or 0)
                    g["pendaftaran"] += m.get("pendaftaran") or 0
        teks_rows = [{"nama": n, **v, "rata_views": round(v["views"] / v["berdata"]) if v["berdata"] else None} for n, v in kanal_rows.items()]
        return {"jumlah_konten": len(rows), "kanal_teks": teks_rows, **{d: selesaikan(v) for d, v in grup.items()},
                "top_views": sorted(per_konten, key=lambda x: -x["views"])[:5],
                "top_dm": [x for x in sorted(per_konten, key=lambda x: -x["dm"]) if x["dm"] > 0][:5]}

    # ================= PAKET MINGGUAN KANAL TEKS =================
    class PostIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        id: Optional[str] = None
        tanggal: str
        jam: str = ""
        label: str = ""
        hook: str = Field(default="", max_length=2000)
        isi: str = Field(default="", max_length=6000)
        cta: str = Field(default="", max_length=2000)
        bucket: str = ""
        pilar: str = ""
        stiker: str = ""
        format: str = ""
        topik: str = Field(default="", max_length=300)
        lampiran_url: str = ""
        terkait_kode: str = ""

    class PaketIn(BaseModel):
        kanal: str
        minggu_mulai: str
        posts: List[PostIn] = Field(default_factory=list)

    def _rapikan_posts(posts: List[PostIn], lama: Optional[List[dict]] = None) -> List[dict]:
        lama_map = {p["id"]: p for p in lama or []}
        out = []
        for p in posts:
            try:
                date.fromisoformat(p.tanggal)
            except ValueError:
                raise HTTPException(400, f"Tanggal post tidak valid: {p.tanggal}")
            if p.jam and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", p.jam):
                raise HTTPException(400, f"Jam post tidak valid: {p.jam}")
            d = {f: (getattr(p, f) or "").strip() for f in POST_FIELD}
            d["terkait_kode"] = d["terkait_kode"].upper()
            d.update({"tanggal": p.tanggal, "jam": p.jam})
            old = lama_map.get(p.id or "")
            d["id"] = old["id"] if old else str(uuid.uuid4())
            for keep in ("diposting", "diposting_at", "diposting_oleh", "link", "performa"):
                if old and keep in old:
                    d[keep] = old[keep]
            d.setdefault("diposting", False)
            out.append(d)
        return sorted(out, key=lambda x: (x["tanggal"], x["jam"] or "99"))

    async def _kode_paket(kanal: str) -> str:
        pre = KANAL_TEKS[kanal]["prefix"]
        mx = 0
        async for k in db.konten.find({"kode": {"$regex": f"^{pre}-"}}, {"_id": 0, "kode": 1}):
            m = re.match(rf"{pre}-(\d+)", k["kode"])
            mx = max(mx, int(m.group(1))) if m else mx
        return f"{pre}-{mx + 1:03d}"

    def _judul_paket(kanal: str, mulai: date) -> str:
        sampai = mulai + timedelta(days=6)
        bl = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
        return f"{KANAL_TEKS[kanal]['label']} · pekan {mulai.isocalendar()[1]} ({mulai.day} {bl[mulai.month - 1]}–{sampai.day} {bl[sampai.month - 1]})"

    async def _boleh_copy(user: dict, kanal: str) -> dict:
        a = await _akses(user)
        pic_copy = ((a["st"].get("teks") or {}).get(kanal) or {}).get("COPY")
        if not (a["lead"] or (a["anggota_id"] and a["anggota_id"] == pic_copy)):
            raise HTTPException(403, "Paket ini dibuat/diubah oleh penulis copy kanal tersebut, kepala tim, atau SPV.")
        return a

    @router.post("/paket")
    async def buat_paket(payload: PaketIn, user: dict = Depends(get_current_user)):
        if payload.kanal not in KANAL_TEKS:
            raise HTTPException(400, "Kanal tidak dikenal.")
        await _boleh_copy(user, payload.kanal)
        mulai = _cek_tanggal(payload.minggu_mulai)
        mulai = mulai - timedelta(days=mulai.weekday())  # selalu Senin
        if await db.konten.find_one({"kanal": payload.kanal, "minggu_mulai": mulai.isoformat(), "status": {"$ne": "BATAL"}}, {"_id": 1}):
            raise HTTPException(400, "Paket kanal ini untuk pekan tersebut sudah ada. Buka paketnya untuk menambah post.")
        posts = _rapikan_posts(payload.posts)
        doc = {"id": str(uuid.uuid4()), "kode": await _kode_paket(payload.kanal), "kanal": payload.kanal,
               "judul": _judul_paket(payload.kanal, mulai), "minggu_mulai": mulai.isoformat(), "tanggal_tayang": mulai.isoformat(),
               "posts": posts, "platforms": [payload.kanal], "links": {}, "status": "AKTIF", "sumber": "workspace",
               "dibuat_oleh": user.get("name"), "created_at": _now()}
        await db.konten.insert_one(dict(doc))
        doc["task_ids"] = await _buat_tugas(doc, user)
        await db.konten.update_one({"id": doc["id"]}, {"$set": {"task_ids": doc["task_ids"]}})
        doc.pop("_id", None)
        return (await _hiasi([doc]))[0]

    class PostsIn(BaseModel):
        posts: List[PostIn]

    @router.put("/{kid}/posts")
    async def ubah_posts(kid: str, payload: PostsIn, user: dict = Depends(get_current_user)):
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k or k.get("kanal") not in KANAL_TEKS:
            raise HTTPException(404, "Paket tidak ditemukan.")
        await _boleh_copy(user, k["kanal"])
        posts = _rapikan_posts(payload.posts, k.get("posts"))
        await db.konten.update_one({"id": kid}, {"$set": {"posts": posts, "updated_at": _now()}})
        if posts and k.get("status") == "AKTIF":  # tenggat Posting mengikuti post terakhir
            tid = (k.get("task_ids") or {}).get("POSTING")
            if tid:
                await db.tasks.update_one({"id": tid, "status": {"$ne": "SELESAI"}}, {"$set": {"deadline": posts[-1]["tanggal"]}})
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    class PostingIn(BaseModel):
        diposting: bool = True
        link: str = ""

    @router.post("/{kid}/posts/{pid}/posting")
    async def tandai_post(kid: str, pid: str, payload: PostingIn, user: dict = Depends(get_current_user)):
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k or k.get("kanal") not in KANAL_TEKS:
            raise HTTPException(404, "Paket tidak ditemukan.")
        if not await _boleh_tahap(k, "POSTING", user):
            raise HTTPException(403, "Posting ditandai oleh PIC Posting (atau kepala tim/SPV).")
        if payload.diposting:
            sebelum = await _tahap_terbuka_sebelum(k, "POSTING")
            if sebelum:
                raise HTTPException(400, f"Paket belum lolos tahap {LABEL[sebelum]}.")
        posts = k.get("posts") or []
        p = next((x for x in posts if x["id"] == pid), None)
        if not p:
            raise HTTPException(404, "Post tidak ditemukan.")
        p.update({"diposting": payload.diposting, "diposting_at": _now() if payload.diposting else None,
                  "diposting_oleh": user.get("name") if payload.diposting else None, "link": payload.link.strip() or p.get("link", "")})
        await db.konten.update_one({"id": kid}, {"$set": {"posts": posts, "updated_at": _now()}})
        k2 = await db.konten.find_one({"id": kid}, {"_id": 0})
        if posts and all(x.get("diposting") for x in posts):
            await _selesaikan(k2, "POSTING", user)
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

    @router.put("/{kid}/posts/{pid}/performa")
    async def performa_post(kid: str, pid: str, data: Dict[str, int], user: dict = Depends(get_current_user)):
        await _akses(user)
        k = await db.konten.find_one({"id": kid}, {"_id": 0})
        if not k or k.get("kanal") not in KANAL_TEKS:
            raise HTTPException(404, "Paket tidak ditemukan.")
        boleh = {m[0] for m in KANAL_TEKS[k["kanal"]]["metrik"]} | {x[0] for x in LEADS}
        bersih = {f: max(0, int(v)) for f, v in data.items() if f in boleh and v is not None}
        if not bersih:
            raise HTTPException(400, "Isi minimal satu angka.")
        posts = k.get("posts") or []
        p = next((x for x in posts if x["id"] == pid), None)
        if not p:
            raise HTTPException(404, "Post tidak ditemukan.")
        p["performa"] = {**bersih, "diisi_at": _now(), "oleh": user.get("name")}
        await db.konten.update_one({"id": kid}, {"$set": {"posts": posts}})
        return (await _hiasi([await db.konten.find_one({"id": kid}, {"_id": 0})]))[0]

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
        if payload.teks is not None:
            teks = dict(st.get("teks") or {})
            for kn, m in payload.teks.items():
                if kn in KANAL_TEKS:
                    for t, aid in (m or {}).items():
                        if t in TAHAP_TEKS and aid and not await db.anggota.find_one({"id": aid}, {"_id": 1}):
                            raise HTTPException(400, "Anggota PIC tidak ditemukan.")
                    teks[kn] = {**(teks.get(kn) or {}), **{t: v for t, v in (m or {}).items() if t in TAHAP_TEKS}}
            upd["teks"] = teks
        await db.konten_settings.update_one({"id": "utama"}, {"$set": {**upd, "updated_at": _now()}})
        return await meta(user)

    async def _impor_teks(rows: List[List[str]], user: dict) -> Optional[dict]:
        """Tab Threads / SG / WA Channel -> paket mingguan. Idempoten per (kanal, pekan): pekan yang sudah ada dilewati."""
        low = lambda r: [c.strip().lower() for c in r]
        kanal, hdr = None, None
        for i, r in enumerate(rows[:10]):
            c = low(r)
            if "utas" in c and "hook" in c:
                kanal, hdr = "THREADS", i
            elif "slide" in c and "sticker taps" in c:
                kanal, hdr = "STORY", i
            elif "topik" in c and "copywriting" in c and "format" in c:
                kanal, hdr = "WA", i
            if kanal:
                break
        if not kanal:
            return None
        h = low(rows[hdr])
        col = lambda nama: h.index(nama) if nama in h else None
        ambil = lambda r, nama: (r[col(nama)].strip() if col(nama) is not None and col(nama) < len(r) else "")
        def angka(r, nama):
            v = re.sub(r"[^\d]", "", ambil(r, nama))
            return int(v) if v else None
        metrik_map = {"views": "views", "reach": "reach", "likes": "likes", "replies": "replies", "reposts": "reposts", "quotes": "quotes",
                      "shares": "shares", "link clicks": "link_clicks", "profile visits": "profile_visits", "follows": "follows",
                      "sticker taps": "sticker_taps", "forward": "forward", "back": "back", "exits": "exits",
                      "tanya harga": "tanya_harga", "tanya program": "tanya_program", "voice note": "voice_note", "pendaftaran": "pendaftaran"}
        pekan: Dict[str, List[dict]] = {}
        gagal = []
        for n, r in enumerate(rows[hdr + 1:], start=hdr + 2):
            if not any(x.strip() for x in r):
                continue
            if kanal == "WA":
                tgl = _tgl_indo(ambil(r, "tanggal"))
            else:
                hari = ambil(r, "tanggal")
                tgl = _tgl_indo(f"{hari} {ambil(r, 'bulan & tahun')}") if hari.isdigit() else None
            if not tgl:
                if any(x.strip() for x in r[3:]):
                    gagal.append(f"baris {n}: tanggal tidak terbaca")
                continue
            jam = ambil(r, "jam posting (wib)")
            m = re.match(r"^(\d{1,2})[:.](\d{2})", jam)
            jam = f"{int(m.group(1)):02d}:{m.group(2)}" if m else ""
            p = {"id": str(uuid.uuid4()), "tanggal": tgl, "jam": jam, **{f: "" for f in POST_FIELD}}
            if kanal == "THREADS":
                p.update(label=ambil(r, "utas"), format=ambil(r, "format"), hook=ambil(r, "hook"), isi=ambil(r, "content"),
                         cta=ambil(r, "cta"), bucket=ambil(r, "bucket").upper(), pilar=ambil(r, "pilar"))
            elif kanal == "STORY":
                p.update(label=ambil(r, "slide"), isi=ambil(r, "copywriting"), bucket=ambil(r, "bucket").upper(), pilar=ambil(r, "pilar"))
            else:
                p.update(format=ambil(r, "format"), topik=ambil(r, "topik"), isi=ambil(r, "copywriting"), lampiran_url=ambil(r, "link / referensi"))
            perf = {v: angka(r, k) for k, v in metrik_map.items() if col(k) is not None and angka(r, k) is not None}
            if perf:
                p["performa"] = {**perf, "diisi_at": _now(), "oleh": "impor spreadsheet"}
            status = ambil(r, "status").lower()
            if col("status") is not None:
                p["diposting"] = status in ("posting", "posted", "tayang", "sudah posting")
            else:
                p["diposting"] = bool(perf) or tgl < date.today().isoformat()
            if p["diposting"]:
                p["diposting_at"] = f"{tgl}T{jam or '00:00'}:00+07:00"
                p["diposting_oleh"] = "impor spreadsheet"
            mulai = date.fromisoformat(tgl)
            pekan.setdefault((mulai - timedelta(days=mulai.weekday())).isoformat(), []).append(p)
        ada = {k["minggu_mulai"] async for k in db.konten.find({"kanal": kanal, "status": {"$ne": "BATAL"}}, {"_id": 0, "minggu_mulai": 1})}
        hasil = {"kanal": KANAL_TEKS[kanal]["label"], "arsip": 0, "aktif": 0, "lewati": 0, "post": 0, "gagal": gagal[:20]}
        senin_ini = (date.today() - timedelta(days=date.today().weekday())).isoformat()
        for mm in sorted(pekan):
            if mm in ada:
                hasil["lewati"] += 1
                continue
            posts = sorted(pekan[mm], key=lambda x: (x["tanggal"], x["jam"] or "99"))
            mulai = date.fromisoformat(mm)
            doc = {"id": str(uuid.uuid4()), "kode": await _kode_paket(kanal), "kanal": kanal, "judul": _judul_paket(kanal, mulai),
                   "minggu_mulai": mm, "tanggal_tayang": mm, "posts": posts, "platforms": [kanal], "links": {},
                   "sumber": "spreadsheet", "dibuat_oleh": user.get("name"), "created_at": _now()}
            if mm < senin_ini or all(x.get("diposting") for x in posts):
                doc.update({"status": "ARSIP", "task_ids": {}})
                await db.konten.insert_one(dict(doc))
                hasil["arsip"] += 1
            else:
                doc["status"] = "AKTIF"
                await db.konten.insert_one(dict(doc))
                ids = await _buat_tugas(doc, user, selesai=["COPY", "REVIEW"] if any(x.get("isi") or x.get("hook") for x in posts) else [])
                await db.konten.update_one({"id": doc["id"]}, {"$set": {"task_ids": ids}})
                hasil["aktif"] += 1
            hasil["post"] += len(posts)
        return hasil

    @router.post("/impor/csv")
    async def impor_csv(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Impor tab 'jadwal konten' (File > Download > CSV). Idempoten per kode RS-xxx.
        Sudah posted di semua platform -> arsip. Belum tayang -> konten aktif + tugas (tahap yang sudah lewat ditandai selesai)."""
        await _akses(user, kelola=True)
        raw = (await file.read(5 * 1024 * 1024)).decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(raw)))
        teks = await _impor_teks(rows, user)
        if teks is not None:
            return teks
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
