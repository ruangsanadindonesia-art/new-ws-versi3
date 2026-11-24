"""Produksi Konten (tim Multimedia) v2: SATU konten = SATU tugas, status khusus per tipe konten.

Tipe & alur status (urutan baku):
  REELS    : IDE → SCRIPTING → SHOOTING → SHOOTED → EDITING → REVIEW ⇄ REVISI → EDITED → POSTING → POSTED → LAPORAN → SELESAI
  CAROUSEL : IDE → SCRIPTING → SCRIPTED → DESIGN → DESIGNED → REVIEW ⇄ REVISI(→DESIGNED) → POSTING → POSTED → LAPORAN → SELESAI
  SINGLE   : sama dengan CAROUSEL
  THREADS / STORY / WA (1 post = 1 konten): SCRIPTING → SCRIPTED → POSTING → POSTED → LAPORAN → SELESAI

Peran (diatur di pengaturan): LEAD (Indhy), PRODUKSI (Rizki), PUBLISHER (Fatya); penulis kanal teks per kanal (default LEAD).
- "Pemegang" = siapa yang tugasnya muncul di Tugas › Untuk saya pada status itu (tabel PEMEGANG).
- R tugas = pelaksana status saat ini (tabel PELAKSANA); A = LEAD. Deadline tugas mengikuti target status saat ini.
Otomatis: link semua platform terisi → POSTED; POSTED + 72 jam → LAPORAN; performa terisi → SELESAI.
Semua anggota tim tetap bisa melihat perjalanan konten di menu Produksi Konten.
"""
import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

WIB = timezone(timedelta(hours=7))

ALUR_VIDEO = ["IDE", "SCRIPTING", "SHOOTING", "SHOOTED", "EDITING", "REVIEW", "REVISI", "EDITED", "POSTING", "POSTED", "LAPORAN", "SELESAI"]
ALUR_DESAIN = ["IDE", "SCRIPTING", "SCRIPTED", "DESIGN", "DESIGNED", "REVIEW", "REVISI", "POSTING", "POSTED", "LAPORAN", "SELESAI"]
ALUR_TEKS = ["SCRIPTING", "SCRIPTED", "POSTING", "POSTED", "LAPORAN", "SELESAI"]
STATUS_LABEL = {"IDE": "Ide", "SCRIPTING": "Scripting", "SCRIPTED": "Scripted", "SHOOTING": "Shooting", "SHOOTED": "Shooted",
                "EDITING": "Editing", "DESIGN": "Design", "DESIGNED": "Designed", "REVIEW": "Review", "REVISI": "Revisi",
                "EDITED": "Edited", "POSTING": "Posting", "POSTED": "Posted", "LAPORAN": "Laporan", "SELESAI": "Selesai"}
PLATFORM = {"IG": "Instagram", "TIKTOK": "TikTok", "SHORT": "YT Short", "YT": "YouTube"}
LEADS = [["tanya_harga", "Tanya harga"], ["tanya_program", "Tanya program"], ["voice_note", "Voice note"], ["pendaftaran", "Pendaftaran"]]
METRIK_FEED = [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["comments", "Komentar"], ["saves", "Simpan"],
               ["shares", "Bagikan"], ["follows", "Follow"], ["dm", "DM / tanya"]]

# field: [kunci, label, tipe]  tipe: teks | area | bucket | pilih:a,b,c
FIELD_UMUM = [["pilar", "Pilar", "teks"], ["bucket", "Bucket", "bucket"], ["funnel", "Funnel", "pilih:Awareness,Consideration,Conversion"],
              ["cta_keyword", "Kata kunci CTA", "teks"], ["naskah_url", "Link naskah", "teks"], ["brief", "Brief singkat", "area"]]
JENIS: Dict[str, dict] = {
    "REELS": {"label": "Reels / Video", "grup": "VIDEO", "prefix": "RS", "alur": ALUR_VIDEO, "platform": True,
              "field": FIELD_UMUM, "metrik": METRIK_FEED, "slot": []},
    "CAROUSEL": {"label": "Carousel", "grup": "DESAIN", "prefix": "RS", "alur": ALUR_DESAIN, "platform": True,
                 "field": FIELD_UMUM, "metrik": METRIK_FEED, "slot": []},
    "SINGLE": {"label": "Single image", "grup": "DESAIN", "prefix": "RS", "alur": ALUR_DESAIN, "platform": True,
               "field": FIELD_UMUM, "metrik": METRIK_FEED, "slot": []},
    "THREADS": {"label": "Threads", "grup": "TEKS", "prefix": "TH", "alur": ALUR_TEKS, "platform": False,
                "slot": [["07:30", "Post 1"], ["12:00", "Post 2"], ["15:30", "Post 3"]],
                "field": [["label", "Utas", "teks"], ["format", "Format", "teks"], ["hook", "Hook", "area"], ["isi", "Isi", "area"],
                          ["cta", "CTA", "area"], ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
                "metrik": [["views", "Views"], ["likes", "Likes"], ["replies", "Replies"], ["reposts", "Reposts"], ["quotes", "Quotes"],
                           ["shares", "Shares"], ["link_clicks", "Klik link"], ["profile_visits", "Kunjungan profil"], ["follows", "Follow"]]},
    "STORY": {"label": "IG Story", "grup": "TEKS", "prefix": "SG", "alur": ALUR_TEKS, "platform": False,
              "slot": [["08:00", "Slide 1"], ["14:30", "Slide 2"]],
              "field": [["label", "Slide", "teks"], ["isi", "Copy", "area"], ["stiker", "Stiker", "pilih:Polling,Kuis,Pertanyaan,Link,Slider"],
                        ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
              "metrik": [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["replies", "Replies"], ["shares", "Shares"],
                         ["link_clicks", "Klik link"], ["sticker_taps", "Sticker taps"], ["follows", "Follow"], ["profile_visits", "Kunjungan profil"],
                         ["forward", "Forward"], ["back", "Back"], ["exits", "Exits"]]},
    "WA": {"label": "WA Channel", "grup": "TEKS", "prefix": "WA", "alur": ALUR_TEKS, "platform": False, "slot": [["09:00", ""]],
           "field": [["format", "Format", "pilih:Teks,Copywriting + Link,PDF,Audio,Polling,Video,Stiker"], ["topik", "Topik", "teks"],
                     ["isi", "Copywriting", "area"], ["lampiran_url", "Link / lampiran", "teks"], ["terkait_kode", "Terkait konten (RS-xxx)", "teks"]],
           "metrik": [["views", "Views"], ["reaksi", "Reaksi"], ["link_clicks", "Klik link"]]},
}
FIELD_KONTEN = sorted({f[0] for j in JENIS.values() for f in j["field"]})

# Siapa melihat tugasnya (Tugas › Untuk saya) pada tiap status. PENULIS = penulis kanal teks.
_SAMPAI_POSTED_V = ALUR_VIDEO[:ALUR_VIDEO.index("POSTED") + 1]
_SAMPAI_POSTED_D = ALUR_DESAIN[:ALUR_DESAIN.index("POSTED") + 1]
PEMEGANG = {
    "VIDEO": {"LEAD": set(_SAMPAI_POSTED_V),
              "PRODUKSI": {"SHOOTED", "EDITING", "REVIEW", "REVISI", "EDITED", "POSTING", "POSTED"},
              "PUBLISHER": {"EDITED", "POSTING", "POSTED", "LAPORAN", "SELESAI"}},
    "DESAIN": {"LEAD": set(_SAMPAI_POSTED_D),
               "PRODUKSI": {"SCRIPTED", "DESIGN", "DESIGNED", "REVIEW", "REVISI", "POSTING", "POSTED"},
               "PUBLISHER": {"DESIGNED", "POSTING", "POSTED", "LAPORAN", "SELESAI"}},
    "TEKS": {"LEAD": {"SCRIPTING", "SCRIPTED", "POSTING", "POSTED"}, "PENULIS": {"SCRIPTING"},
             "PUBLISHER": {"SCRIPTED", "POSTING", "POSTED", "LAPORAN", "SELESAI"}},
}
# Pelaksana (R tugas) pada tiap status.
PELAKSANA = {
    "VIDEO": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SHOOTING": "LEAD", "SHOOTED": "PRODUKSI", "EDITING": "PRODUKSI", "REVIEW": "LEAD",
              "REVISI": "PRODUKSI", "EDITED": "PUBLISHER", "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
    "DESAIN": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SCRIPTED": "PRODUKSI", "DESIGN": "PRODUKSI", "DESIGNED": "LEAD", "REVIEW": "LEAD",
               "REVISI": "PRODUKSI", "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
    "TEKS": {"SCRIPTING": "PENULIS", "SCRIPTED": "PUBLISHER", "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
}
# Target selesai tiap status, dalam hari relatif terhadap tanggal tayang (deadline tugas mengikuti status saat ini).
OFFSET = {
    "VIDEO": {"IDE": -7, "SCRIPTING": -5, "SHOOTING": -4, "SHOOTED": -3, "EDITING": -2, "REVIEW": -1, "REVISI": -1,
              "EDITED": 0, "POSTING": 0, "POSTED": 3, "LAPORAN": 4, "SELESAI": 4},
    "DESAIN": {"IDE": -5, "SCRIPTING": -3, "SCRIPTED": -2, "DESIGN": -2, "DESIGNED": -1, "REVIEW": -1, "REVISI": -1,
               "POSTING": 0, "POSTED": 3, "LAPORAN": 4, "SELESAI": 4},
    "TEKS": {"SCRIPTING": -1, "SCRIPTED": 0, "POSTING": 0, "POSTED": 3, "LAPORAN": 4, "SELESAI": 4},
}
# Aksi per status: [kunci, label tombol, status tujuan, peran yang boleh, input wajib]
AKSI = {
    "VIDEO": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → shooting", "SHOOTING", "LEAD", None]],
        "SHOOTING": [["lanjut", "Shooting selesai → ke editor", "SHOOTED", "LEAD", None]],
        "SHOOTED": [["mulai", "Mulai edit", "EDITING", "PRODUKSI", None]],
        "EDITING": [["setor", "Setor hasil edit → review", "REVIEW", "PRODUKSI", "hasil"]],
        "REVIEW": [["setujui", "Setujui → siap posting", "EDITED", "LEAD", None], ["revisi", "Minta revisi", "REVISI", "LEAD", "catatan"]],
        "REVISI": [["setor", "Setor revisi → review", "REVIEW", "PRODUKSI", "hasil"]],
        "EDITED": [["mulai", "Mulai posting", "POSTING", "PUBLISHER", None]],
        "POSTING": [["tayang", "Sudah tayang di semua platform", "POSTED", "PUBLISHER", "link"]],
    },
    "DESAIN": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → ke desainer", "SCRIPTED", "LEAD", None]],
        "SCRIPTED": [["mulai", "Mulai desain", "DESIGN", "PRODUKSI", None]],
        "DESIGN": [["setor", "Setor desain", "DESIGNED", "PRODUKSI", "hasil"]],
        "DESIGNED": [["mulai", "Mulai review", "REVIEW", "LEAD", None]],
        "REVIEW": [["setujui", "Setujui → posting", "POSTING", "LEAD", None], ["revisi", "Minta revisi", "REVISI", "LEAD", "catatan"]],
        "REVISI": [["setor", "Setor revisi", "DESIGNED", "PRODUKSI", "hasil"]],
        "POSTING": [["tayang", "Sudah tayang di semua platform", "POSTED", "PUBLISHER", "link"]],
    },
    "TEKS": {
        "SCRIPTING": [["lanjut", "Copy selesai → siap posting", "SCRIPTED", "PENULIS", None]],
        "SCRIPTED": [["mulai", "Mulai posting", "POSTING", "PUBLISHER", None], ["tayang", "Sudah tayang", "POSTED", "PUBLISHER", None]],
        "POSTING": [["tayang", "Sudah tayang", "POSTED", "PUBLISHER", None]],
    },
}
INSTRUKSI = {
    "IDE": "Matangkan ide: judul, tujuan, pilar, tanggal tayang.",
    "SCRIPTING": "Tulis naskah/copy (+ caption & CTA). Tempel link naskah di kartu konten.",
    "SCRIPTED": "Naskah siap. Desainer/publisher mengambil alih.",
    "SHOOTING": "Lakukan shooting sesuai naskah.",
    "SHOOTED": "Materi shooting siap diedit.",
    "EDITING": "Edit video sesuai naskah & brand. Setor link hasil (Drive) untuk direview.",
    "DESIGN": "Desain sesuai naskah & brand. Setor link hasil (Drive/Canva).",
    "DESIGNED": "Desain disetor, menunggu review.",
    "REVIEW": "Cek hasil: materi, teks Arab/subtitle, cover, caption, CTA. Setujui atau minta revisi.",
    "REVISI": "Perbaiki sesuai catatan revisi, lalu setor ulang.",
    "EDITED": "Video disetujui. Siapkan caption & jadwal posting.",
    "POSTING": "Posting/jadwalkan di platform tujuan, tempel link tiap platform.",
    "POSTED": "Sudah tayang. 72 jam setelah tayang status otomatis menjadi Laporan.",
    "LAPORAN": "Isi angka performa (72 jam). Setelah terisi, konten otomatis Selesai.",
    "SELESAI": "Selesai.",
}
GENERIK = {"IDE": "BELUM_MULAI", "REVIEW": "MENUNGGU_REVIEW", "DESIGNED": "MENUNGGU_REVIEW", "REVISI": "REVISI", "SELESAI": "SELESAI"}


def grup_of(jenis: str) -> str:
    return JENIS[jenis]["grup"]


def alur_of(jenis: str) -> List[str]:
    return JENIS[jenis]["alur"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def deadline_status(tayang: str, jam: str, grup: str, status: str, hari_ini: Optional[date] = None):
    """(deadline, deadline_jam) untuk status ini. Target sebelum tayang yang sudah lewat dipadatkan ke hari ini."""
    hari_ini = hari_ini or datetime.now(WIB).date()
    t = date.fromisoformat(tayang)
    off = OFFSET[grup].get(status, 0)
    d = t + timedelta(days=off)
    if off < 0 and d < hari_ini:
        d = min(hari_ini, t)
    return d.isoformat(), (jam or None) if off == 0 else None


def build_konten_router(srv) -> APIRouter:
    db = srv.db
    get_current_user, user_scope = srv.get_current_user, srv.user_scope
    router = APIRouter(prefix="/konten", tags=["konten"])

    # ------------------------------------------------------------------ pengaturan & akses
    async def _settings() -> dict:
        st = await db.konten_settings.find_one({"id": "utama"}, {"_id": 0})
        if st and st.get("peran"):
            return st
        div = await db.divisi.find_one({"nama": {"$regex": "multimedia", "$options": "i"}}, {"_id": 0})
        if st and st.get("divisi_id"):
            div = await db.divisi.find_one({"id": st["divisi_id"]}, {"_id": 0}) or div
        lama = (st or {}).get("pic") or {}
        peran = {"LEAD": lama.get("NASKAH"), "PRODUKSI": lama.get("PRODUKSI"), "PUBLISHER": lama.get("POSTING")}
        if div and not all(peran.values()):
            ang = await db.anggota.find({"divisi_id": div["id"]}, {"_id": 0, "id": 1, "nama": 1}).to_list(50)
            cari = lambda kata: next((a["id"] for a in ang if kata in a["nama"].lower()), None)  # noqa: E731
            peran["LEAD"] = peran["LEAD"] or div.get("head_anggota_id") or cari("indhy")
            peran["PRODUKSI"] = peran["PRODUKSI"] or cari("rizki") or peran["LEAD"]
            peran["PUBLISHER"] = peran["PUBLISHER"] or cari("fatya") or cari("fathiya") or peran["LEAD"]
        st = {"id": "utama", "divisi_id": div["id"] if div else None, "peran": peran,
              "penulis": {k: None for k, v in JENIS.items() if v["grup"] == "TEKS"}, "updated_at": _now()}
        await db.konten_settings.replace_one({"id": "utama"}, dict(st), upsert=True)
        return st

    async def _akses(user: dict, kelola: bool = False) -> dict:
        sc = await user_scope(user)
        st = await _settings()
        anggota_tim = bool(st.get("divisi_id")) and sc["divisi_id"] == st["divisi_id"]
        lead = sc["is_spv"] or (bool(st.get("divisi_id")) and sc["head_divisi_id"] == st["divisi_id"]) \
            or (bool(sc["anggota_id"]) and sc["anggota_id"] == (st.get("peran") or {}).get("LEAD"))
        if not (sc["is_spv"] or anggota_tim or lead):
            raise HTTPException(403, "Produksi Konten khusus tim Multimedia dan SPV.")
        if kelola and not lead:
            raise HTTPException(403, "Hanya lead konten, kepala tim Multimedia, atau SPV.")
        return {**sc, "st": st, "lead": lead}

    router.akses_fn = _akses

    def _orang(st: dict, jenis: str) -> Dict[str, Optional[str]]:
        p = dict(st.get("peran") or {})
        p["PENULIS"] = (st.get("penulis") or {}).get(jenis) or p.get("LEAD")
        return p

    def _pemegang(st: dict, jenis: str, status: str) -> List[str]:
        orang = _orang(st, jenis)
        ids = [orang.get(r) for r, sset in PEMEGANG[grup_of(jenis)].items() if status in sset]
        return [i for i in dict.fromkeys(ids) if i]

    def _pelaksana(st: dict, jenis: str, status: str) -> Optional[str]:
        orang = _orang(st, jenis)
        return orang.get(PELAKSANA[grup_of(jenis)].get(status, "LEAD")) or orang.get("LEAD")

    # ------------------------------------------------------------------ model
    class KontenIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        jenis: str
        judul: str = Field(default="", max_length=300)
        tanggal_tayang: str
        jam_tayang: str = ""
        status: Optional[str] = None  # status awal (default status pertama alur)
        platforms: List[str] = Field(default_factory=list)
        isi: Dict[str, str] = Field(default_factory=dict)  # field dinamis per jenis

    class KontenUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        tanggal_tayang: Optional[str] = None
        jam_tayang: Optional[str] = None
        platforms: Optional[List[str]] = None
        isi: Optional[Dict[str, str]] = None
        hasil_url: Optional[str] = None
        links: Optional[Dict[str, str]] = None

    class AksiIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        aksi: str
        catatan: str = Field(default="", max_length=1500)
        hasil_url: str = ""
        links: Optional[Dict[str, str]] = None

    class SetStatusIn(BaseModel):
        status: str
        catatan: str = Field(default="", max_length=500)

    class PeranIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        peran: Optional[Dict[str, Optional[str]]] = None
        penulis: Optional[Dict[str, Optional[str]]] = None

    def _cek_tanggal(t: str) -> date:
        try:
            return date.fromisoformat(t)
        except (ValueError, TypeError):
            raise HTTPException(400, "Tanggal tayang tidak valid (format YYYY-MM-DD).")

    def _cek_jam(j: str) -> str:
        j = (j or "").strip()
        if j and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", j):
            raise HTTPException(400, "Jam tayang tidak valid (HH:MM).")
        return j

    def _cek_jenis(j: str) -> str:
        if j not in JENIS:
            raise HTTPException(400, "Tipe konten tidak dikenal.")
        return j

    def _cek_platform(jenis: str, p: List[str]) -> List[str]:
        if not JENIS[jenis]["platform"]:
            return [jenis]
        p = [x for x in dict.fromkeys(p or []) if x in PLATFORM]
        if not p:
            raise HTTPException(400, "Pilih minimal satu platform.")
        return p

    def _bersih_isi(jenis: str, isi: Dict[str, str]) -> Dict[str, str]:
        boleh = {f[0] for f in JENIS[jenis]["field"]}
        out = {k: (str(v) if v is not None else "").strip()[:6000] for k, v in (isi or {}).items() if k in boleh}
        if "terkait_kode" in out:
            out["terkait_kode"] = out["terkait_kode"].upper()
        if "cta_keyword" in out:
            out["cta_keyword"] = out["cta_keyword"].upper()
        if "bucket" in out:
            out["bucket"] = out["bucket"].upper()
        return out

    async def _kode_baru(prefix: str) -> str:
        mx = 0
        async for k in db.konten.find({"kode": {"$regex": f"^{prefix}-"}}, {"_id": 0, "kode": 1}):
            m = re.match(rf"{prefix}-(\d+)", k.get("kode") or "")
            if m:
                mx = max(mx, int(m.group(1)))
        # RS mulai 200 agar tidak bentrok dengan kode lama di spreadsheet yang akan dipindahkan kemudian.
        return f"{prefix}-{max(mx + 1, 200 if prefix == 'RS' else 1):03d}"

    def _judul_otomatis(jenis: str, isi: dict, tanggal: str, jam: str) -> str:
        teks = isi.get("hook") or isi.get("topik") or isi.get("isi") or ""
        teks = re.sub(r"\s+", " ", teks).strip()
        return (teks[:90] + ("…" if len(teks) > 90 else "")) if teks else f"{JENIS[jenis]['label']} {tanggal} {jam}".strip()

    # ------------------------------------------------------------------ tugas (1 konten = 1 tugas)
    async def _isi_tugas(k: dict, st: dict) -> dict:
        jenis, status = k["jenis"], k["status_konten"]
        g = grup_of(jenis)
        dl, dl_jam = deadline_status(k["tanggal_tayang"], k.get("jam_tayang") or "", g, status)
        r_id = _pelaksana(st, jenis, status)
        a_id = (st.get("peran") or {}).get("LEAD") or r_id
        catatan = INSTRUKSI.get(status, "")
        if k.get("naskah_url"):
            catatan += f"\nNaskah: {k['naskah_url']}"
        return {"nama": f"[{k['kode']}] {k['judul']}"[:300], "kategori": "KONTEN", "konten_id": k["id"], "konten_jenis": jenis,
                "konten_status": status, "konten_pemegang": _pemegang(st, jenis, status),
                "status": GENERIK.get(status, "DALAM_PROSES"), "penerima_tugas_id": r_id, "pemberi_id": a_id,
                "deadline": dl, "deadline_jam": dl_jam, "catatan_tim": catatan, "divisi_id": st.get("divisi_id"),
                "hasil_link": k.get("hasil_url") or "", "revisi_catatan": k.get("revisi_catatan") if status == "REVISI" else "",
                "brief_link": k.get("naskah_url") or "", "updated_at": _now()}

    async def _sinkron_tugas(k: dict, st: Optional[dict] = None, user: Optional[dict] = None, log: Optional[str] = None) -> None:
        st = st or await _settings()
        f = await _isi_tugas(k, st)
        lists = await srv._divisi_lists(f["divisi_id"])
        target = srv._list_for_bucket(srv._status_bucket(f["status"]), lists)
        if target:
            f["list_id"] = target
        tid = k.get("task_id")
        lama = await db.tasks.find_one({"id": tid}, {"_id": 0}) if tid else None
        if lama:
            if f["status"] == "SELESAI" and lama.get("status") != "SELESAI":
                f["selesai_at"] = _now()
            elif f["status"] != "SELESAI":
                f["selesai_at"] = None
            await db.tasks.update_one({"id": tid}, {"$set": f})
        else:
            doc = srv.Task(**{k2: v for k2, v in f.items() if k2 not in ("updated_at",)}).model_dump()
            doc.update({kk: f[kk] for kk in ("konten_id", "konten_jenis", "konten_status", "konten_pemegang")})
            doc["frekuensi"] = "SEKALI"
            await db.tasks.insert_one(doc)
            tid = doc["id"]
            await db.konten.update_one({"id": k["id"]}, {"$set": {"task_id": tid}})
            k["task_id"] = tid
            if user:
                await srv._log_activity(tid, user, "create", f"Konten {k['kode']} dibuat · status {STATUS_LABEL[k['status_konten']]}")
        if log and user:
            await srv._log_activity(tid, user, "status", log)

    async def _ubah_status(k: dict, ke: str, user: dict, catatan: str = "", extra: Optional[dict] = None) -> dict:
        dari = k["status_konten"]
        if ke not in alur_of(k["jenis"]):
            raise HTTPException(400, "Status tidak ada di alur tipe konten ini.")
        now = _now()
        upd = {"status_konten": ke, "updated_at": now, **(extra or {})}
        if ke == "POSTED" and not k.get("posted_at"):
            upd["posted_at"] = now
        if ke == "SELESAI":
            upd["selesai_at"] = now
        if ke == "REVISI":
            upd["revisi_catatan"] = catatan
            upd["revisi_count"] = (k.get("revisi_count") or 0) + 1
        riwayat = {"dari": dari, "ke": ke, "at": now, "oleh": user.get("name"), "catatan": catatan}
        await db.konten.update_one({"id": k["id"]}, {"$set": upd, "$push": {"riwayat": riwayat}})
        k.update(upd)
        k.setdefault("riwayat", []).append(riwayat)
        await _sinkron_tugas(k, user=user, log=f"Status konten: {STATUS_LABEL.get(dari, dari)} → {STATUS_LABEL[ke]}" + (f" — {catatan}" if catatan else ""))
        return k

    def _links_lengkap(k: dict) -> bool:
        if not JENIS[k["jenis"]]["platform"]:
            return True
        return all((k.get("links") or {}).get(p) for p in k.get("platforms") or [])

    def _performa_lengkap(k: dict) -> bool:
        perf = k.get("performa") or {}
        if not JENIS[k["jenis"]]["platform"]:
            return bool(perf.get(k["jenis"]))
        return all(perf.get(p) for p in k.get("platforms") or [])

    async def _otomatis(k: dict, user: dict) -> dict:
        """Transisi otomatis setelah data berubah."""
        s = k["status_konten"]
        g = grup_of(k["jenis"])
        siap_posting = {"VIDEO": {"EDITED", "POSTING"}, "DESAIN": {"POSTING"}, "TEKS": set()}[g]
        if s in siap_posting and JENIS[k["jenis"]]["platform"] and _links_lengkap(k) and k.get("links"):
            k = await _ubah_status(k, "POSTED", user, "link semua platform terisi")
            s = "POSTED"
        if s == "POSTED" and k.get("posted_at"):
            if datetime.fromisoformat(k["posted_at"]) <= datetime.now(timezone.utc) - timedelta(hours=72):
                k = await _ubah_status(k, "LAPORAN", user, "72 jam setelah tayang")
                s = "LAPORAN"
        if s == "LAPORAN" and _performa_lengkap(k):
            k = await _ubah_status(k, "SELESAI", user, "performa terisi")
        return k

    SISTEM = {"name": "Sistem", "user_id": None}

    async def jalankan_otomatis() -> int:
        """POSTED lebih dari 72 jam → LAPORAN. Dipanggil berkala dan saat daftar dibuka."""
        batas = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
        n = 0
        async for k in db.konten.find({"status": "AKTIF", "status_konten": "POSTED", "posted_at": {"$lte": batas}}, {"_id": 0}):
            await _otomatis(k, SISTEM)
            n += 1
        return n

    async def _loop():
        while True:
            try:
                await jalankan_otomatis()
            except Exception:  # noqa: BLE001 — jangan matikan loop
                pass
            await asyncio.sleep(600)

    router.mulai_loop = lambda: asyncio.create_task(_loop())

    # ------------------------------------------------------------------ hiasan respons
    async def _hiasi(rows: List[dict], st: Optional[dict] = None) -> List[dict]:
        st = st or await _settings()
        amap = {a["id"]: a["nama"] for a in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        tids = [k.get("task_id") for k in rows if k.get("task_id")]
        tasks = {t["id"]: t for t in await db.tasks.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "deadline": 1, "deadline_jam": 1,
                                                                                  "penerima_tugas_id": 1}).to_list(5000)}
        now_wib = datetime.now(WIB).strftime("%Y-%m-%dT%H:%M")
        for k in rows:
            alur = alur_of(k["jenis"])
            s = k["status_konten"]
            t = tasks.get(k.get("task_id")) or {}
            k["jenis_label"] = JENIS[k["jenis"]]["label"]
            k["grup"] = grup_of(k["jenis"])
            k["status_label"] = STATUS_LABEL.get(s, s)
            k["alur"] = [{"k": x, "label": STATUS_LABEL[x]} for x in alur]
            k["progres"] = round(alur.index(s) / (len(alur) - 1) * 100) if s in alur else 0
            k["pelaksana_id"] = t.get("penerima_tugas_id")
            k["pelaksana_nama"] = amap.get(t.get("penerima_tugas_id"))
            k["pemegang_ids"] = _pemegang(st, k["jenis"], s)
            k["pemegang_nama"] = [amap.get(i) for i in k["pemegang_ids"] if amap.get(i)]
            k["deadline"] = t.get("deadline")
            k["deadline_jam"] = t.get("deadline_jam")
            dl = f"{t.get('deadline')}T{t.get('deadline_jam') or '23:59'}" if t.get("deadline") else None
            k["terlambat"] = bool(dl and dl < now_wib and s not in ("SELESAI", "POSTED") and k.get("status") == "AKTIF")
            k["aksi"] = [{"k": a[0], "label": a[1], "ke": a[2], "peran": a[3], "wajib": a[4],
                          "oleh_id": _orang(st, k["jenis"]).get(a[3])} for a in AKSI[grup_of(k["jenis"])].get(s, [])]
        return rows

    async def _ambil(kid: str) -> dict:
        k = await db.konten.find_one({"$or": [{"id": kid}, {"kode": kid.upper()}]}, {"_id": 0})
        if not k:
            raise HTTPException(404, "Konten tidak ditemukan.")
        return k

    # ------------------------------------------------------------------ endpoint
    @router.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        a = await _akses(user)
        st = a["st"]
        amap = {x["id"]: x["nama"] for x in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        anggota_tim = await db.anggota.find({"divisi_id": st.get("divisi_id")}, {"_id": 0, "id": 1, "nama": 1}).to_list(100) if st.get("divisi_id") else []
        peran = {r: {"id": i, "nama": amap.get(i)} for r, i in (st.get("peran") or {}).items()}
        jenis = {}
        for kk, v in JENIS.items():
            g = v["grup"]
            jenis[kk] = {**{x: v[x] for x in ("label", "grup", "prefix", "platform", "field", "metrik", "slot")},
                         "alur": [{"k": s, "label": STATUS_LABEL[s], "instruksi": INSTRUKSI[s],
                                   "pelaksana": PELAKSANA[g][s], "offset": OFFSET[g][s],
                                   "pemegang": [r for r, sset in PEMEGANG[g].items() if s in sset]} for s in v["alur"]],
                         "penulis": {"id": _orang(st, kk)["PENULIS"], "nama": amap.get(_orang(st, kk)["PENULIS"])} if g == "TEKS" else None}
        return {"jenis": jenis, "status_label": STATUS_LABEL, "platform": PLATFORM, "leads": LEADS, "peran": peran,
                "bisa_kelola": a["lead"], "divisi_id": st.get("divisi_id"), "anggota_id": a["anggota_id"],
                "anggota_tim": anggota_tim, "is_spv": a["is_spv"]}

    @router.get("")
    async def daftar(dari: Optional[str] = None, sampai: Optional[str] = None, q: Optional[str] = None,
                     jenis: Optional[str] = None, status_konten: Optional[str] = None,
                     arsip: bool = False, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        await jalankan_otomatis()
        f: dict = {"status": {"$in": ["AKTIF", "ARSIP"]}} if arsip else {"status": "AKTIF"}
        if dari or sampai:
            f["tanggal_tayang"] = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
        if jenis:
            f["jenis"] = {"$in": jenis.split(",")}
        if status_konten:
            f["status_konten"] = {"$in": status_konten.split(",")}
        if q:
            rx = {"$regex": re.escape(q), "$options": "i"}
            f["$or"] = [{"judul": rx}, {"kode": rx}, {"pilar": rx}, {"isi": rx}, {"hook": rx}, {"topik": rx}]
        rows = await db.konten.find(f, {"_id": 0}).sort([("tanggal_tayang", 1), ("jam_tayang", 1)]).to_list(3000)
        return await _hiasi(rows, a["st"])

    async def buat_satu(payload: KontenIn, user: dict, a: dict) -> dict:
        jenis = _cek_jenis(payload.jenis)
        _cek_tanggal(payload.tanggal_tayang)
        jam = _cek_jam(payload.jam_tayang)
        isi = _bersih_isi(jenis, payload.isi)
        status = payload.status or alur_of(jenis)[0]
        if status not in alur_of(jenis):
            raise HTTPException(400, "Status awal tidak ada di alur tipe ini.")
        judul = (payload.judul or "").strip() or _judul_otomatis(jenis, isi, payload.tanggal_tayang, jam)
        if len(judul) < 3:
            raise HTTPException(400, "Judul minimal 3 huruf.")
        now = _now()
        doc = {"id": str(uuid.uuid4()), "kode": await _kode_baru(JENIS[jenis]["prefix"]), "jenis": jenis, "judul": judul,
               "tanggal_tayang": payload.tanggal_tayang, "jam_tayang": jam, "platforms": _cek_platform(jenis, payload.platforms),
               **isi, "status_konten": status, "status": "AKTIF", "links": {}, "performa": {}, "hasil_url": "",
               "riwayat": [{"dari": None, "ke": status, "at": now, "oleh": user.get("name"), "catatan": "dibuat"}],
               "dibuat_oleh": user.get("name"), "created_at": now, "updated_at": now}
        await db.konten.insert_one(dict(doc))
        doc.pop("_id", None)
        await _sinkron_tugas(doc, a["st"], user)
        return doc

    @router.post("")
    async def buat(payload: KontenIn, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        if not a["lead"] and not (JENIS.get(payload.jenis, {}).get("grup") == "TEKS"
                                  and a["anggota_id"] == _orang(a["st"], payload.jenis)["PENULIS"]):
            raise HTTPException(403, "Konten baru dibuat oleh lead konten (atau penulis kanal teks).")
        doc = await buat_satu(payload, user, a)
        return (await _hiasi([doc], a["st"]))[0]

    class BanyakIn(BaseModel):
        items: List[KontenIn] = Field(min_length=1, max_length=60)

    @router.post("/banyak")
    async def buat_banyak(payload: BanyakIn, user: dict = Depends(get_current_user)):
        """Buat beberapa konten sekaligus (mis. jadwal Threads satu pekan). Tiap post = satu konten = satu tugas."""
        a = await _akses(user)
        for it in payload.items:
            _cek_jenis(it.jenis)
            if not a["lead"] and not (JENIS[it.jenis]["grup"] == "TEKS" and a["anggota_id"] == _orang(a["st"], it.jenis)["PENULIS"]):
                raise HTTPException(403, "Konten baru dibuat oleh lead konten (atau penulis kanal teks).")
            _cek_tanggal(it.tanggal_tayang)
            _cek_jam(it.jam_tayang)
        out = [await buat_satu(it, user, a) for it in payload.items]
        return await _hiasi(out, a["st"])

    @router.get("/{kid}")
    async def detail(kid: str, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        return (await _hiasi([await _ambil(kid)], a["st"]))[0]

    def _boleh_peran(a: dict, k: dict, peran: str) -> bool:
        return a["lead"] or (bool(a["anggota_id"]) and _orang(a["st"], k["jenis"]).get(peran) == a["anggota_id"])

    def _boleh_ubah(a: dict, k: dict) -> bool:
        """Lead/SPV, atau pemegang status saat ini, boleh mengubah isi kartu."""
        return a["lead"] or (bool(a["anggota_id"]) and a["anggota_id"] in _pemegang(a["st"], k["jenis"], k["status_konten"]))

    @router.put("/{kid}")
    async def ubah(kid: str, payload: KontenUpd, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        k = await _ambil(kid)
        if not _boleh_ubah(a, k):
            raise HTTPException(403, "Kartu ini sedang dipegang orang lain. Hanya pemegang status saat ini, lead, atau SPV yang bisa mengubah.")
        upd = {}
        data = payload.model_dump(exclude_unset=True)
        if "judul" in data and data["judul"] is not None:
            if len(data["judul"].strip()) < 3:
                raise HTTPException(400, "Judul minimal 3 huruf.")
            upd["judul"] = data["judul"].strip()[:300]
        if data.get("tanggal_tayang"):
            _cek_tanggal(data["tanggal_tayang"])
            upd["tanggal_tayang"] = data["tanggal_tayang"]
        if data.get("jam_tayang") is not None:
            upd["jam_tayang"] = _cek_jam(data["jam_tayang"])
        if data.get("platforms") is not None:
            upd["platforms"] = _cek_platform(k["jenis"], data["platforms"])
        if data.get("isi") is not None:
            upd.update(_bersih_isi(k["jenis"], data["isi"]))
        if data.get("hasil_url") is not None:
            upd["hasil_url"] = data["hasil_url"].strip()
        if data.get("links") is not None:
            plats = upd.get("platforms") or k.get("platforms") or []
            upd["links"] = {p: (v or "").strip() for p, v in data["links"].items() if p in plats and (v or "").strip()}
        if not upd:
            return (await _hiasi([k], a["st"]))[0]
        upd["updated_at"] = _now()
        await db.konten.update_one({"id": k["id"]}, {"$set": upd})
        k.update(upd)
        await _sinkron_tugas(k, a["st"], user)
        k = await _otomatis(k, user)
        return (await _hiasi([k], a["st"]))[0]

    async def jalankan_aksi(k: dict, payload: AksiIn, user: dict, a: dict) -> dict:
        daftar_aksi = AKSI[grup_of(k["jenis"])].get(k["status_konten"], [])
        akt = next((x for x in daftar_aksi if x[0] == payload.aksi), None)
        if not akt:
            raise HTTPException(400, f"Aksi '{payload.aksi}' tidak tersedia pada status {STATUS_LABEL[k['status_konten']]}.")
        _, label, ke, peran, wajib = akt
        if not _boleh_peran(a, k, peran):
            nama = (await db.anggota.find_one({"id": _orang(a["st"], k["jenis"]).get(peran)}, {"_id": 0, "nama": 1}) or {}).get("nama")
            raise HTTPException(403, f"Langkah ini dikerjakan oleh {nama or peran} (atau lead/SPV).")
        extra = {}
        if wajib == "catatan" and len(payload.catatan.strip()) < 3:
            raise HTTPException(400, "Tulis apa yang perlu diperbaiki.")
        if wajib == "hasil":
            hasil = payload.hasil_url.strip() or k.get("hasil_url") or ""
            if not hasil:
                raise HTTPException(400, "Tempel link hasil (Drive/Canva) dulu.")
            extra["hasil_url"] = hasil
        if payload.links:
            extra["links"] = {**(k.get("links") or {}), **{p: v.strip() for p, v in payload.links.items() if p in (k.get("platforms") or []) and v.strip()}}
        if wajib == "link" and not _links_lengkap({**k, **extra}):
            raise HTTPException(400, "Isi link tayang untuk semua platform tujuan.")
        if ke in ("EDITED", "POSTING") and payload.aksi == "setujui":
            extra["revisi_catatan"] = ""
        k = await _ubah_status(k, ke, user, payload.catatan.strip(), extra)
        return await _otomatis(k, user)

    @router.post("/{kid}/aksi")
    async def aksi(kid: str, payload: AksiIn, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        k = await _ambil(kid)
        if k.get("status") != "AKTIF":
            raise HTTPException(400, "Konten tidak aktif.")
        k = await jalankan_aksi(k, payload, user, a)
        return (await _hiasi([k], a["st"]))[0]

    @router.post("/{kid}/status")
    async def set_status(kid: str, payload: SetStatusIn, user: dict = Depends(get_current_user)):
        """Lead/SPV memindah status secara manual (koreksi)."""
        a = await _akses(user, kelola=True)
        k = await _ambil(kid)
        if payload.status == k["status_konten"]:
            return (await _hiasi([k], a["st"]))[0]
        extra = {}
        if payload.status == "POSTED":
            extra["posted_at"] = k.get("posted_at") or _now()
        k = await _ubah_status(k, payload.status, user, payload.catatan.strip() or "diubah manual", extra)
        return (await _hiasi([k], a["st"]))[0]

    @router.put("/{kid}/performa")
    async def isi_performa(kid: str, data: Dict[str, object], user: dict = Depends(get_current_user)):
        """Body: {platform: "IG", views: 100, ...}. Kanal teks: platform boleh dikosongkan."""
        a = await _akses(user)
        k = await _ambil(kid)
        if not (_boleh_peran(a, k, "PUBLISHER") or _boleh_ubah(a, k)):
            raise HTTPException(403, "Performa diisi oleh publisher, lead, atau SPV.")
        if k["status_konten"] not in ("POSTED", "LAPORAN", "SELESAI"):
            raise HTTPException(400, "Performa diisi setelah konten tayang.")
        plat = str(data.get("platform") or (k["jenis"] if not JENIS[k["jenis"]]["platform"] else ""))
        if plat not in (k.get("platforms") or []):
            raise HTTPException(400, "Platform tidak termasuk tujuan konten ini.")
        boleh = {m[0] for m in JENIS[k["jenis"]]["metrik"]} | {x[0] for x in LEADS}
        bersih = {}
        for f, v in data.items():
            if f in boleh and v not in (None, ""):
                try:
                    bersih[f] = max(0, int(v))
                except (TypeError, ValueError):
                    raise HTTPException(400, f"Angka {f} tidak valid.")
        if not bersih:
            raise HTTPException(400, "Isi minimal satu angka.")
        perf = dict(k.get("performa") or {})
        perf[plat] = {**bersih, "diisi_at": _now(), "oleh": user.get("name")}
        await db.konten.update_one({"id": k["id"]}, {"$set": {"performa": perf, "updated_at": _now()}})
        k["performa"] = perf
        k = await _otomatis(k, user)
        return (await _hiasi([k], a["st"]))[0]

    @router.post("/{kid}/batal")
    async def batal(kid: str, user: dict = Depends(get_current_user)):
        a = await _akses(user, kelola=True)
        k = await _ambil(kid)
        await db.konten.update_one({"id": k["id"]}, {"$set": {"status": "BATAL", "updated_at": _now()}})
        if k.get("task_id"):
            await db.tasks.update_one({"id": k["task_id"]}, {"$set": {"archived": True, "archived_at": _now()}})
            await srv._log_activity(k["task_id"], user, "status", "Konten dibatalkan")
        return {"ok": True}

    @router.get("/rekap/performa")
    async def rekap(dari: Optional[str] = None, sampai: Optional[str] = None, jenis: Optional[str] = None,
                    user: dict = Depends(get_current_user)):
        await _akses(user)
        f: dict = {"status": {"$in": ["AKTIF", "ARSIP"]}, "performa": {"$exists": True, "$ne": {}}}
        if dari or sampai:
            f["tanggal_tayang"] = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
        if jenis:
            f["jenis"] = {"$in": jenis.split(",")}
        rows = await db.konten.find(f, {"_id": 0}).to_list(5000)
        INTER = ("likes", "comments", "saves", "shares", "replies", "reposts", "quotes", "sticker_taps", "reaksi")
        grup: Dict[str, Dict[str, dict]] = {"jenis": {}, "platform": {}, "pilar": {}, "bucket": {}}
        top = []
        for k in rows:
            tot = {"views": 0, "reach": 0, "inter": 0, "leads": 0, "daftar": 0}
            for plat, m in (k.get("performa") or {}).items():
                v = {"views": m.get("views") or 0, "reach": m.get("reach") or 0, "inter": sum(m.get(x) or 0 for x in INTER),
                     "leads": (m.get("dm") or 0) + (m.get("tanya_harga") or 0) + (m.get("tanya_program") or 0) + (m.get("voice_note") or 0),
                     "daftar": m.get("pendaftaran") or 0}
                for x in tot:
                    tot[x] += v[x]
                nama = PLATFORM.get(plat) or JENIS.get(plat, {}).get("label") or plat
                g = grup["platform"].setdefault(nama, {"konten": 0, **{x: 0 for x in tot}})
                g["konten"] += 1
                for x in tot:
                    g[x] += v[x]
            for dim, key in (("jenis", JENIS[k["jenis"]]["label"]), ("pilar", k.get("pilar") or "—"), ("bucket", k.get("bucket") or "—")):
                g = grup[dim].setdefault(key, {"konten": 0, **{x: 0 for x in tot}})
                g["konten"] += 1
                for x in tot:
                    g[x] += tot[x]
            top.append({"id": k["id"], "kode": k["kode"], "judul": k["judul"], "jenis": k["jenis"], "tanggal_tayang": k["tanggal_tayang"], **tot})

        def rapi(d: Dict[str, dict]) -> List[dict]:
            out = []
            for n, v in d.items():
                out.append({"nama": n, **v, "rata_views": round(v["views"] / v["konten"]) if v["konten"] else None,
                            "er": round(v["inter"] / v["reach"] * 100, 1) if v["reach"] else None})
            return sorted(out, key=lambda x: -(x["rata_views"] or 0))

        return {"jumlah_konten": len(rows), **{d: rapi(v) for d, v in grup.items()},
                "top_views": sorted(top, key=lambda x: -x["views"])[:5], "top_leads": sorted(top, key=lambda x: -x["leads"])[:5]}

    @router.put("/pengaturan/peran")
    async def ubah_peran(payload: PeranIn, user: dict = Depends(get_current_user)):
        a = await _akses(user, kelola=True)
        st = a["st"]
        upd = {}
        for key, src, boleh in (("peran", payload.peran, {"LEAD", "PRODUKSI", "PUBLISHER"}),
                                ("penulis", payload.penulis, {k for k, v in JENIS.items() if v["grup"] == "TEKS"})):
            if src is None:
                continue
            for r, aid in src.items():
                if r in boleh and aid and not await db.anggota.find_one({"id": aid}, {"_id": 1}):
                    raise HTTPException(400, "Anggota tidak ditemukan.")
            upd[key] = {**(st.get(key) or {}), **{r: (v or None) for r, v in src.items() if r in boleh}}
        if upd:
            await db.konten_settings.update_one({"id": "utama"}, {"$set": {**upd, "updated_at": _now()}})
            st = await _settings()
            # Pemegang & pelaksana tugas konten aktif ikut diperbarui.
            async for k in db.konten.find({"status": "AKTIF"}, {"_id": 0}):
                await _sinkron_tugas(k, st)
        return await meta(user)

    # Fungsi untuk modul lain (MCP, server).
    router.ambil = _ambil
    router.hiasi = _hiasi
    router.buat_satu = buat_satu
    router.jalankan_aksi = jalankan_aksi
    router.KontenIn, router.KontenUpd, router.AksiIn = KontenIn, KontenUpd, AksiIn
    router.ubah_fn = ubah
    router.buat_fn, router.aksi_fn, router.daftar_fn, router.detail_fn = buat, aksi, daftar, detail
    router.performa_fn = isi_performa
    return router
