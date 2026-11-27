"""Produksi Konten (tim Multimedia) v3: SATU konten = SATU tugas, status khusus per tipe & tujuan.

Alur (grup):
  VIDEO        Reels organik : IDE → SCRIPTING → SHOOTING → SHOOTED → EDITING → REVIEW ⇄ REVISI → POSTING → POSTED → LAPORAN → SELESAI
  DESAIN       Carousel/Single organik : IDE → SCRIPTING → SCRIPTED → DESIGN → REVIEW ⇄ REVISI → POSTING → POSTED → LAPORAN → SELESAI
  VIDEO_IKLAN  Reels untuk iklan : … EDITING → REVIEW ⇄ REVISI → EDITED → IKLAN_AKTIF → LAPORAN → SELESAI
  DESAIN_IKLAN Carousel/Single untuk iklan : … DESIGN → REVIEW ⇄ REVISI → DESIGNED → IKLAN_AKTIF → LAPORAN → SELESAI
  TEKS         Threads / IG Story / WA Channel (1 post = 1 konten) : SCRIPTING → SCRIPTED → POSTING → POSTED → LAPORAN → SELESAI
  KOL          KOL/UGC : SHORTLIST → OUTREACH → DEAL → BRIEF → DRAFT → REVIEW ⇄ REVISI → POSTING → POSTED → LAPORAN → SELESAI

Jadwal: tiap platform punya tanggal & jam posting sendiri (konten.jadwal). Satu tugas produksi; target produksi
(status produksi/review) = H-1 dari jadwal posting TERDEKAT, kecuali ada permintaan deadline yang disetujui lead.
Konten iklan: tanggal = jadwal PRODUKSI (siap iklan), tidak terikat jadwal posting; tidak melibatkan publisher.

Peran: LEAD (Indhy), PRODUKSI (Rizki), PUBLISHER (Fatya), IKLAN (Kang Nurdin); penulis kanal teks per kanal (default LEAD).
Otomatis: link semua platform → POSTED; POSTED + 72 jam → LAPORAN; laporan terisi → SELESAI.
"""
import asyncio
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

WIB = timezone(timedelta(hours=7))

ALUR = {
    "VIDEO": ["IDE", "SCRIPTING", "SHOOTING", "SHOOTED", "EDITING", "REVIEW", "REVISI", "POSTING", "POSTED", "LAPORAN", "SELESAI"],
    "DESAIN": ["IDE", "SCRIPTING", "SCRIPTED", "DESIGN", "REVIEW", "REVISI", "POSTING", "POSTED", "LAPORAN", "SELESAI"],
    "VIDEO_IKLAN": ["IDE", "SCRIPTING", "SHOOTING", "SHOOTED", "EDITING", "REVIEW", "REVISI", "EDITED", "IKLAN_AKTIF", "LAPORAN", "SELESAI"],
    "DESAIN_IKLAN": ["IDE", "SCRIPTING", "SCRIPTED", "DESIGN", "REVIEW", "REVISI", "DESIGNED", "IKLAN_AKTIF", "LAPORAN", "SELESAI"],
    "TEKS": ["SCRIPTING", "SCRIPTED", "POSTING", "POSTED", "LAPORAN", "SELESAI"],
    "KOL": ["SHORTLIST", "OUTREACH", "DEAL", "BRIEF", "DRAFT", "REVIEW", "REVISI", "POSTING", "POSTED", "LAPORAN", "SELESAI"],
}
STATUS_LABEL = {"IDE": "Ide", "SCRIPTING": "Scripting", "SCRIPTED": "Scripted", "SHOOTING": "Shooting", "SHOOTED": "Shooted",
                "EDITING": "Editing", "DESIGN": "Design", "DESIGNED": "Designed", "REVIEW": "Review", "REVISI": "Revisi",
                "EDITED": "Edited", "IKLAN_AKTIF": "Iklan aktif", "POSTING": "Posting", "POSTED": "Posted", "LAPORAN": "Laporan",
                "SELESAI": "Selesai", "SHORTLIST": "Shortlist", "OUTREACH": "Outreach & nego", "DEAL": "Deal", "BRIEF": "Brief",
                "DRAFT": "Draft kreator"}
PLATFORM = {"IG": "Instagram", "TIKTOK": "TikTok", "SHORT": "YT Short", "YT": "YouTube", "IKLAN": "Iklan"}
PLATFORM_KOL = {"IG": "Instagram", "TIKTOK": "TikTok", "SHORT": "YT Short", "YT": "YouTube", "FB": "Facebook"}
LEADS = [["tanya_harga", "Tanya harga"], ["tanya_program", "Tanya program"], ["voice_note", "Voice note"], ["pendaftaran", "Pendaftaran"]]
METRIK_FEED = [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["comments", "Komentar"], ["saves", "Simpan"],
               ["shares", "Bagikan"], ["follows", "Follow"], ["dm", "DM / tanya"]]
METRIK_IKLAN = [["spend", "Spend (Rp)"], ["impressions", "Impresi"], ["reach", "Reach"], ["clicks", "Klik"], ["leads", "Leads"],
                ["pendaftaran", "Pendaftaran"]]

# field: [kunci, label, tipe]  tipe: teks | area | url | angka | bucket | pilih:a,b,c
F_DASAR = [["pilar", "Pilar", "teks"], ["bucket", "Bucket", "bucket"], ["funnel", "Funnel", "pilih:Awareness,Consideration,Conversion"],
           ["cta_keyword", "Kata kunci CTA", "teks"]]
F_IKLAN = [["iklan_campaign", "Nama campaign / ad set", "teks"], ["iklan_url", "Link Ads Manager", "url"]]
JENIS: Dict[str, dict] = {
    "REELS": {"label": "Reels / Video", "prefix": "RS", "platform": True, "slot": [],
              "field": F_DASAR + [["naskah_talent_url", "Naskah talent", "url"], ["naskah_editor_url", "Naskah editor", "url"],
                                  ["brief", "Brief singkat", "area"]]},
    "CAROUSEL": {"label": "Carousel", "prefix": "RS", "platform": True, "slot": [],
                 "field": F_DASAR + [["naskah_url", "Naskah desain", "url"], ["brief", "Brief singkat", "area"]]},
    "SINGLE": {"label": "Single image", "prefix": "RS", "platform": True, "slot": [],
               "field": F_DASAR + [["naskah_url", "Naskah desain", "url"], ["brief", "Brief singkat", "area"]]},
    "THREADS": {"label": "Threads", "prefix": "TH", "platform": False, "slot": [["07:30", "Post 1"], ["12:00", "Post 2"], ["15:30", "Post 3"]],
                "field": [["label", "Utas", "teks"], ["format", "Format", "teks"], ["hook", "Hook", "area"], ["isi", "Isi", "area"],
                          ["cta", "CTA", "area"], ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
                "metrik": [["views", "Views"], ["likes", "Likes"], ["replies", "Replies"], ["reposts", "Reposts"], ["quotes", "Quotes"],
                           ["shares", "Shares"], ["link_clicks", "Klik link"], ["profile_visits", "Kunjungan profil"], ["follows", "Follow"]]},
    "STORY": {"label": "IG Story", "prefix": "SG", "platform": False, "slot": [["08:00", "Slide 1"], ["14:30", "Slide 2"]],
              "field": [["label", "Slide", "teks"], ["isi", "Copy", "area"], ["stiker", "Stiker", "pilih:Polling,Kuis,Pertanyaan,Link,Slider"],
                        ["bucket", "Bucket", "bucket"], ["pilar", "Pilar", "teks"]],
              "metrik": [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["replies", "Replies"], ["shares", "Shares"],
                         ["link_clicks", "Klik link"], ["sticker_taps", "Sticker taps"], ["follows", "Follow"], ["profile_visits", "Kunjungan profil"],
                         ["forward", "Forward"], ["back", "Back"], ["exits", "Exits"]]},
    "WA": {"label": "WA Channel", "prefix": "WA", "platform": False, "slot": [["09:00", ""]],
           "field": [["format", "Format", "pilih:Teks,Copywriting + Link,PDF,Audio,Polling,Video,Stiker"], ["topik", "Topik", "teks"],
                     ["isi", "Copywriting", "area"], ["lampiran_url", "Link / lampiran", "url"], ["terkait_kode", "Terkait konten (RS-xxx)", "teks"]],
           "metrik": [["views", "Views"], ["reaksi", "Reaksi"], ["link_clicks", "Klik link"]]},
    "KOL": {"label": "KOL / UGC", "prefix": "KOL", "platform": True, "slot": [],
            "field": [["nama_kreator", "Nama kreator", "teks"], ["akun_url", "Akun kreator", "url"],
                      ["jenis_kreator", "Jenis", "pilih:KOL,UGC,Hybrid"], ["followers", "Followers", "teks"],
                      ["skema", "Skema kerja sama", "pilih:Paid,Barter,Affiliate,Paid + Affiliate,Pro bono"], ["biaya", "Biaya / rate (Rp)", "angka"],
                      ["hak_pakai", "Hak penggunaan", "pilih:Organik saja,Organik + iklan,Organik + repost"], ["kontak", "Kontak", "teks"],
                      ["brief_url", "Link brief / agreement", "url"], ["pilar", "Pilar", "teks"], ["cta_keyword", "Kata kunci CTA / kode", "teks"],
                      ["pesan_utama", "Pesan utama & catatan", "area"]],
            "metrik": [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["comments", "Komentar"], ["saves", "Simpan"],
                       ["shares", "Bagikan"], ["clicks", "Klik link"], ["dm", "DM / tanya"]]},
}
for _j in ("REELS", "CAROUSEL", "SINGLE"):
    JENIS[_j]["metrik"] = METRIK_FEED
TEKS_JENIS = {"THREADS", "STORY", "WA"}


def is_iklan(k: dict) -> bool:
    return k.get("jenis") in ("REELS", "CAROUSEL", "SINGLE") and (k.get("platforms") or []) == ["IKLAN"]


def grup_of(jenis: str, iklan: bool = False) -> str:
    if jenis in TEKS_JENIS:
        return "TEKS"
    if jenis == "KOL":
        return "KOL"
    g = "VIDEO" if jenis == "REELS" else "DESAIN"
    return g + "_IKLAN" if iklan else g


def grup_k(k: dict) -> str:
    return grup_of(k["jenis"], is_iklan(k))


def field_of(jenis: str, iklan: bool) -> List[list]:
    return JENIS[jenis]["field"] + (F_IKLAN if iklan else [])


def metrik_of(jenis: str, iklan: bool) -> List[list]:
    return METRIK_IKLAN if iklan else JENIS[jenis]["metrik"]


def _sampai(alur: List[str], s: str) -> set:
    return set(alur[:alur.index(s) + 1])


# Siapa melihat tugasnya (Tugas › Untuk saya) per status.
PEMEGANG = {
    "VIDEO": {"LEAD": _sampai(ALUR["VIDEO"], "POSTED"),
              "PRODUKSI": {"SHOOTED", "EDITING", "REVIEW", "REVISI", "POSTING", "POSTED"},
              "PUBLISHER": {"POSTING", "POSTED", "LAPORAN", "SELESAI"}},
    "DESAIN": {"LEAD": _sampai(ALUR["DESAIN"], "POSTED"),
               "PRODUKSI": {"SCRIPTED", "DESIGN", "REVIEW", "REVISI", "POSTING", "POSTED"},
               "PUBLISHER": {"POSTING", "POSTED", "LAPORAN", "SELESAI"}},
    "VIDEO_IKLAN": {"LEAD": _sampai(ALUR["VIDEO_IKLAN"], "IKLAN_AKTIF"),
                    "PRODUKSI": {"SHOOTED", "EDITING", "REVIEW", "REVISI", "EDITED"},
                    "IKLAN": {"EDITED", "IKLAN_AKTIF", "LAPORAN", "SELESAI"}},
    "DESAIN_IKLAN": {"LEAD": _sampai(ALUR["DESAIN_IKLAN"], "IKLAN_AKTIF"),
                     "PRODUKSI": {"SCRIPTED", "DESIGN", "REVIEW", "REVISI", "DESIGNED"},
                     "IKLAN": {"DESIGNED", "IKLAN_AKTIF", "LAPORAN", "SELESAI"}},
    "TEKS": {"LEAD": {"SCRIPTING", "SCRIPTED", "POSTING", "POSTED"}, "PENULIS": {"SCRIPTING"},
             "PUBLISHER": {"SCRIPTED", "POSTING", "POSTED", "LAPORAN", "SELESAI"}},
    "KOL": {"LEAD": _sampai(ALUR["KOL"], "POSTED"),
            "PUBLISHER": set(ALUR["KOL"]) - {"SHORTLIST"}},
}
_P = "PRODUKSI"
PELAKSANA = {
    "VIDEO": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SHOOTING": "LEAD", "SHOOTED": _P, "EDITING": _P, "REVIEW": "LEAD", "REVISI": _P,
              "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
    "DESAIN": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SCRIPTED": _P, "DESIGN": _P, "REVIEW": "LEAD", "REVISI": _P,
               "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
    "VIDEO_IKLAN": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SHOOTING": "LEAD", "SHOOTED": _P, "EDITING": _P, "REVIEW": "LEAD", "REVISI": _P,
                    "EDITED": "IKLAN", "IKLAN_AKTIF": "IKLAN", "LAPORAN": "IKLAN", "SELESAI": "IKLAN"},
    "DESAIN_IKLAN": {"IDE": "LEAD", "SCRIPTING": "LEAD", "SCRIPTED": _P, "DESIGN": _P, "REVIEW": "LEAD", "REVISI": _P,
                     "DESIGNED": "IKLAN", "IKLAN_AKTIF": "IKLAN", "LAPORAN": "IKLAN", "SELESAI": "IKLAN"},
    "TEKS": {"SCRIPTING": "PENULIS", "SCRIPTED": "PUBLISHER", "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
    "KOL": {"SHORTLIST": "LEAD", "OUTREACH": "PUBLISHER", "DEAL": "PUBLISHER", "BRIEF": "LEAD", "DRAFT": "PUBLISHER", "REVIEW": "LEAD",
            "REVISI": "PUBLISHER", "POSTING": "PUBLISHER", "POSTED": "PUBLISHER", "LAPORAN": "PUBLISHER", "SELESAI": "PUBLISHER"},
}
# Status produksi/review: target = deadline produksi (H-1 jadwal posting terdekat, atau hasil permintaan yang disetujui).
PRODUKSI_STATUS = {"SHOOTED", "EDITING", "SCRIPTED", "DESIGN", "REVIEW", "REVISI"}
# Target status sebelum produksi, hari relatif terhadap jadwal posting terdekat.
OFFSET_AWAL = {"IDE": -7, "SCRIPTING": -5, "SHOOTING": -3, "SHORTLIST": -14, "OUTREACH": -12, "DEAL": -9, "BRIEF": -8, "DRAFT": -4}
# Aksi: [kunci, label, tujuan, peran, wajib]
_SETOR_VIDEO = ["setor", "Setor hasil edit → review", "REVIEW", _P, "hasil"]
_SETOR_DESAIN = ["setor", "Setor desain → review", "REVIEW", _P, "hasil"]
_REVISI = ["revisi", "Minta revisi", "REVISI", "LEAD", "catatan"]
_TAYANG = ["tayang", "Sudah tayang di semua platform", "POSTED", "PUBLISHER", "link"]
_LAP_IKLAN = ["laporan", "Iklan selesai → isi laporan", "LAPORAN", "IKLAN", None]
AKSI = {
    "VIDEO": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → shooting", "SHOOTING", "LEAD", None]],
        "SHOOTING": [["lanjut", "Shooting selesai → ke editor", "SHOOTED", "LEAD", None]],
        "SHOOTED": [["mulai", "Mulai edit", "EDITING", _P, None]],
        "EDITING": [_SETOR_VIDEO],
        "REVIEW": [["setujui", "Setujui → posting", "POSTING", "LEAD", None], _REVISI],
        "REVISI": [["setor", "Setor revisi → review", "REVIEW", _P, "hasil"]],
        "POSTING": [_TAYANG],
    },
    "DESAIN": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → ke desainer", "SCRIPTED", "LEAD", None]],
        "SCRIPTED": [["mulai", "Mulai desain", "DESIGN", _P, None]],
        "DESIGN": [_SETOR_DESAIN],
        "REVIEW": [["setujui", "Setujui → posting", "POSTING", "LEAD", None], _REVISI],
        "REVISI": [["setor", "Setor revisi → review", "REVIEW", _P, "hasil"]],
        "POSTING": [_TAYANG],
    },
    "VIDEO_IKLAN": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → shooting", "SHOOTING", "LEAD", None]],
        "SHOOTING": [["lanjut", "Shooting selesai → ke editor", "SHOOTED", "LEAD", None]],
        "SHOOTED": [["mulai", "Mulai edit", "EDITING", _P, None]],
        "EDITING": [_SETOR_VIDEO],
        "REVIEW": [["setujui", "Setujui → ke tim iklan", "EDITED", "LEAD", None], _REVISI],
        "REVISI": [["setor", "Setor revisi → review", "REVIEW", _P, "hasil"]],
        "EDITED": [["pasang", "Iklan sudah dipasang", "IKLAN_AKTIF", "IKLAN", "iklan"]],
        "IKLAN_AKTIF": [_LAP_IKLAN],
    },
    "DESAIN_IKLAN": {
        "IDE": [["mulai", "Mulai tulis naskah", "SCRIPTING", "LEAD", None]],
        "SCRIPTING": [["lanjut", "Naskah selesai → ke desainer", "SCRIPTED", "LEAD", None]],
        "SCRIPTED": [["mulai", "Mulai desain", "DESIGN", _P, None]],
        "DESIGN": [_SETOR_DESAIN],
        "REVIEW": [["setujui", "Setujui → ke tim iklan", "DESIGNED", "LEAD", None], _REVISI],
        "REVISI": [["setor", "Setor revisi → review", "REVIEW", _P, "hasil"]],
        "DESIGNED": [["pasang", "Iklan sudah dipasang", "IKLAN_AKTIF", "IKLAN", "iklan"]],
        "IKLAN_AKTIF": [_LAP_IKLAN],
    },
    "TEKS": {
        "SCRIPTING": [["lanjut", "Copy selesai → siap posting", "SCRIPTED", "PENULIS", None]],
        "SCRIPTED": [["mulai", "Mulai posting", "POSTING", "PUBLISHER", None], ["tayang", "Sudah tayang", "POSTED", "PUBLISHER", None]],
        "POSTING": [["tayang", "Sudah tayang", "POSTED", "PUBLISHER", None]],
    },
    "KOL": {
        "SHORTLIST": [["lanjut", "Layak → mulai outreach", "OUTREACH", "LEAD", None]],
        "OUTREACH": [["deal", "Kreator setuju (deal)", "DEAL", "PUBLISHER", None]],
        "DEAL": [["lanjut", "Kesepakatan & hak pakai beres → brief", "BRIEF", "PUBLISHER", None]],
        "BRIEF": [["kirim", "Brief dikirim ke kreator", "DRAFT", "LEAD", "brief"]],
        "DRAFT": [["setor", "Draft masuk → review", "REVIEW", "PUBLISHER", "hasil"]],
        "REVIEW": [["setujui", "Setujui → posting", "POSTING", "LEAD", None], _REVISI],
        "REVISI": [["setor", "Draft revisi masuk → review", "REVIEW", "PUBLISHER", "hasil"]],
        "POSTING": [["tayang", "Sudah tayang di semua platform", "POSTED", "PUBLISHER", "link"]],
    },
}
INSTRUKSI = {
    "IDE": "Matangkan ide: judul, tujuan, pilar, jadwal.",
    "SCRIPTING": "Tulis naskah/copy (+ caption & CTA). Tempel link naskah di kartu konten.",
    "SCRIPTED": "Naskah siap. Desainer/publisher mengambil alih.",
    "SHOOTING": "Lakukan shooting sesuai naskah talent.",
    "SHOOTED": "Materi shooting siap diedit (pakai naskah editor).",
    "EDITING": "Edit video sesuai naskah editor & brand. Setor link hasil (Drive) untuk direview.",
    "DESIGN": "Desain sesuai naskah & brand. Setor link hasil (Drive/Canva) untuk direview.",
    "REVIEW": "Cek hasil: materi, teks Arab/subtitle, cover, caption, CTA. Setujui atau minta revisi.",
    "REVISI": "Perbaiki sesuai catatan revisi, lalu setor ulang untuk direview.",
    "EDITED": "Video lolos review. Tim iklan memasang iklan.",
    "DESIGNED": "Desain lolos review. Tim iklan memasang iklan.",
    "IKLAN_AKTIF": "Iklan berjalan. Setelah selesai/cukup data, isi laporan iklan.",
    "POSTING": "Posting/jadwalkan sesuai jadwal tiap platform, tempel link tiap platform.",
    "POSTED": "Sudah tayang. 72 jam setelah tayang status otomatis menjadi Laporan.",
    "LAPORAN": "Isi angka performa. Setelah terisi, konten otomatis Selesai.",
    "SELESAI": "Selesai.",
    "SHORTLIST": "Cek kelayakan kreator: audiens relevan, nilai aman, kontak tersedia.",
    "OUTREACH": "Hubungi kreator: penawaran awal & negosiasi (fee/barter, deliverable, jadwal).",
    "DEAL": "Catat kesepakatan: skema, biaya, hak penggunaan, jadwal publish.",
    "BRIEF": "Siapkan brief (pesan utama, CTA, larangan, referensi) dan kirim ke kreator.",
    "DRAFT": "Tagih draft dari kreator, tempel link draft untuk direview.",
}
GENERIK = {"IDE": "BELUM_MULAI", "SHORTLIST": "BELUM_MULAI", "REVIEW": "MENUNGGU_REVIEW", "REVISI": "REVISI", "SELESAI": "SELESAI"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hari_ini() -> date:
    return datetime.now(WIB).date()


def jadwal_terdekat(k: dict) -> tuple:
    """(tanggal, jam) jadwal terdekat dari semua platform."""
    j = k.get("jadwal") or {}
    isi = sorted((v.get("tanggal"), v.get("jam") or "") for v in j.values() if v and v.get("tanggal"))
    if isi:
        return isi[0]
    return k.get("tanggal_tayang"), k.get("jam_tayang") or ""


def deadline_produksi(k: dict) -> str:
    """H-1 jadwal posting terdekat; konten iklan: tanggal produksi itu sendiri; bisa ditimpa permintaan yang disetujui."""
    if k.get("deadline_produksi"):
        return k["deadline_produksi"]
    t, _ = jadwal_terdekat(k)
    d = date.fromisoformat(t)
    return (d if is_iklan(k) else d - timedelta(days=1)).isoformat()


def deadline_status(k: dict, status: str) -> tuple:
    """(deadline, deadline_jam) tugas untuk status ini."""
    t, jam = jadwal_terdekat(k)
    tayang = date.fromisoformat(t)
    hari_ini = _hari_ini()
    g = grup_k(k)
    links = k.get("links") or {}

    def posting_berikut():
        sisa = sorted((v["tanggal"], v.get("jam") or "") for p, v in (k.get("jadwal") or {}).items()
                      if v and v.get("tanggal") and not links.get(p))
        return (sisa[0][0], sisa[0][1] or None) if sisa else (t, jam or None)

    if g == "TEKS":
        if status == "SCRIPTING":
            d = max(min(hari_ini, tayang), tayang - timedelta(days=1))
            return d.isoformat(), None
        if status in ("SCRIPTED", "POSTING"):
            return posting_berikut()
    if status in PRODUKSI_STATUS:
        return deadline_produksi(k), None
    if status in OFFSET_AWAL:
        batas = date.fromisoformat(deadline_produksi(k))
        d = min(tayang + timedelta(days=OFFSET_AWAL[status]), batas - timedelta(days=1))
        if d < hari_ini:
            d = min(hari_ini, batas)
        return d.isoformat(), None
    if status == "POSTING":
        return posting_berikut()
    if status in ("EDITED", "DESIGNED"):
        return (max(hari_ini, tayang) + timedelta(days=2)).isoformat(), None
    if status == "IKLAN_AKTIF":
        return (date.fromisoformat((k.get("iklan_aktif_at") or _now())[:10]) + timedelta(days=7)).isoformat(), None
    akhir = max([v["tanggal"] for v in (k.get("jadwal") or {}).values() if v and v.get("tanggal")] or [t])
    if is_iklan(k):
        akhir = (k.get("iklan_aktif_at") or _now())[:10]
        return (date.fromisoformat(akhir) + timedelta(days=8)).isoformat(), None
    return (date.fromisoformat(akhir) + timedelta(days=3 if status == "POSTED" else 4)).isoformat(), None


def build_konten_router(srv) -> APIRouter:
    db = srv.db
    get_current_user, user_scope = srv.get_current_user, srv.user_scope
    router = APIRouter(prefix="/konten", tags=["konten"])

    # ------------------------------------------------------------------ pengaturan & akses
    async def _settings() -> dict:
        st = await db.konten_settings.find_one({"id": "utama"}, {"_id": 0})
        if st and st.get("peran") and "IKLAN" in st["peran"]:
            return st
        div = await db.divisi.find_one({"nama": {"$regex": "multimedia", "$options": "i"}}, {"_id": 0})
        if st and st.get("divisi_id"):
            div = await db.divisi.find_one({"id": st["divisi_id"]}, {"_id": 0}) or div
        lama = (st or {}).get("peran") or {}
        pic = (st or {}).get("pic") or {}
        peran = {"LEAD": lama.get("LEAD") or pic.get("NASKAH"), "PRODUKSI": lama.get("PRODUKSI") or pic.get("PRODUKSI"),
                 "PUBLISHER": lama.get("PUBLISHER") or pic.get("POSTING"), "IKLAN": lama.get("IKLAN")}
        semua = await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1, "divisi_id": 1}).to_list(1000)
        cari = lambda kata, d=None: next((a["id"] for a in semua if kata in a["nama"].lower() and (not d or a.get("divisi_id") == d)), None)  # noqa: E731
        did = div["id"] if div else None
        peran["LEAD"] = peran["LEAD"] or (div or {}).get("head_anggota_id") or cari("indhy", did)
        peran["PRODUKSI"] = peran["PRODUKSI"] or cari("rizki", did) or peran["LEAD"]
        peran["PUBLISHER"] = peran["PUBLISHER"] or cari("fatya", did) or cari("fathiya", did) or peran["LEAD"]
        peran["IKLAN"] = peran["IKLAN"] or cari("nurdin") or peran["LEAD"]
        st = {"id": "utama", "divisi_id": did, "peran": peran,
              "penulis": (st or {}).get("penulis") or {k: None for k in TEKS_JENIS}, "updated_at": _now()}
        await db.konten_settings.replace_one({"id": "utama"}, dict(st), upsert=True)
        return st

    async def _akses(user: dict, kelola: bool = False) -> dict:
        sc = await user_scope(user)
        st = await _settings()
        anggota_tim = bool(st.get("divisi_id")) and sc["divisi_id"] == st["divisi_id"]
        pegang_peran = bool(sc["anggota_id"]) and (sc["anggota_id"] in (st.get("peran") or {}).values()
                                                   or sc["anggota_id"] in (st.get("penulis") or {}).values())
        lead = sc["is_spv"] or (bool(st.get("divisi_id")) and sc["head_divisi_id"] == st["divisi_id"]) \
            or (bool(sc["anggota_id"]) and sc["anggota_id"] == (st.get("peran") or {}).get("LEAD"))
        if not (sc["is_spv"] or anggota_tim or lead or pegang_peran):
            raise HTTPException(403, "Produksi Konten khusus tim Multimedia, pemegang peran konten, dan SPV.")
        if kelola and not lead:
            raise HTTPException(403, "Hanya lead konten, kepala tim Multimedia, atau SPV.")
        return {**sc, "st": st, "lead": lead}

    router.akses_fn = _akses

    def _orang(st: dict, jenis: str) -> Dict[str, Optional[str]]:
        p = dict(st.get("peran") or {})
        p["PENULIS"] = (st.get("penulis") or {}).get(jenis) or p.get("LEAD")
        return p

    def _pemegang(st: dict, k: dict, status: Optional[str] = None) -> List[str]:
        status = status or k["status_konten"]
        orang = _orang(st, k["jenis"])
        ids = [orang.get(r) for r, sset in PEMEGANG[grup_k(k)].items() if status in sset]
        return [i for i in dict.fromkeys(ids) if i]

    def _pelaksana(st: dict, k: dict, status: str) -> Optional[str]:
        orang = _orang(st, k["jenis"])
        return orang.get(PELAKSANA[grup_k(k)].get(status, "LEAD")) or orang.get("LEAD")

    # ------------------------------------------------------------------ model
    class JadwalIn(BaseModel):
        tanggal: str
        jam: str = ""

    class KontenIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        jenis: str
        judul: str = Field(default="", max_length=300)
        tanggal_tayang: Optional[str] = None  # dipakai bila jadwal per platform tidak dikirim
        jam_tayang: str = ""
        jadwal: Optional[Dict[str, JadwalIn]] = None  # {platform: {tanggal, jam}}
        status: Optional[str] = None
        platforms: List[str] = Field(default_factory=list)
        isi: Dict[str, str] = Field(default_factory=dict)

    class KontenUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        tanggal_tayang: Optional[str] = None
        jam_tayang: Optional[str] = None
        jadwal: Optional[Dict[str, JadwalIn]] = None
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
        isi: Optional[Dict[str, str]] = None

    class SetStatusIn(BaseModel):
        status: str
        catatan: str = Field(default="", max_length=500)

    class PeranIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        peran: Optional[Dict[str, Optional[str]]] = None
        penulis: Optional[Dict[str, Optional[str]]] = None

    class MintaDeadlineIn(BaseModel):
        tanggal: str
        alasan: str = Field(min_length=3, max_length=500)

    class PutusDeadlineIn(BaseModel):
        setuju: bool
        catatan: str = Field(default="", max_length=500)

    def _cek_tanggal(t: str) -> date:
        try:
            return date.fromisoformat(t)
        except (ValueError, TypeError):
            raise HTTPException(400, "Tanggal tidak valid (format YYYY-MM-DD).")

    def _cek_jam(j: str) -> str:
        j = (j or "").strip()
        if j and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", j):
            raise HTTPException(400, "Jam tidak valid (HH:MM).")
        return j

    def _cek_jenis(j: str) -> str:
        if j not in JENIS:
            raise HTTPException(400, "Tipe konten tidak dikenal.")
        return j

    def _cek_platform(jenis: str, p: List[str]) -> List[str]:
        if jenis in TEKS_JENIS:
            return [jenis]
        boleh = PLATFORM_KOL if jenis == "KOL" else PLATFORM
        p = [x for x in dict.fromkeys(p or []) if x in boleh]
        if not p:
            raise HTTPException(400, "Pilih minimal satu platform.")
        if "IKLAN" in p and len(p) > 1:
            raise HTTPException(400, "Konten iklan dibuat terpisah dari konten organik. Pilih Iklan saja, atau platform organik saja.")
        return p

    def _rapikan_jadwal(platforms: List[str], jadwal: Optional[Dict[str, JadwalIn]], tanggal: Optional[str], jam: str) -> Dict[str, dict]:
        out = {}
        for p in platforms:
            j = (jadwal or {}).get(p)
            t = j.tanggal if j else tanggal
            if not t:
                raise HTTPException(400, f"Isi tanggal untuk {PLATFORM.get(p) or PLATFORM_KOL.get(p) or JENIS.get(p, {}).get('label') or p}.")
            _cek_tanggal(t)
            out[p] = {"tanggal": t, "jam": _cek_jam(j.jam if j else jam)}
        return out

    def _turunan_jadwal(jadwal: Dict[str, dict]) -> dict:
        isi = sorted((v["tanggal"], v.get("jam") or "") for v in jadwal.values())
        return {"tanggal_tayang": isi[0][0], "jam_tayang": isi[0][1], "jadwal_tanggal": sorted({v["tanggal"] for v in jadwal.values()})}

    def _bersih_isi(jenis: str, iklan: bool, isi: Dict[str, str]) -> Dict[str, str]:
        boleh = {f[0]: f[2] for f in field_of(jenis, iklan)}
        out = {}
        for k, v in (isi or {}).items():
            if k not in boleh:
                continue
            v = (str(v) if v is not None else "").strip()[:6000]
            if boleh[k] == "url" and v and not re.match(r"^https?://", v):
                v = "https://" + v
            if boleh[k] == "angka":
                v = re.sub(r"[^\d]", "", v)
            out[k] = v
        for kk in ("terkait_kode", "cta_keyword", "bucket"):
            if kk in out:
                out[kk] = out[kk].upper()
        return out

    async def _kode_baru(prefix: str) -> str:
        mx = 0
        async for k in db.konten.find({"kode": {"$regex": f"^{prefix}-"}}, {"_id": 0, "kode": 1}):
            m = re.match(rf"{prefix}-(\d+)", k.get("kode") or "")
            if m:
                mx = max(mx, int(m.group(1)))
        return f"{prefix}-{max(mx + 1, 200 if prefix == 'RS' else 1):03d}"

    def _judul_otomatis(jenis: str, isi: dict, tanggal: str, jam: str) -> str:
        teks = isi.get("hook") or isi.get("topik") or isi.get("nama_kreator") or isi.get("isi") or ""
        teks = re.sub(r"\s+", " ", teks).strip()
        return (teks[:90] + ("…" if len(teks) > 90 else "")) if teks else f"{JENIS[jenis]['label']} {tanggal} {jam}".strip()

    # ------------------------------------------------------------------ tugas (1 konten = 1 tugas)
    def _naskah(k: dict) -> str:
        return k.get("naskah_editor_url") or k.get("naskah_url") or k.get("naskah_talent_url") or k.get("brief_url") or ""

    async def _isi_tugas(k: dict, st: dict) -> dict:
        status = k["status_konten"]
        dl, dl_jam = deadline_status(k, status)
        r_id = _pelaksana(st, k, status)
        a_id = (st.get("peran") or {}).get("LEAD") or r_id
        catatan = INSTRUKSI.get(status, "")
        for lab, key in (("Naskah talent", "naskah_talent_url"), ("Naskah editor", "naskah_editor_url"), ("Naskah", "naskah_url"),
                         ("Brief", "brief_url"), ("Akun kreator", "akun_url")):
            if k.get(key):
                catatan += f"\n{lab}: {k[key]}"
        return {"nama": f"[{k['kode']}] {k['judul']}"[:300], "kategori": "KONTEN", "konten_id": k["id"], "konten_jenis": k["jenis"],
                "konten_status": status, "konten_pemegang": _pemegang(st, k, status),
                "status": GENERIK.get(status, "DALAM_PROSES"), "penerima_tugas_id": r_id, "pemberi_id": a_id,
                "deadline": dl, "deadline_jam": dl_jam, "catatan_tim": catatan, "divisi_id": st.get("divisi_id"),
                "hasil_link": k.get("hasil_url") or "", "revisi_catatan": k.get("revisi_catatan") if status == "REVISI" else "",
                "brief_link": _naskah(k), "updated_at": _now()}

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
            doc = srv.Task(**{k2: v for k2, v in f.items() if k2 != "updated_at"}).model_dump()
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
        if ke not in ALUR[grup_k(k)]:
            raise HTTPException(400, "Status tidak ada di alur tipe konten ini.")
        now = _now()
        upd = {"status_konten": ke, "updated_at": now, **(extra or {})}
        if ke == "POSTED" and not k.get("posted_at"):
            upd["posted_at"] = now
        if ke == "IKLAN_AKTIF" and not k.get("iklan_aktif_at"):
            upd["iklan_aktif_at"] = now
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
        if grup_k(k) == "TEKS":
            return True
        return all((k.get("links") or {}).get(p) for p in k.get("platforms") or [])

    def _performa_lengkap(k: dict) -> bool:
        perf = k.get("performa") or {}
        return all(perf.get(p) for p in k.get("platforms") or [])

    async def _otomatis(k: dict, user: dict) -> dict:
        s = k["status_konten"]
        g = grup_k(k)
        if s == "POSTING" and g in ("VIDEO", "DESAIN", "KOL") and k.get("links") and _links_lengkap(k):
            k = await _ubah_status(k, "POSTED", user, "link semua platform terisi")
            s = "POSTED"
        if s == "POSTED" and k.get("posted_at"):
            if datetime.fromisoformat(k["posted_at"]) <= datetime.now(timezone.utc) - timedelta(hours=72):
                k = await _ubah_status(k, "LAPORAN", user, "72 jam setelah tayang")
                s = "LAPORAN"
        if s == "LAPORAN" and _performa_lengkap(k):
            k = await _ubah_status(k, "SELESAI", user, "laporan terisi")
        return k

    SISTEM = {"name": "Sistem", "user_id": None}

    async def jalankan_otomatis() -> int:
        batas = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
        n = 0
        async for k in db.konten.find({"status": "AKTIF", "status_konten": "POSTED", "posted_at": {"$lte": batas}}, {"_id": 0}):
            await _otomatis(k, SISTEM)
            n += 1
        return n

    async def migrasi_v3() -> int:
        """Konten lama: jadwal per platform dari tanggal_tayang; status EDITED/DESIGNED organik → POSTING/REVIEW."""
        n = 0
        st = await _settings()
        async for k in db.konten.find({"jadwal": {"$exists": False}}, {"_id": 0}):
            j = {p: {"tanggal": k["tanggal_tayang"], "jam": k.get("jam_tayang") or ""} for p in (k.get("platforms") or [k["jenis"]])}
            upd = {"jadwal": j, **_turunan_jadwal(j)}
            if k.get("naskah_url") and k["jenis"] == "REELS":
                upd["naskah_editor_url"] = k["naskah_url"]
            s = k.get("status_konten")
            if s == "EDITED":
                upd["status_konten"] = "POSTING"
            elif s == "DESIGNED":
                upd["status_konten"] = "REVIEW"
            await db.konten.update_one({"id": k["id"]}, {"$set": upd})
            k.update(upd)
            if k.get("status") == "AKTIF":
                await _sinkron_tugas(k, st)
            n += 1
        return n

    async def _loop():
        try:
            await migrasi_v3()
        except Exception:  # noqa: BLE001
            pass
        while True:
            try:
                await jalankan_otomatis()
            except Exception:  # noqa: BLE001 — jangan matikan loop
                pass
            await asyncio.sleep(600)

    router.mulai_loop = lambda: asyncio.create_task(_loop())
    router.migrasi_v3 = migrasi_v3

    # ------------------------------------------------------------------ hiasan respons
    async def _hiasi(rows: List[dict], st: Optional[dict] = None) -> List[dict]:
        st = st or await _settings()
        amap = {a["id"]: a["nama"] for a in await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(1000)}
        tids = [k.get("task_id") for k in rows if k.get("task_id")]
        tasks = {t["id"]: t for t in await db.tasks.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "deadline": 1, "deadline_jam": 1,
                                                                                  "penerima_tugas_id": 1}).to_list(5000)}
        now_wib = datetime.now(WIB).strftime("%Y-%m-%dT%H:%M")
        for k in rows:
            g = grup_k(k)
            alur = ALUR[g]
            s = k["status_konten"]
            t = tasks.get(k.get("task_id")) or {}
            k["iklan"] = is_iklan(k)
            k["jenis_label"] = JENIS[k["jenis"]]["label"] + (" · Iklan" if k["iklan"] else "")
            k["grup"] = g
            k["status_label"] = STATUS_LABEL.get(s, s)
            k["alur"] = [{"k": x, "label": STATUS_LABEL[x]} for x in alur]
            k["progres"] = round(alur.index(s) / (len(alur) - 1) * 100) if s in alur else 0
            k["pelaksana_id"] = t.get("penerima_tugas_id")
            k["pelaksana_nama"] = amap.get(t.get("penerima_tugas_id"))
            k["pemegang_ids"] = _pemegang(st, k)
            k["pemegang_nama"] = [amap.get(i) for i in k["pemegang_ids"] if amap.get(i)]
            k["deadline"] = t.get("deadline")
            k["deadline_jam"] = t.get("deadline_jam")
            k["target_produksi"] = deadline_produksi(k) if g != "TEKS" else None
            dl = f"{t.get('deadline')}T{t.get('deadline_jam') or '23:59'}" if t.get("deadline") else None
            k["terlambat"] = bool(dl and dl < now_wib and s not in ("SELESAI", "POSTED", "IKLAN_AKTIF") and k.get("status") == "AKTIF")
            orang = _orang(st, k["jenis"])
            k["aksi"] = [{"k": a[0], "label": a[1], "ke": a[2], "peran": a[3], "wajib": a[4], "oleh_id": orang.get(a[3])}
                         for a in AKSI[g].get(s, [])]
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
        semua = await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1, "divisi_id": 1}).to_list(1000)
        amap = {x["id"]: x["nama"] for x in semua}
        dmap = {d["id"]: d["nama"] for d in await db.divisi.find({}, {"_id": 0, "id": 1, "nama": 1}).to_list(200)}
        peran = {r: {"id": i, "nama": amap.get(i)} for r, i in (st.get("peran") or {}).items()}

        def alur_meta(g: str) -> List[dict]:
            return [{"k": s, "label": STATUS_LABEL[s], "instruksi": INSTRUKSI[s], "pelaksana": PELAKSANA[g][s],
                     "pemegang": [r for r, sset in PEMEGANG[g].items() if s in sset]} for s in ALUR[g]]
        jenis = {}
        for kk, v in JENIS.items():
            g = grup_of(kk)
            jenis[kk] = {**{x: v[x] for x in ("label", "prefix", "platform", "slot")}, "grup": g, "field": v["field"], "metrik": v["metrik"],
                         "alur": alur_meta(g),
                         **({"field_iklan": F_IKLAN, "metrik_iklan": METRIK_IKLAN, "alur_iklan": alur_meta(g + "_IKLAN")} if g in ("VIDEO", "DESAIN") else {}),
                         "penulis": {"id": _orang(st, kk)["PENULIS"], "nama": amap.get(_orang(st, kk)["PENULIS"])} if g == "TEKS" else None}
        return {"jenis": jenis, "status_label": STATUS_LABEL, "platform": PLATFORM, "platform_kol": PLATFORM_KOL, "leads": LEADS,
                "peran": peran, "bisa_kelola": a["lead"], "divisi_id": st.get("divisi_id"), "anggota_id": a["anggota_id"],
                "anggota_tim": [x for x in semua if x.get("divisi_id") == st.get("divisi_id")],
                "anggota_semua": [{**x, "tim": dmap.get(x.get("divisi_id"), "-")} for x in semua], "is_spv": a["is_spv"]}

    @router.get("")
    async def daftar(dari: Optional[str] = None, sampai: Optional[str] = None, q: Optional[str] = None,
                     jenis: Optional[str] = None, status_konten: Optional[str] = None,
                     arsip: bool = False, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        await jalankan_otomatis()
        f: dict = {"status": {"$in": ["AKTIF", "ARSIP"]}} if arsip else {"status": "AKTIF"}
        if dari or sampai:
            rng = {**({"$gte": dari} if dari else {}), **({"$lte": sampai} if sampai else {})}
            f["$and"] = [{"$or": [{"tanggal_tayang": rng}, {"jadwal_tanggal": {"$elemMatch": rng}}]}]
        if jenis:
            f["jenis"] = {"$in": jenis.split(",")}
        if status_konten:
            f["status_konten"] = {"$in": status_konten.split(",")}
        if q:
            rx = {"$regex": re.escape(q), "$options": "i"}
            f["$or"] = [{"judul": rx}, {"kode": rx}, {"pilar": rx}, {"isi": rx}, {"hook": rx}, {"topik": rx}, {"nama_kreator": rx}]
        rows = await db.konten.find(f, {"_id": 0}).sort([("tanggal_tayang", 1), ("jam_tayang", 1)]).to_list(3000)
        return await _hiasi(rows, a["st"])

    def _boleh_buat(a: dict, jenis: str) -> bool:
        return a["lead"] or (jenis in TEKS_JENIS and a["anggota_id"] == _orang(a["st"], jenis)["PENULIS"]) \
            or (jenis == "KOL" and a["anggota_id"] == (a["st"].get("peran") or {}).get("PUBLISHER"))

    async def buat_satu(payload: KontenIn, user: dict, a: dict) -> dict:
        jenis = _cek_jenis(payload.jenis)
        platforms = _cek_platform(jenis, payload.platforms)
        tmp = {"jenis": jenis, "platforms": platforms}
        jadwal = _rapikan_jadwal(platforms, payload.jadwal, payload.tanggal_tayang, payload.jam_tayang)
        isi = _bersih_isi(jenis, is_iklan(tmp), payload.isi)
        g = grup_k(tmp)
        status = payload.status or ALUR[g][0]
        if status not in ALUR[g]:
            raise HTTPException(400, "Status awal tidak ada di alur tipe ini.")
        tur = _turunan_jadwal(jadwal)
        judul = (payload.judul or "").strip() or _judul_otomatis(jenis, isi, tur["tanggal_tayang"], tur["jam_tayang"])
        if len(judul) < 3:
            raise HTTPException(400, "Judul minimal 3 huruf.")
        now = _now()
        doc = {"id": str(uuid.uuid4()), "kode": await _kode_baru(JENIS[jenis]["prefix"]), "jenis": jenis, "judul": judul,
               "platforms": platforms, "jadwal": jadwal, **tur, **isi, "status_konten": status, "status": "AKTIF",
               "links": {}, "performa": {}, "hasil_url": "",
               "riwayat": [{"dari": None, "ke": status, "at": now, "oleh": user.get("name"), "catatan": "dibuat"}],
               "dibuat_oleh": user.get("name"), "created_at": now, "updated_at": now}
        await db.konten.insert_one(dict(doc))
        doc.pop("_id", None)
        await _sinkron_tugas(doc, a["st"], user)
        return doc

    @router.post("")
    async def buat(payload: KontenIn, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        if not _boleh_buat(a, payload.jenis):
            raise HTTPException(403, "Konten baru dibuat oleh lead konten (kanal teks: penulisnya; KOL/UGC: publisher).")
        doc = await buat_satu(payload, user, a)
        return (await _hiasi([doc], a["st"]))[0]

    class BanyakIn(BaseModel):
        items: List[KontenIn] = Field(min_length=1, max_length=60)

    @router.post("/banyak")
    async def buat_banyak(payload: BanyakIn, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        for it in payload.items:
            _cek_jenis(it.jenis)
            if not _boleh_buat(a, it.jenis):
                raise HTTPException(403, "Konten baru dibuat oleh lead konten (atau penulis kanal teks).")
        out = [await buat_satu(it, user, a) for it in payload.items]
        return await _hiasi(out, a["st"])

    @router.get("/{kid}")
    async def detail(kid: str, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        return (await _hiasi([await _ambil(kid)], a["st"]))[0]

    def _boleh_peran(a: dict, k: dict, peran: str) -> bool:
        return a["lead"] or (bool(a["anggota_id"]) and _orang(a["st"], k["jenis"]).get(peran) == a["anggota_id"])

    def _boleh_ubah(a: dict, k: dict) -> bool:
        return a["lead"] or (bool(a["anggota_id"]) and a["anggota_id"] in _pemegang(a["st"], k))

    @router.put("/{kid}")
    async def ubah(kid: str, payload: KontenUpd, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        k = await _ambil(kid)
        if not _boleh_ubah(a, k):
            raise HTTPException(403, "Kartu ini sedang dipegang orang lain. Hanya pemegang status saat ini, lead, atau SPV yang bisa mengubah.")
        data = payload.model_dump(exclude_unset=True)
        upd = {}
        ubah_jadwal = any(data.get(x) is not None for x in ("tanggal_tayang", "jam_tayang", "jadwal", "platforms"))
        if ubah_jadwal and not a["lead"]:
            raise HTTPException(403, "Jadwal posting/produksi hanya bisa diubah lead konten. Ajukan permintaan deadline bila perlu waktu tambahan.")
        if data.get("judul") is not None:
            if len(data["judul"].strip()) < 3:
                raise HTTPException(400, "Judul minimal 3 huruf.")
            upd["judul"] = data["judul"].strip()[:300]
        if ubah_jadwal:
            platforms = _cek_platform(k["jenis"], data["platforms"]) if data.get("platforms") is not None else k.get("platforms") or []
            if is_iklan({"jenis": k["jenis"], "platforms": platforms}) != is_iklan(k):
                raise HTTPException(400, "Konten organik dan iklan tidak bisa saling diubah. Buat kartu baru (atau pakai Salin jadi iklan).")
            lama = {p: JadwalIn(**v) for p, v in (k.get("jadwal") or {}).items()}
            baru = {**lama, **{p: JadwalIn(**v) if isinstance(v, dict) else v for p, v in (payload.jadwal or {}).items()}}
            if data.get("tanggal_tayang") and not payload.jadwal:  # satu tanggal untuk semua platform
                baru = {p: JadwalIn(tanggal=data["tanggal_tayang"], jam=data.get("jam_tayang") or (lama.get(p).jam if lama.get(p) else "")) for p in platforms}
            jadwal = _rapikan_jadwal(platforms, baru, data.get("tanggal_tayang") or k.get("tanggal_tayang"), data.get("jam_tayang") or "")
            upd.update({"platforms": platforms, "jadwal": jadwal, **_turunan_jadwal(jadwal)})
        if data.get("isi") is not None:
            upd.update(_bersih_isi(k["jenis"], is_iklan(k), data["isi"]))
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
        await _sinkron_tugas(k, a["st"], user, log="Jadwal konten diubah" if ubah_jadwal else None)
        k = await _otomatis(k, user)
        return (await _hiasi([k], a["st"]))[0]

    async def jalankan_aksi(k: dict, payload: AksiIn, user: dict, a: dict) -> dict:
        g = grup_k(k)
        akt = next((x for x in AKSI[g].get(k["status_konten"], []) if x[0] == payload.aksi), None)
        if not akt:
            raise HTTPException(400, f"Aksi '{payload.aksi}' tidak tersedia pada status {STATUS_LABEL[k['status_konten']]}.")
        _, label, ke, peran, wajib = akt
        if not _boleh_peran(a, k, peran):
            nama = (await db.anggota.find_one({"id": _orang(a["st"], k["jenis"]).get(peran)}, {"_id": 0, "nama": 1}) or {}).get("nama")
            raise HTTPException(403, f"Langkah ini dikerjakan oleh {nama or peran} (atau lead/SPV).")
        extra = {}
        if payload.isi:
            extra.update(_bersih_isi(k["jenis"], is_iklan(k), payload.isi))
        if wajib == "catatan" and len(payload.catatan.strip()) < 3:
            raise HTTPException(400, "Tulis apa yang perlu diperbaiki.")
        if wajib == "hasil":
            hasil = payload.hasil_url.strip() or k.get("hasil_url") or ""
            if not hasil:
                raise HTTPException(400, "Tempel link hasil (Drive/Canva/draft) dulu.")
            extra["hasil_url"] = hasil if re.match(r"^https?://", hasil) else "https://" + hasil
        if wajib == "brief" and not ({**k, **extra}.get("brief_url")):
            raise HTTPException(400, "Isi link brief / agreement dulu.")
        if wajib == "iklan" and not ({**k, **extra}.get("iklan_campaign") or {**k, **extra}.get("iklan_url")):
            raise HTTPException(400, "Isi nama campaign atau link Ads Manager dulu.")
        if payload.links:
            extra["links"] = {**(k.get("links") or {}), **{p: v.strip() for p, v in payload.links.items() if p in (k.get("platforms") or []) and v.strip()}}
        if wajib == "link" and not _links_lengkap({**k, **extra}):
            raise HTTPException(400, "Isi link tayang untuk semua platform tujuan.")
        if payload.aksi == "setujui":
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
        a = await _akses(user, kelola=True)
        k = await _ambil(kid)
        if payload.status == k["status_konten"]:
            return (await _hiasi([k], a["st"]))[0]
        extra = {}
        if payload.status == "POSTED":
            extra["posted_at"] = k.get("posted_at") or _now()
        k = await _ubah_status(k, payload.status, user, payload.catatan.strip() or "diubah manual", extra)
        return (await _hiasi([k], a["st"]))[0]

    # ---------- permintaan deadline produksi (editor/desainer → lead)
    @router.post("/{kid}/minta-deadline")
    async def minta_deadline(kid: str, payload: MintaDeadlineIn, user: dict = Depends(get_current_user)):
        a = await _akses(user)
        k = await _ambil(kid)
        if not (_boleh_peran(a, k, "PRODUKSI") or (a["anggota_id"] and a["anggota_id"] in _pemegang(a["st"], k))):
            raise HTTPException(403, "Permintaan deadline diajukan oleh pemegang konten (editor/desainer).")
        if k["status_konten"] not in PRODUKSI_STATUS | {"SHOOTING"} and grup_k(k) != "KOL":
            raise HTTPException(400, "Permintaan deadline hanya untuk tahap produksi.")
        _cek_tanggal(payload.tanggal)
        req = {"tanggal": payload.tanggal, "alasan": payload.alasan.strip(), "oleh": user.get("name"), "oleh_id": a["anggota_id"],
               "at": _now(), "status": "MENUNGGU", "deadline_lama": deadline_produksi(k)}
        await db.konten.update_one({"id": k["id"]}, {"$set": {"permintaan_deadline": req}})
        k["permintaan_deadline"] = req
        if k.get("task_id"):
            await srv._log_activity(k["task_id"], user, "pindah", f"Minta deadline produksi {req['deadline_lama']} → {payload.tanggal}: {req['alasan']}")
        return (await _hiasi([k], a["st"]))[0]

    @router.post("/{kid}/putus-deadline")
    async def putus_deadline(kid: str, payload: PutusDeadlineIn, user: dict = Depends(get_current_user)):
        a = await _akses(user, kelola=True)
        k = await _ambil(kid)
        req = k.get("permintaan_deadline") or {}
        if req.get("status") != "MENUNGGU":
            raise HTTPException(400, "Tidak ada permintaan deadline yang menunggu.")
        req.update({"status": "DISETUJUI" if payload.setuju else "DITOLAK", "diputus_oleh": user.get("name"), "diputus_at": _now(),
                    "catatan_putusan": payload.catatan.strip()})
        upd = {"permintaan_deadline": req}
        if payload.setuju:
            upd["deadline_produksi"] = req["tanggal"]
        await db.konten.update_one({"id": k["id"]}, {"$set": upd})
        k.update(upd)
        await _sinkron_tugas(k, a["st"], user, log=f"Permintaan deadline {req['tanggal']} {'disetujui' if payload.setuju else 'ditolak'}"
                             + (f" — {payload.catatan.strip()}" if payload.catatan.strip() else ""))
        return (await _hiasi([k], a["st"]))[0]

    @router.post("/{kid}/salin-iklan")
    async def salin_iklan(kid: str, user: dict = Depends(get_current_user)):
        """Buat kartu iklan baru dari konten organik (materi sama, alur iklan)."""
        a = await _akses(user, kelola=True)
        k = await _ambil(kid)
        if k["jenis"] not in ("REELS", "CAROUSEL", "SINGLE") or is_iklan(k):
            raise HTTPException(400, "Hanya konten Reels/Carousel/Single organik yang bisa disalin jadi iklan.")
        isi = {f[0]: k.get(f[0]) or "" for f in JENIS[k["jenis"]]["field"]}
        sudah_jadi = k["status_konten"] in ("POSTING", "POSTED", "LAPORAN", "SELESAI")
        tgl = max(_hari_ini().isoformat(), k["tanggal_tayang"])
        doc = await buat_satu(KontenIn(jenis=k["jenis"], judul=f"{k['judul']} (iklan)"[:300], platforms=["IKLAN"], tanggal_tayang=tgl,
                                       isi=isi, status="EDITED" if sudah_jadi and k["jenis"] == "REELS" else "DESIGNED" if sudah_jadi else None),
                              user, a)
        if k.get("hasil_url"):
            await db.konten.update_one({"id": doc["id"]}, {"$set": {"hasil_url": k["hasil_url"], "sumber_kode": k["kode"]}})
            doc.update({"hasil_url": k["hasil_url"], "sumber_kode": k["kode"]})
            await _sinkron_tugas(doc, a["st"])
        return (await _hiasi([doc], a["st"]))[0]

    @router.put("/{kid}/performa")
    async def isi_performa(kid: str, data: Dict[str, object], user: dict = Depends(get_current_user)):
        a = await _akses(user)
        k = await _ambil(kid)
        pelapor = "IKLAN" if is_iklan(k) else "PUBLISHER"
        if not (_boleh_peran(a, k, pelapor) or _boleh_ubah(a, k)):
            raise HTTPException(403, "Laporan diisi oleh publisher/tim iklan, lead, atau SPV.")
        if k["status_konten"] not in ("POSTED", "IKLAN_AKTIF", "LAPORAN", "SELESAI"):
            raise HTTPException(400, "Performa diisi setelah konten tayang / iklan aktif.")
        plats = k.get("platforms") or []
        plat = str(data.get("platform") or (plats[0] if len(plats) == 1 else ""))
        if plat not in plats:
            raise HTTPException(400, "Platform tidak termasuk tujuan konten ini.")
        boleh = {m[0] for m in metrik_of(k["jenis"], is_iklan(k))} | {x[0] for x in LEADS}
        bersih = {}
        for f, v in data.items():
            if f in boleh and v not in (None, ""):
                try:
                    bersih[f] = max(0, int(v))
                except (TypeError, ValueError):
                    raise HTTPException(400, f"Angka {f} tidak valid.")
        if not bersih:
            raise HTTPException(400, "Isi minimal satu angka.")
        if "spend" in bersih and bersih.get("leads"):
            bersih["cpl"] = round(bersih["spend"] / bersih["leads"])
        perf = dict(k.get("performa") or {})
        perf[plat] = {**bersih, "diisi_at": _now(), "oleh": user.get("name")}
        await db.konten.update_one({"id": k["id"]}, {"$set": {"performa": perf, "updated_at": _now()}})
        k["performa"] = perf
        k = await _otomatis(k, user)
        return (await _hiasi([k], a["st"]))[0]

    @router.post("/{kid}/batal")
    async def batal(kid: str, user: dict = Depends(get_current_user)):
        await _akses(user, kelola=True)
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
        INTER = ("likes", "comments", "saves", "shares", "replies", "reposts", "quotes", "sticker_taps", "reaksi", "clicks")
        grup: Dict[str, Dict[str, dict]] = {"jenis": {}, "platform": {}, "pilar": {}, "bucket": {}}
        top = []
        iklan_tot = {"konten": 0, "spend": 0, "leads": 0, "pendaftaran": 0}
        for k in rows:
            tot = {"views": 0, "reach": 0, "inter": 0, "leads": 0, "daftar": 0}
            for plat, m in (k.get("performa") or {}).items():
                v = {"views": m.get("views") or m.get("impressions") or 0, "reach": m.get("reach") or 0, "inter": sum(m.get(x) or 0 for x in INTER),
                     "leads": (m.get("dm") or 0) + (m.get("tanya_harga") or 0) + (m.get("tanya_program") or 0) + (m.get("voice_note") or 0) + (m.get("leads") or 0),
                     "daftar": m.get("pendaftaran") or 0}
                if plat == "IKLAN":
                    iklan_tot["konten"] += 1
                    iklan_tot["spend"] += m.get("spend") or 0
                    iklan_tot["leads"] += m.get("leads") or 0
                    iklan_tot["pendaftaran"] += m.get("pendaftaran") or 0
                for x in tot:
                    tot[x] += v[x]
                nama = PLATFORM.get(plat) or PLATFORM_KOL.get(plat) or JENIS.get(plat, {}).get("label") or plat
                g = grup["platform"].setdefault(nama, {"konten": 0, **{x: 0 for x in tot}})
                g["konten"] += 1
                for x in tot:
                    g[x] += v[x]
            lab = JENIS[k["jenis"]]["label"] + (" · Iklan" if is_iklan(k) else "")
            for dim, key in (("jenis", lab), ("pilar", k.get("pilar") or "—"), ("bucket", k.get("bucket") or "—")):
                g = grup[dim].setdefault(key, {"konten": 0, **{x: 0 for x in tot}})
                g["konten"] += 1
                for x in tot:
                    g[x] += tot[x]
            top.append({"id": k["id"], "kode": k["kode"], "judul": k["judul"], "jenis": k["jenis"], "tanggal_tayang": k["tanggal_tayang"], **tot})

        def rapi(d: Dict[str, dict]) -> List[dict]:
            out = [{"nama": n, **v, "rata_views": round(v["views"] / v["konten"]) if v["konten"] else None,
                    "er": round(v["inter"] / v["reach"] * 100, 1) if v["reach"] else None} for n, v in d.items()]
            return sorted(out, key=lambda x: -(x["rata_views"] or 0))

        iklan_tot["cpl"] = round(iklan_tot["spend"] / iklan_tot["leads"]) if iklan_tot["leads"] else None
        return {"jumlah_konten": len(rows), **{d: rapi(v) for d, v in grup.items()}, "iklan": iklan_tot,
                "top_views": sorted(top, key=lambda x: -x["views"])[:5], "top_leads": sorted(top, key=lambda x: -x["leads"])[:5]}

    @router.put("/pengaturan/peran")
    async def ubah_peran(payload: PeranIn, user: dict = Depends(get_current_user)):
        a = await _akses(user, kelola=True)
        st = a["st"]
        upd = {}
        for key, src, boleh in (("peran", payload.peran, {"LEAD", "PRODUKSI", "PUBLISHER", "IKLAN"}), ("penulis", payload.penulis, TEKS_JENIS)):
            if src is None:
                continue
            for r, aid in src.items():
                if r in boleh and aid and not await db.anggota.find_one({"id": aid}, {"_id": 1}):
                    raise HTTPException(400, "Anggota tidak ditemukan.")
            upd[key] = {**(st.get(key) or {}), **{r: (v or None) for r, v in src.items() if r in boleh}}
        if upd:
            await db.konten_settings.update_one({"id": "utama"}, {"$set": {**upd, "updated_at": _now()}})
            st = await _settings()
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
    router.performa_fn = isi_performa
    router.buat_fn, router.aksi_fn, router.daftar_fn, router.detail_fn = buat, aksi, daftar, detail
    router.batal_fn = batal
    router.minta_deadline_fn, router.putus_deadline_fn = minta_deadline, putus_deadline
    router.MintaDeadlineIn, router.PutusDeadlineIn = MintaDeadlineIn, PutusDeadlineIn
    return router
