"""Setup sistem manajemen target untuk Siklus 4 (Nov–Des 2026). Idempoten; lewat REST API agar validasi berlaku.

Pakai:  BASE=http://127.0.0.1:8001/api TOKEN=<sesi SPV> python3 setup_siklus4.py [--apply]
Tanpa --apply hanya menampilkan rencana (dry-run).
"""
import json
import os
import sys
import urllib.request

BASE, TOKEN = os.environ["BASE"], os.environ["TOKEN"]
APPLY = "--apply" in sys.argv

TEGUH = "d1a73cea-25f0-43e2-8d32-3dd684a5f3ee"
NURDIN = "007c9c96-3049-4174-9131-eba5b48b6230"
S_MARKETING = "db3aa2c5-f2ec-49cf-84c7-008ea2a970db"
S_OPERASIONAL_TIM = "9635c786-c7bf-466f-a03f-519f88aeba8d"
S_KEUANGAN = "207d9135-57ba-4f1c-948e-2ecfda3bbdf4"
KR_SANTRI = "32f485f5-0f56-4d28-b67d-4298a84da303"
KR_TAGIHAN = "48101370-3ad6-4cdf-8843-287deb3f9f73"

UBAH = [  # KR yang sudah ada -> sambungkan ke data Dashboard
    (KR_SANTRI, {"nama": "Santri aktif 1.500 pada 31 Desember 2026", "target": 1500, "awal": 878, "sumber": "santri_aktif", "jenis": "LAG"}),
    ("6e7c5957-1f5e-498b-b469-e79dc0dad47b", {"sumber": "rasio_aktif", "jenis": "LAG"}),
    (KR_TAGIHAN, {"sumber": "kolektibilitas_bulan_lalu", "jenis": "LAG"}),
    ("9ebd2f39-d938-43e7-809a-5669215a0d2e", {"sumber": "konversi_lead_30h", "jenis": "LAG"}),
]
BARU = [  # (sasaran, payload) — ukuran proses (lead) yang dikerjakan tiap pekan
    (S_MARKETING, {"nama": "Lead yang sampai tahap discovery (30 hari)", "sumber": "lead_ke_discovery", "jenis": "LEAD", "arah": "NAIK",
                   "satuan": "%", "target": 35, "pic_id": NURDIN, "untuk_ukuran_id": KR_SANTRI}),
    (S_MARKETING, {"nama": "Follow-up lead yang dibalas", "sumber": "followup_dibalas", "jenis": "LEAD", "arah": "NAIK",
                   "satuan": "%", "target": 30, "pic_id": NURDIN, "untuk_ukuran_id": KR_SANTRI}),
    (S_OPERASIONAL_TIM, {"nama": "Kelas aktif tanpa guru", "sumber": "kelas_tanpa_guru", "jenis": "LEAD", "arah": "TURUN",
                         "satuan": "kelas", "awal": 3, "target": 0, "pic_id": TEGUH}),
    (S_OPERASIONAL_TIM, {"nama": "Santri yang perlu riayah (pendampingan)", "sumber": "santri_perlu_riayah", "jenis": "LEAD", "arah": "TURUN",
                         "satuan": "santri", "awal": 826, "target": 400, "pic_id": TEGUH}),
    (S_OPERASIONAL_TIM, {"nama": "Kehadiran santri bulan ini", "sumber": "kehadiran_bulan_ini", "jenis": "LAG", "arah": "JAGA",
                         "satuan": "%", "target": 80, "pic_id": TEGUH}),
    (S_KEUANGAN, {"nama": "Tagihan telat bayar", "sumber": "tagihan_telat", "jenis": "LEAD", "arah": "TURUN",
                  "satuan": "tagihan", "awal": 581, "target": 150, "untuk_ukuran_id": KR_TAGIHAN}),
]


def call(m, path, body=None):
    req = urllib.request.Request(BASE + path, method=m, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


ov = call("GET", "/sasaran/overview")
pid = ov["period"]["id"]
print("Periode aktif:", ov["period"]["nama"])
ada = {u["id"]: u for s in ov["sasaran"] for u in s["ukuran"]}
sumber_ada = {u.get("sumber") for u in ada.values() if u.get("sumber")}

print("1) Jadwal rapat: Selasa 09:00, fasilitator Kang Teguh, batas check-in Senin 17.00")
if APPLY:
    call("PUT", "/sasaran/pengaturan", {"fasilitator_id": TEGUH, "hari_rapat": "SELASA", "jam_rapat": "09:00", "durasi_menit": 45, "batas_checkin": "Senin 17.00"})

for uid, p in UBAH:
    if uid not in ada:
        print("   lewati (tidak ada):", uid)
        continue
    print(f"2) Ubah '{ada[uid]['nama']}' -> {p}")
    if APPLY:
        call("PUT", f"/sasaran/ukuran/{uid}", p)

for sid, p in BARU:
    if p["sumber"] in sumber_ada:
        print("3) sudah ada, lewati:", p["nama"])
        continue
    print("3) Tambah:", p["nama"])
    if APPLY:
        call("POST", f"/sasaran/s/{sid}/ukuran", p)

if APPLY:
    print("4) Sinkron pertama:", call("POST", "/sasaran/metrik/sync"))
print("SELESAI" if APPLY else "DRY-RUN (tambahkan --apply untuk menjalankan)")
