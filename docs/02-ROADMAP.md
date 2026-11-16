# 02 — Roadmap

Urutan berdasarkan dampak dan risiko. Centang `[x]` saat selesai dan tulis hash commit.

## A. Wajib sebelum fitur besar (kebersihan & keamanan)

- [ ] **A1. Ganti password admin default** dan semua akun yang passwordnya pernah dibagikan di chat. *(non-kode, 10 menit)*
- [ ] **A2. Rapikan branch**: merge `perbaikan/keamanan-logika-raci` → `main`, lalu `fitur/mcp-agent` dan `fitur/sasaran`. Production harus berjalan dari `main`.
- [ ] **A3. Repo privat** atau bersihkan riwayat yang memuat kredensial (commit `23d9fb1`); rotasi kredensial yang pernah ter-commit.
- [ ] **A4. Test otomatis minimal**: pytest + MongoDB uji untuk izin akses (RACI, review, Target Bersama). Tanpa ini, setiap AI yang mengubah kode berisiko merusak aturan izin tanpa ketahuan.
- [ ] **A5. Hapus modul Strategi lama** (`backend/strategy.py`, `frontend/src/pages/strategy/*`, `pages/Strategy.jsx`) setelah konfirmasi data sudah dipindah.

## B. Penyempurnaan Target Bersama

- [ ] B1. Isi PIC untuk 13 key result tanpa PIC (data, bukan kode).
- [ ] B2. Koreksi target tidak realistis (santri aktif 1.500 untuk siklus, konversi lead 20%) — keputusan pimpinan.
- [ ] B3. Buka Target Bersama untuk kepala tim (baca + check-in KR timnya) setelah ritme rapat berjalan 4 pekan.
- [ ] B4. Pengingat otomatis Senin 15.00 ke PIC yang belum check-in (notifikasi + Hermes).
- [ ] B5. Ringkasan rapat otomatis (PDF/WhatsApp lewat Hermes) setelah rapat ditutup.

## C. Modul HR (fitur baru) — lihat `03-PRD-MODUL-HR.md`

- [ ] HR-1 Peran HR + data dummy (Lala) + jadwal dinamis per orang + roster + kalender libur
- [ ] HR-2 Absensi masuk/pulang (sesi), koreksi, lupa pulang, lembur
- [ ] HR-3 Izin & cuti dengan persetujuan berjenjang (kepala tim → HR) + saldo cuti
- [ ] HR-4 Rekap kehadiran harian/bulanan (status per hari, telat, kurang jam)
- [ ] HR-5 Raport bulanan terpadu (kehadiran + tugas + KPI + amaliyah + penilaian atasan) per orang & per tim, PDF
- [ ] HR-6 Impor fingerprint untuk masa transisi 2–4 pekan, lalu mesin dihentikan (lewati bila langsung pindah)
- [ ] HR-7 Tool MCP Hermes: absen masuk/pulang, ajukan izin, cek saldo cuti, rekap saya

## D. Nanti / opsional

- [ ] D1. Verifikasi lokasi absensi kantor (radius GPS atau IP Wi-Fi kantor).
- [ ] D2. Notifikasi WhatsApp untuk persetujuan izin/cuti.
- [ ] D3. Payroll/ujroh staf — **di luar cakupan** sampai data kehadiran stabil 3 bulan.
