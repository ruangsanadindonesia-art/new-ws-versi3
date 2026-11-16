"""Sinkron angka operasional dari Dashboard Ruang Sanad (dashboard.ruangsanad.com) ke Target Bersama.

Sumber: server MCP Dashboard (JSON-RPC tools/call), kunci di .env: DASHBOARD_MCP_URL, DASHBOARD_MCP_KEY.
Catatan: Cloudflare menolak User-Agent bawaan Python (Error 1010), jadi pakai User-Agent khusus.

Alur:
1. Ambil ringkasan_kondisi, laporan_funnel (30 hari), tren_program (dimensi tipe, 2 bulan).
2. Hitung METRIK (katalog di bawah) -> simpan 1 snapshot per metrik per hari (metric_snapshots).
3. Setiap Key Result yang field `sumber`-nya = kunci metrik: realisasi diperbarui otomatis
   dan dicatat sebagai check-in "Sinkron Dashboard" bila nilainya berubah / belum ada hari ini.
"""
import json
import os
import urllib.request
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Dict

WIB = timezone(timedelta(hours=7))


def _last(lst, key, default=None):
    return lst[-1].get(key, default) if lst else default


def _tren_sum(t: dict, field: str, idx: int = -1) -> float:
    tot = 0.0
    for p in t.get("program", []):
        pb = p.get("per_bulan") or []
        if pb and len(pb) >= abs(idx):
            tot += float(pb[idx].get(field) or 0)
    return tot


def _kehadiran(t: dict, idx: int = -1):
    hadir, absen = _tren_sum(t, "hadir", idx), _tren_sum(t, "absensi_tercatat", idx)
    return round(hadir / absen * 100, 1) if absen else None


def _stage(f: dict, name: str) -> float:
    return next((x["reached"] for x in f.get("funnel", []) if x["stage"] == name), 0)


# kunci -> (label, satuan, arah_default, jenis_default, penjelasan, fungsi(r, f, t))
METRIK: Dict[str, tuple] = {
    "santri_aktif": ("Santri aktif", "santri", "NAIK", "LAG", "Jumlah santri berstatus aktif saat ini.", lambda r, f, t: r["santri"]["aktif"]),
    "rasio_aktif": ("Rasio santri aktif", "%", "NAIK", "LAG", "Santri aktif dibagi seluruh santri terdaftar.", lambda r, f, t: round(r["santri"]["active_rate"], 1)),
    "pendaftar_bulan_ini": ("Pendaftar baru bulan ini", "santri", "NAIK", "LAG", "Santri baru yang mendaftar sejak tanggal 1 bulan ini.", lambda r, f, t: _last(r["pendaftar_baru_per_bulan"], "total", 0)),
    "pendaftar_bulan_lalu": ("Pendaftar baru bulan lalu", "santri", "NAIK", "LAG", "Pendaftar baru bulan sebelumnya (bulan penuh).", lambda r, f, t: r["pendaftar_baru_per_bulan"][-2]["total"] if len(r["pendaftar_baru_per_bulan"]) > 1 else None),
    "berhenti_bulan_ini": ("Santri berhenti bulan ini", "santri", "TURUN", "LAG", "Santri yang berhenti sejak tanggal 1 bulan ini (semua tipe kelas).", lambda r, f, t: _tren_sum(t, "berhenti")),
    "berhenti_bulan_lalu": ("Santri berhenti bulan lalu", "santri", "TURUN", "LAG", "Santri berhenti selama bulan sebelumnya.", lambda r, f, t: _tren_sum(t, "berhenti", -2)),
    "kehadiran_bulan_ini": ("Kehadiran kelas bulan ini", "%", "JAGA", "LAG", "Hadir + telat dibagi absensi tercatat bulan ini.", lambda r, f, t: _kehadiran(t)),
    "kolektibilitas_bulan_lalu": ("Kolektibilitas SPP bulan lalu", "%", "NAIK", "LAG", "Nominal tagihan terbit bulan lalu yang sudah lunas.", lambda r, f, t: round(r["keuangan"]["bulan_sebelumnya"]["kolektibilitas"], 1)),
    "kolektibilitas_bulan_ini": ("Kolektibilitas SPP bulan ini", "%", "NAIK", "LAG", "Nominal tagihan terbit bulan ini yang sudah lunas (naik sepanjang bulan).", lambda r, f, t: round(r["keuangan"]["bulan_ini"]["kolektibilitas"], 1)),
    "piutang_total": ("Total piutang", "Rp", "TURUN", "LAG", "Semua tagihan belum lunas.", lambda r, f, t: r["keuangan"]["total_piutang"]),
    "tagihan_telat": ("Tagihan lewat jatuh tempo", "tagihan", "TURUN", "LEAD", "Jumlah tagihan yang sudah lewat jatuh tempo dan belum lunas.", lambda r, f, t: r["keuangan"]["jumlah_tagihan_terlambat"]),
    "lead_30h": ("Lead masuk 30 hari", "lead", "NAIK", "LEAD", "Calon santri yang chat ke CS dalam 30 hari terakhir.", lambda r, f, t: f["total_leads"]),
    "closing_30h": ("Closing 30 hari", "santri", "NAIK", "LAG", "Lead yang menjadi santri (won) dalam 30 hari terakhir.", lambda r, f, t: f["won"]),
    "konversi_lead_30h": ("Konversi lead → santri (30 hari)", "%", "NAIK", "LAG", "Closing dibagi lead masuk, 30 hari terakhir.", lambda r, f, t: round(f["won"] / f["total_leads"] * 100, 2) if f["total_leads"] else None),
    "lead_ke_discovery": ("Lead yang masuk tahap discovery", "%", "NAIK", "LEAD", "Persentase lead baru yang berhasil diajak ngobrol (tahap discovery), 30 hari.", lambda r, f, t: round(_stage(f, "discovery") / _stage(f, "baru") * 100, 1) if _stage(f, "baru") else None),
    "rekomendasi_ke_form": ("Rekomendasi → form dikirim", "%", "NAIK", "LEAD", "Dari lead yang sudah diberi rekomendasi kelas, berapa persen yang dikirimi form pendaftaran.", lambda r, f, t: round(_stage(f, "form_dikirim") / _stage(f, "rekomendasi") * 100, 1) if _stage(f, "rekomendasi") else None),
    "followup_dibalas": ("Follow-up lead dibalas", "%", "NAIK", "LEAD", "Pesan follow-up yang dibalas calon santri, 30 hari.", lambda r, f, t: round(f["followup_replied"] / f["followup_sent"] * 100, 1) if f.get("followup_sent") else None),
    "santri_perlu_riayah": ("Santri berpenanda riayah", "santri", "TURUN", "LEAD", "Santri dengan penanda kehadiran/kontak/progres yang perlu disapa guru.", lambda r, f, t: r["riayah"]["perlu_perhatian"]),
    "rapor_terkirim": ("Rapor bulanan terkirim", "rapor", "NAIK", "LEAD", "Rapor riayah periode terakhir yang sudah dikirim ke santri.", lambda r, f, t: r["riayah"]["rapor_terkirim"]),
    "kelas_tanpa_guru": ("Kelas tanpa guru aktif", "kelas", "TURUN", "LEAD", "Kelas aktif yang gurunya belum ditetapkan / tidak aktif.", lambda r, f, t: r["operasional"]["kelas_tanpa_guru_aktif"]),
    "santri_tanpa_kelas": ("Santri aktif tanpa kelas", "santri", "TURUN", "LEAD", "Santri aktif yang belum ditempatkan di kelas aktif.", lambda r, f, t: r["operasional"]["santri_aktif_tanpa_kelas_aktif"]),
    "kelas_perlu_perhatian": ("Kelas perlu perhatian", "kelas", "TURUN", "LEAD", "Kelas dengan kehadiran rendah, pertemuan macet, atau santri berpenanda.", lambda r, f, t: r["kelas_perlu_perhatian"]["jumlah"]),
    "guru_perlu_perhatian": ("Guru perlu perhatian", "guru", "TURUN", "LEAD", "Guru dengan riayah rendah, tindak lanjut kunjungan lewat target, atau kehadiran pembinaan rendah.", lambda r, f, t: r["guru_perlu_perhatian"]["jumlah"]),
}


def katalog() -> list:
    return [{"key": k, "label": v[0], "satuan": v[1], "arah": v[2], "jenis": v[3], "penjelasan": v[4]} for k, v in METRIK.items()]


def _call(name: str, args: dict) -> dict:
    url, key = os.environ.get("DASHBOARD_MCP_URL"), os.environ.get("DASHBOARD_MCP_KEY")
    if not url or not key:
        raise RuntimeError("DASHBOARD_MCP_URL / DASHBOARD_MCP_KEY belum diatur di .env")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(url, method="POST", data=body, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": "workspace-ruangsanad-sync/1.0"})
    raw = json.loads(urllib.request.urlopen(req, timeout=90).read())
    if "error" in raw:
        raise RuntimeError(f"{name}: {raw['error'].get('message')}")
    res = raw["result"]
    if res.get("isError"):
        raise RuntimeError(f"{name}: {res['content'][0].get('text', '')[:200]}")
    return res.get("structuredContent") or json.loads(res["content"][0]["text"])


def fetch_values() -> dict:
    r = _call("ringkasan_kondisi", {})
    f = _call("laporan_funnel", {})["laporan"]
    t = _call("tren_program", {"dimensi": "tipe", "bulan": 2})
    out = {}
    for k, (_, _, _, _, _, fn) in METRIK.items():
        try:
            v = fn(r, f, t)
            out[k] = float(v) if v is not None else None
        except Exception:
            out[k] = None
    return {"values": out, "data_per": r.get("data_per")}


async def sync(db, actor: str = "Sinkron Dashboard") -> dict:
    """Ambil data, simpan snapshot hari ini, perbarui KR bersumber otomatis."""
    import asyncio
    started = datetime.now(timezone.utc)
    try:
        got = await asyncio.to_thread(fetch_values)
    except Exception as e:
        await db.dashboard_sync_log.insert_one({"at": started.isoformat(), "ok": False, "error": str(e)[:300]})
        return {"ok": False, "error": str(e)[:300]}
    now = datetime.now(timezone.utc).isoformat()
    tanggal = datetime.now(WIB).date().isoformat()
    vals = got["values"]
    for k, v in vals.items():
        if v is None:
            continue
        await db.metric_snapshots.update_one({"key": k, "tanggal": tanggal},
                                             {"$set": {"key": k, "tanggal": tanggal, "nilai": v, "data_per": got["data_per"], "at": now}}, upsert=True)
    periods = [p["id"] for p in await db.strategy_periods.find({"archived": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(50)]
    updated = 0
    async for u in db.ukuran.find({"period_id": {"$in": periods}, "sumber": {"$in": list(vals)}}):
        v = vals.get(u["sumber"])
        if v is None:
            continue
        last_auto = await db.ukuran_checkins.find_one({"ukuran_id": u["id"], "otomatis": True}, sort=[("at", -1)])
        changed = u.get("capaian") != v
        new_day = not last_auto or str(last_auto.get("at", ""))[:10] != now[:10]
        if changed or new_day:
            await db.ukuran_checkins.insert_one({"id": str(uuid.uuid4()), "ukuran_id": u["id"], "nilai": v, "confidence": u.get("confidence") or "YAKIN",
                                                 "catatan": f"Otomatis dari Dashboard (data per {got['data_per']})", "user_id": None,
                                                 "actor_name": actor, "otomatis": True, "at": now})
        await db.ukuran.update_one({"id": u["id"]}, {"$set": {"capaian": v, "last_checkin_at": now, "data_per": got["data_per"]}})
        updated += 1
    log = {"at": now, "ok": True, "data_per": got["data_per"], "metrik": sum(1 for v in vals.values() if v is not None), "kr_diperbarui": updated}
    await db.dashboard_sync_log.insert_one(dict(log))
    return log


async def loop(db, every_hours: float = 6.0):
    """Jalankan sinkron saat start (setelah 60 detik) lalu tiap `every_hours` jam."""
    import asyncio
    import logging
    await asyncio.sleep(60)
    while True:
        try:
            r = await sync(db)
            logging.getLogger("dashboard_sync").info("sync: %s", r)
        except Exception as e:  # jangan sampai mematikan server
            logging.getLogger("dashboard_sync").warning("sync error: %s", e)
        await asyncio.sleep(every_hours * 3600)
