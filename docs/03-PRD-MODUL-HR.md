# 03 — PRD Modul HR: Kehadiran, Izin & Cuti, Raport Bulanan

| | |
|---|---|
| Status | Draf v1 — siap dieksekusi per fase |
| Pemilik produk | Pimpinan Ruang Sanad |
| Tanggal | 16 November 2026 |
| Prasyarat | Baca `01-KONTEKS-SISTEM.md` (stack, pola kode, `user_scope`) |
| Referensi | Repo `ruangsanadindonesia-art/ruang-sanad-leaderboard`, branch `feature/employee-attendance` (Go + SQLite + Svelte) — **logikanya diambil, kodenya tidak** |

---

## 1. Latar belakang & masalah

1. Tim Ruang Sanad punya **jam kerja berbeda-beda**: ada shift pagi (sebagian remote, sebagian di kantor), shift siang, dan staf fleksibel. Absen "jam 8 masuk, jam 4 pulang" tidak cocok.
2. Izin dan cuti saat ini lewat chat, tidak tercatat, sehingga saldo cuti dan pola ketidakhadiran tidak terlihat.
3. Raport bulanan yang ada (menu Laporan → Raport) hanya menggabungkan tugas dan amaliyah, tanpa kehadiran dan KPI, dan tidak ada alur penilaian atasan.
4. Belum ada peran yang bertanggung jawab atas administrasi SDM; semua jatuh ke SPV.

### Apa yang diambil dari repo leaderboard

| Sudah ada di leaderboard (dipakai ulang konsepnya) | Belum ada / belum dipakai di leaderboard (harus dibangun) |
|---|---|
| Profil kerja per anggota (target menit harian & mingguan, mode kerja) | **Roster** — tabelnya ada tetapi tidak dipakai dalam perhitungan apa pun |
| Template shift dengan **segmen** (mis. Shift Pagi: 06:30–07:30 remote, 08:00–14:00 kantor, 1 jam remote fleksibel) | **Deteksi telat & pulang awal** — `late_tolerance_minutes` disimpan tetapi tidak dipakai |
| Sesi kerja masuk/pulang, banyak sesi per hari, lokasi Kantor/Remote, maksimal 1 sesi aktif | **Carryover mingguan** — opsi disimpan, tidak dipakai |
| Sesi aktif dari hari sebelumnya otomatis "tidak lengkap" | **Izin & cuti** sama sekali |
| Pengajuan koreksi absen, lupa pulang (lupa checkout), lembur — dengan review | **Status harian** (hadir/alpa/izin/libur) dan rekap bulanan |
| Batas validasi: alasan ≥ 5 karakter, sesi ≤ 16 jam, lembur 30–720 menit, tidak boleh tanggal masa depan | Kalender libur nasional/lembaga |
| Impor file mesin fingerprint (.xls) dengan pratinjau & koreksi | Hasil impor fingerprint **tidak** diubah menjadi sesi kehadiran |

## 2. Tujuan & ukuran keberhasilan

| Tujuan | Ukuran (3 bulan setelah rilis) |
|---|---|
| Kehadiran tercatat untuk semua staf yang wajib absen | ≥ 95% hari kerja punya status (bukan "belum ada data") |
| Izin/cuti tidak lagi lewat chat | 100% izin/cuti tercatat di aplikasi; waktu persetujuan median < 24 jam |
| Raport bulanan terbit tepat waktu | Raport bulan sebelumnya terkunci paling lambat tanggal 7 |
| Beban administrasi SPV turun | SPV tidak lagi menyetujui izin rutin (dipegang kepala tim + HR) |

### Bukan tujuan (di luar cakupan v1)

- Payroll, potongan gaji, ujroh, BPJS.
- Verifikasi lokasi GPS/selfie (dicatat sebagai opsi D1 di roadmap).
- Absensi santri atau guru (itu di Dashboard Ruang Sanad).
- Rekrutmen, kontrak, dokumen karyawan.

## 3. Peran & izin akses

Tambah role baru `hr` di `users.role` (nilai sekarang: `spv`, `anggota`). Kepala tim tetap diturunkan dari `divisi.head_anggota_id`. Perluas `user_scope()` dengan `is_hr`.

| Aksi | Anggota | Kepala tim | HR | SPV |
|---|---|---|---|---|
| Absen masuk/pulang, lihat kehadiran sendiri | ✔ | ✔ | ✔ | ✔ |
| Ajukan izin/cuti, koreksi, lupa pulang, lembur | ✔ | ✔ | ✔ | ✔ |
| Lihat kehadiran & izin anggota timnya | – | ✔ | ✔ semua | ✔ semua |
| Setujui tahap 1 (izin/cuti timnya; koreksi & lembur timnya) | – | ✔ | – | ✔ |
| Setujui tahap 2 (izin/cuti final) | – | – | ✔ | ✔ |
| Kelola shift, roster, kalender libur, kebijakan, jenis izin & kuota | – | Roster timnya | ✔ | ✔ |
| Isi penilaian atasan di raport | – | ✔ timnya | – | ✔ |
| Kunci & terbitkan raport | – | – | ✔ | ✔ |
| Lihat raport sendiri (setelah terbit) | ✔ | ✔ | ✔ | ✔ |
| Ubah role pengguna jadi HR | – | – | – | ✔ |

Aturan khusus persetujuan:
- Pemohon adalah kepala tim, atau timnya tidak punya kepala → tahap 1 dilewati, langsung ke HR.
- Pemohon adalah HR → disetujui SPV.
- Tidak ada yang boleh menyetujui pengajuannya sendiri.
- SPV boleh mengambil alih tahap mana pun (tercatat di log).

## 4. Konsep & istilah

| Istilah | Arti |
|---|---|
| **Profil kerja** | Pengaturan per anggota: wajib absen atau tidak, mode jadwal, target menit, pola mingguan |
| **Mode jadwal** | `SHIFT` (jadwal jam tetap per segmen), `FLEKSIBEL` (hanya target jumlah jam), `TANPA_ABSEN` (dikecualikan) |
| **Shift** | Template jam kerja berisi beberapa **segmen** (lokasi + jam mulai/selesai, atau fleksibel) |
| **Pola mingguan** | Default per anggota: Senin–Minggu masing-masing berisi kode shift atau `LIBUR` |
| **Roster** | Pengecualian per tanggal (tukar shift, libur pengganti) — mengalahkan pola mingguan |
| **Sesi** | Satu pasang masuk–pulang. Satu hari bisa beberapa sesi (pagi remote, siang kantor) |
| **Status harian** | Hasil hitung per orang per hari: HADIR, ALPA, IZIN, SAKIT, CUTI, DINAS, LIBUR, BELUM_ADA_DATA |
| **Penanda** | Catatan pada hari HADIR: TELAT, PULANG_AWAL, KURANG_JAM, TIDAK_LENGKAP |

## 5. Aturan bisnis

### 5.1 Jadwal efektif per hari (urutan prioritas)

1. Profil `TANPA_ABSEN` → tidak dihitung.
2. Ada **roster** untuk tanggal itu → pakai roster.
3. Tanggal ada di **kalender libur** (berlaku untuk semua atau tim tertentu) → `LIBUR`.
4. Pakai **pola mingguan** profil.
5. Hasil: `LIBUR` atau sebuah shift (untuk mode `FLEKSIBEL`: "hari kerja" dengan target menit harian).

### 5.2 Sesi absen

- Tombol **Masuk** (pilih lokasi `KANTOR` / `REMOTE`) dan **Pulang**. Maksimal 1 sesi aktif per orang.
- Tanggal kerja = tanggal WIB saat masuk.
- Sesi aktif dari tanggal sebelumnya → otomatis `TIDAK_LENGKAP` (saat aksi berikutnya **dan** oleh job harian pukul 03:00 WIB). Durasinya **tidak** dihitung sampai dikoreksi lewat "lupa pulang".
- Durasi sesi maksimal 16 jam. Waktu diambil dari server, bukan dari HP.
- Sumber sesi: `APP`, `KOREKSI` (dari pengajuan disetujui), `FINGERPRINT` (impor, fase HR-6).

### 5.3 Perhitungan harian (fungsi murni, wajib diuji unit)

Input: jadwal efektif, sesi selesai di tanggal itu, izin/cuti disetujui yang mencakup tanggal itu, kebijakan.

1. Ada izin/cuti penuh disetujui → status sesuai jenis (`CUTI`, `SAKIT`, `IZIN`, `DINAS`). `DINAS` dihitung hadir penuh.
2. `LIBUR` → `LIBUR` (sesi di hari libur dicatat sebagai kelebihan jam, bukan lembur, kecuali ada lembur disetujui).
3. Hari kerja tanpa sesi dan tanggal sudah lewat → `ALPA`. Tanggal hari ini/akan datang → `BELUM_ADA_DATA`.
4. Hari kerja dengan sesi → `HADIR`, lalu penanda:
   - **TELAT**: sesi pertama hari itu dimulai lebih dari *toleransi telat* (default 5 menit) setelah jam mulai **segmen tetap pertama** shift. Mode `FLEKSIBEL` tidak pernah telat.
   - **PULANG_AWAL**: sesi terakhir berakhir lebih dari toleransi sebelum jam selesai **segmen tetap terakhir**.
   - **KURANG_JAM**: total menit < target harian − toleransi. Jika kebijakan `carryover_mingguan = true`, penanda ini hanya muncul bila total pekan itu juga di bawah target mingguan (dihitung saat pekan selesai).
   - **TIDAK_LENGKAP**: ada sesi `TIDAK_LENGKAP` yang belum dikoreksi.
5. Izin setengah hari disetujui → target menit hari itu dikurangi 50%; telat tidak dihitung untuk segmen yang tercakup izin.
6. Lembur hanya dihitung bila ada pengajuan lembur **disetujui**; menit di atas target tanpa persetujuan dicatat sebagai "kelebihan jam" (informasi, tidak menambah skor).

> Hasil hitung disimpan di koleksi `hr_rekap_harian` (cache) dan dihitung ulang setiap kali ada sesi, persetujuan, roster, atau kalender yang berubah untuk tanggal terkait. Jangan menghitung di frontend.

### 5.4 Jenis izin & cuti (default, bisa diubah HR)

| Kode | Nama | Kuota/tahun | Potong saldo | Aturan |
|---|---|---|---|---|
| `CUTI_TAHUNAN` | Cuti tahunan | 12 hari | Ya | Diajukan minimal H-3 (HR boleh mengecualikan) |
| `IZIN` | Izin keperluan pribadi/keluarga | 6 hari | Ya (saldo izin) | Boleh H-0 sebelum jam mulai shift |
| `IZIN_SETENGAH` | Izin setengah hari | – (memakai saldo izin 0,5) | Ya | Pilih pagi/siang |
| `SAKIT` | Sakit | Tidak dibatasi | Tidak | Boleh diajukan sampai H+1; > 1 hari wajib tautan surat dokter |
| `DINAS` | Dinas luar / tugas lembaga | Tidak dibatasi | Tidak | Dihitung hadir |
| `CUTI_KHUSUS` | Menikah (3), melahirkan (90 kalender), istri melahirkan (2), duka keluarga inti (2) | Per kejadian | Tidak | Durasi maksimal per subjenis |

- Hari yang dihitung = hari kerja menurut jadwal efektif (libur & hari off tidak memotong saldo).
- Karyawan baru: kuota prorata = kuota × (sisa bulan dalam tahun / 12), dibulatkan ke bawah per 0,5 hari.
- Saldo tidak terpakai hangus 31 Desember (default; kebijakan `maks_bawa_cuti` = 0).
- Pengajuan yang tumpang tindih dengan pengajuan lain yang masih aktif ditolak sistem.
- Pembatalan: pemohon boleh membatalkan sebelum tanggal mulai; setelah tanggal mulai hanya HR.

### 5.5 Alur persetujuan

```
DIAJUKAN ──(kepala tim setuju)──> DISETUJUI_KEPALA ──(HR setuju)──> DISETUJUI
    │                                   │
    └──(tolak, wajib alasan)──> DITOLAK <┘        DIBATALKAN (oleh pemohon/HR)
```

- Koreksi absen, lupa pulang, dan lembur: **satu tahap** (kepala tim; tanpa kepala → HR). HR/SPV boleh membatalkan persetujuan dalam 7 hari dengan alasan.
- Setiap perubahan status mencatat siapa, kapan, catatan → koleksi `hr_log`.
- Notifikasi (lonceng yang sudah ada + Hermes): penyetuju mendapat "perlu persetujuan"; pemohon mendapat hasil.
- Pengajuan yang menunggu > 48 jam ditandai merah di dashboard HR.

### 5.6 Raport bulanan terpadu

**Rekomendasi komponen & bobot** (bobot bisa diubah HR di pengaturan; total 100):

| Komponen | Bobot | Rumus skor 0–100 | Sumber data |
|---|---|---|---|
| Kehadiran & disiplin | 25 | 100 × (0,50 × K1 + 0,25 × K2 + 0,25 × K3). K1 = hari hadir ÷ hari wajib (hari kerja − izin/cuti/sakit/dinas disetujui). K2 = 1 − (hari telat ÷ hari hadir). K3 = min(1, menit kerja ÷ menit target) | `hr_rekap_harian` |
| Kinerja tugas | 35 | 100 × (0,6 × tepat waktu + 0,4 × kepatuhan rutin). Tepat waktu = tugas PROJECT (R = orang ini) bertenggat bulan itu yang selesai ≤ tenggat ÷ semua tugas bertenggat bulan itu. Kepatuhan rutin = centang tugas rutin ÷ yang seharusnya | `tasks`, `todo_entries` |
| KPI / Target | 25 | 100 × (0,7 × rata-rata min(1, progres KR ÷ progres seharusnya) + 0,3 × komitmen rapat selesai ÷ total komitmen) — hanya KR di mana orang ini PIC | `ukuran`, `ukuran_checkins`, `tasks.komitmen_rapat_id` |
| Amaliyah | 15 | Skor amaliyah yang sudah ada di raport lama | `amaliyah_entries` |

Aturan:
1. **Data belum cukup**: komponen dengan cakupan data < 50% (mis. tidak punya KR, atau < 50% hari kerja tercatat) ditampilkan "data belum cukup" dan **bobotnya dibagi proporsional ke komponen lain**. Jangan memberi nilai 0.
2. **Predikat**: ≥ 90 Sangat Baik · 80–89 Baik · 70–79 Cukup · < 70 Perlu Pembinaan (sama dengan skala TSI guru di Dashboard agar konsisten).
3. **Penilaian atasan** (kepala tim; untuk kepala tim → SPV): 3 aspek skala 1–5 (Kerja sama, Inisiatif, Adab & amanah) + catatan kekuatan + catatan perbaikan + rencana bulan depan. **Ditampilkan terpisah, tidak masuk skor angka** — agar penilaian subjektif tidak menyamarkan data.
4. Raport tim = rata-rata skor anggota + distribusi predikat + 3 masalah kehadiran terbanyak.

**Alur bulanan:**

| Tanggal | Siapa | Apa |
|---|---|---|
| 1 (otomatis 02:00) | Sistem | Buat draf raport bulan lalu untuk semua anggota wajib absen |
| 1–5 | Kepala tim | Isi penilaian atasan untuk anggota timnya |
| 5–7 | HR | Periksa, tanyakan anomali, lalu **Kunci & terbitkan** |
| Setelah terbit | Anggota | Melihat raport sendiri + unduh PDF |

Setelah dikunci, angka tidak dihitung ulang walaupun ada koreksi absen terlambat; koreksi seperti itu masuk bulan berikutnya sebagai catatan, atau HR membuka kunci dengan alasan (tercatat di log).

> **Catatan kejujuran untuk pemilik produk:** bobot di atas adalah titik awal yang masuk akal, bukan standar baku. Kalibrasi setelah 2 bulan dengan melihat apakah predikat sejalan dengan penilaian pimpinan. Memasukkan amaliyah (ibadah pribadi) ke skor kinerja kerja adalah pilihan nilai lembaga; jika ragu, set bobotnya 0 dan tampilkan sebagai informasi pembinaan saja.

## 6. Model data (MongoDB, field `id` UUID string)

```text
hr_kebijakan (singleton id="utama")
  toleransi_telat_menit:int=5, toleransi_pulang_menit:int=5, carryover_mingguan:bool=true,
  minggu_mulai:int=1 (Senin), maks_bawa_cuti:float=0, bobot_raport:{kehadiran:25,tugas:35,kpi:25,amaliyah:15},
  batas_penilaian_hari:int=5, batas_terbit_hari:int=7

hr_profil (1 per anggota)
  id, anggota_id (unik), wajib_absen:bool, mode:"SHIFT"|"FLEKSIBEL"|"TANPA_ABSEN",
  target_harian_menit:int=480, target_mingguan_menit:int=2640,
  pola_mingguan:{"1":"PAGI","2":"PAGI",...,"6":"LIBUR","7":"LIBUR"}, tanggal_bergabung:"YYYY-MM-DD", updated_at

hr_shift
  id, kode (unik), nama, aktif:bool, total_menit:int,
  segmen:[{urutan:int, lokasi:"KANTOR"|"REMOTE"|"BEBAS", mulai:"HH:MM"|null, selesai:"HH:MM"|null, menit:int, fleksibel:bool}]

hr_roster
  id, anggota_id, tanggal, shift_kode|null, libur:bool, catatan, dibuat_oleh, created_at    (unik: anggota_id+tanggal)

hr_libur
  id, tanggal, nama, divisi_ids:[] (kosong = semua)

hr_sesi
  id, anggota_id, user_id, tanggal, lokasi:"KANTOR"|"REMOTE", masuk_at, pulang_at|null,
  status:"AKTIF"|"SELESAI"|"TIDAK_LENGKAP"|"DIGANTI", sumber:"APP"|"KOREKSI"|"FINGERPRINT", menit:int|null
  index unik parsial: {anggota_id} where status="AKTIF"

hr_pengajuan   (satu koleksi untuk semua jenis pengajuan)
  id, jenis:"IZIN_CUTI"|"KOREKSI"|"LUPA_PULANG"|"LEMBUR", anggota_id, user_id,
  -- IZIN_CUTI: kode_izin, sub_jenis, mulai, selesai, setengah:"PAGI"|"SIANG"|null, hari_dihitung:float, lampiran_url
  -- KOREKSI/LUPA_PULANG: tanggal, lokasi, masuk, pulang, sesi_id
  -- LEMBUR: tanggal, menit
  alasan, status:"DIAJUKAN"|"DISETUJUI_KEPALA"|"DISETUJUI"|"DITOLAK"|"DIBATALKAN",
  tahap:[{tahap:1|2, oleh_user_id, oleh_nama, keputusan, catatan, at}], created_at, updated_at

hr_jenis_izin
  kode, nama, kuota_tahunan:float|null, potong_saldo:bool, saldo_grup:"CUTI"|"IZIN"|null,
  min_hari_sebelum:int, boleh_mundur_hari:int, wajib_lampiran_jika_lebih_hari:int|null, maks_hari_per_kejadian:int|null, aktif

hr_rekap_harian (cache hasil hitung)
  anggota_id, tanggal, status, penanda:[], menit_kerja, menit_target, menit_lembur, shift_kode, dihitung_at
  (unik: anggota_id+tanggal)

hr_raport
  id, anggota_id, bulan:"YYYY-MM", status:"DRAF"|"DINILAI"|"TERBIT",
  komponen:{kehadiran:{skor,bobot_efektif,detail}, tugas:{...}, kpi:{...}, amaliyah:{...}},
  skor_total, predikat, penilaian_atasan:{kerja_sama,inisiatif,adab,kekuatan,perbaikan,rencana,oleh,at},
  catatan_hr, dikunci_oleh, dikunci_at
  (unik: anggota_id+bulan)

hr_log
  id, entitas, entitas_id, aksi, oleh_user_id, oleh_nama, detail, at
```

Saldo cuti/izin **tidak disimpan**, dihitung: kuota (prorata) − Σ `hari_dihitung` pengajuan `DISETUJUI` dan `DISETUJUI_KEPALA` (dipesan) pada tahun berjalan.

## 7. API (prefix `/api/hr`, file `backend/hr.py`, builder `build_hr_router(srv)`)

| Metode & path | Siapa | Fungsi |
|---|---|---|
| `GET /hr/saya?bulan=` | semua | Profil, jadwal hari ini, sesi aktif, rekap pekan & bulan, saldo, pengajuan saya |
| `POST /hr/absen/masuk` `{lokasi}` | semua (wajib absen) | Buka sesi |
| `POST /hr/absen/pulang` | semua | Tutup sesi aktif |
| `POST /hr/pengajuan` | semua | Buat pengajuan (jenis apa pun); validasi §5 |
| `POST /hr/pengajuan/{id}/batal` | pemohon/HR | Batalkan |
| `GET /hr/persetujuan` | kepala tim/HR/SPV | Daftar yang menunggu keputusan saya |
| `POST /hr/pengajuan/{id}/keputusan` `{setuju:bool, catatan}` | penyetuju sah | Setujui/tolak tahap berjalan |
| `GET /hr/hari-ini` | kepala tim (timnya)/HR/SPV | Siapa sudah masuk, belum masuk, izin, libur |
| `GET /hr/rekap?bulan=&divisi_id=&anggota_id=` | kepala tim/HR/SPV | Matriks status harian per orang + total |
| `GET/PUT /hr/kebijakan` | HR/SPV | Kebijakan |
| `GET/PUT /hr/profil/{anggota_id}` | HR/SPV | Profil kerja |
| `GET/POST/PUT/DELETE /hr/shift` | HR/SPV | Shift & segmen |
| `GET/PUT/DELETE /hr/roster` | HR/SPV/kepala tim (timnya) | Roster per tanggal |
| `GET/POST/DELETE /hr/libur` | HR/SPV | Kalender libur |
| `GET/PUT /hr/jenis-izin` | HR/SPV | Jenis izin & kuota |
| `GET /hr/raport?bulan=&divisi_id=` | kepala tim/HR/SPV | Daftar raport |
| `GET /hr/raport/{id}` | pemilik (bila TERBIT)/kepala tim/HR/SPV | Detail |
| `PUT /hr/raport/{id}/penilaian` | kepala tim/SPV | Isi penilaian atasan |
| `POST /hr/raport/{id}/kunci` · `/buka` | HR/SPV | Kunci & terbitkan / buka kunci (wajib alasan) |
| `POST /hr/raport/generate?bulan=` | HR/SPV | Buat/hitung ulang draf (otomatis tiap tanggal 1) |
| `GET /hr/raport/{id}/pdf` | sama dengan detail | PDF |

Job latar (pola sama seperti `dashboard_sync.loop` di `server.py`): 03:00 WIB tandai sesi basi + hitung ulang rekap kemarin; tanggal 1 pukul 02:00 WIB buat draf raport.

## 8. Antarmuka

| Layar | Menu | Isi utama |
|---|---|---|
| **Kehadiran Saya** | Menu baru "Kehadiran" (semua) | Kartu besar: jadwal hari ini (segmen), tombol **Masuk Kantor / Masuk Remote / Pulang**, timer sesi aktif; ringkasan pekan (jam vs target); kalender bulan berwarna per status; saldo cuti & izin; tombol Ajukan izin/cuti, Koreksi, Lupa pulang, Lembur; riwayat pengajuan |
| **Persetujuan** | "Kehadiran" → tab Persetujuan (kepala tim/HR/SPV) | Daftar menunggu dengan konteks (saldo, jadwal, riwayat 30 hari), tombol Setujui/Tolak |
| **Hari Ini** | Menu "HR" (HR/SPV; kepala tim melihat timnya di Laporan) | Siapa sudah masuk/belum/izin/libur, sesi tidak lengkap |
| **Rekap Bulanan** | Menu "HR" | Matriks orang × tanggal berwarna, total hadir/telat/alpa/izin/jam, ekspor |
| **Jadwal** | Menu "HR" | Shift & segmen, pola mingguan per orang, roster (kalender), kalender libur |
| **Raport Bulanan** | Menu "HR" + Laporan | Daftar per tim, status DRAF/DINILAI/TERBIT, form penilaian atasan, kunci, PDF |
| **Pengaturan HR** | Menu "HR" | Kebijakan, jenis izin & kuota, bobot raport |

Wajib: tampilan HP-first (tombol absen ≥ 48px, tanpa scroll horizontal di lebar 390px), tooltip istilah, semua teks Bahasa Indonesia.

## 9. Integrasi

- **Lonceng notifikasi** (`/notifications/feed`): tambah jenis `persetujuan_hr` dan `hasil_pengajuan_hr`.
- **Hermes (MCP, `agent_mcp.py`)**: tool `absen_masuk(lokasi)`, `absen_pulang()`, `status_kehadiran_saya()`, `ajukan_izin(kode, mulai, selesai, alasan)`, `saldo_cuti_saya()`, `persetujuan_hr_saya()` (kepala tim/HR). Tool tulis hanya untuk diri sendiri; persetujuan **tidak** lewat Hermes di v1.
- **Raport lama** (`/raport/summary`, `Raport.jsx`): dipertahankan sampai HR-5 rilis, lalu dialihkan ke raport terpadu.

## 10. Kasus tepi yang wajib ditangani

1. Lupa pulang lalu besoknya masuk lagi → sesi kemarin `TIDAK_LENGKAP`, sesi baru tetap bisa dibuka.
2. Shift melewati tengah malam: **tidak didukung di v1** — validasi shift menolak segmen dengan selesai < mulai.
3. Pindah tim di tengah bulan → raport memakai tim pada akhir bulan; persetujuan memakai kepala tim saat pengajuan dibuat.
4. Kepala tim cuti → pengajuan anggotanya bisa disetujui HR langsung (HR mengambil alih tahap 1).
5. Pengajuan sakit H+1 untuk hari yang sudah berstatus ALPA → setelah disetujui, status hari berubah dan rekap dihitung ulang.
6. Koreksi untuk bulan yang raportnya sudah TERBIT → ditolak sistem dengan pesan "raport bulan ini sudah dikunci, minta HR membuka kunci".
7. Libur ditambahkan setelah ada cuti di tanggal itu → `hari_dihitung` dihitung ulang dan saldo dikembalikan.
8. Anggota tanpa akun login (belum ditautkan) → tidak bisa absen; HR dapat peringatan di dashboard.
9. Dua kali klik Masuk cepat → index unik parsial mencegah 2 sesi aktif; API mengembalikan pesan yang jelas.

## 11. Fase eksekusi

Setiap fase: kerjakan → uji di DB salinan → deploy → commit. Jangan gabung fase.

### HR-1 — Fondasi data & pengaturan
- **File:** `backend/hr.py` (baru), `backend/server.py` (include router, index, `user_scope` + `is_hr`, role `hr` di manajemen pengguna), `backend/auth.py` (izinkan role `hr`), `frontend/src/lib/api.js`, `frontend/src/App.js`, `frontend/src/layouts/AppShell.jsx`, `frontend/src/pages/hr/Pengaturan*.jsx` (baru), `frontend/src/pages/UsersManagement.jsx`.
- **Seed:** kebijakan default, 2 shift default (Pagi, Siang — segmen seperti leaderboard), jenis izin §5.4, profil untuk semua anggota (`wajib_absen=true`, mode `SHIFT`, pola Senin–Jumat PAGI, Sabtu–Minggu LIBUR) — HR menyesuaikan.
- **Kriteria selesai:** SPV bisa menjadikan pengguna HR; HR bisa mengubah kebijakan, shift (dengan segmen), pola mingguan, roster, libur; anggota tidak bisa mengakses endpoint pengaturan (403); fungsi `jadwal_efektif(anggota, tanggal)` lolos uji unit untuk 5 aturan prioritas §5.1.

### HR-2 — Absensi
- **File:** `backend/hr.py`, `backend/hr_hitung.py` (baru, fungsi murni §5.3), `frontend/src/pages/Kehadiran.jsx` (baru) + komponennya.
- **Kriteria selesai:** masuk/pulang bekerja; tidak bisa 2 sesi aktif; sesi basi jadi TIDAK_LENGKAP; koreksi, lupa pulang, lembur bisa diajukan & disetujui kepala tim; uji unit §5.3 mencakup telat, pulang awal, kurang jam, carryover, setengah hari, libur, alpa.

### HR-3 — Izin & cuti
- **Kriteria selesai:** 6 jenis izin berlaku dengan aturan §5.4; persetujuan 2 tahap + pengecualian §3; saldo benar (termasuk prorata dan pemesanan); tumpang tindih ditolak; notifikasi muncul di lonceng.

### HR-4 — Rekap kehadiran
- **Kriteria selesai:** layar Hari Ini & Rekap Bulanan; `hr_rekap_harian` dihitung ulang saat data terkait berubah; job 03:00 berjalan; ekspor CSV.

### HR-5 — Raport bulanan terpadu
- **File:** `backend/hr_raport.py` (baru), PDF memakai pola `pdf_export.py`, `frontend/src/pages/hr/Raport*.jsx`.
- **Kriteria selesai:** rumus §5.6 diuji dengan data contoh (termasuk aturan "data belum cukup"); alur DRAF → DINILAI → TERBIT; anggota hanya melihat raport sendiri yang TERBIT; PDF per orang & per tim.

### HR-6 — Impor fingerprint (opsional)
- Port parser `app/fingerprint/parser.go` (format "Tanggal Kehadiran : YYYY-MM-DD ~ YYYY-MM-DD", jam `HH:MM` per hari) ke Python (`xlrd`). Pasangkan jam pertama–terakhir per hari menjadi sesi `sumber=FINGERPRINT` lokasi KANTOR. Pratinjau wajib sebelum simpan. Tambah field `fingerprint_id` di `hr_profil`.

### HR-7 — Hermes
- Tambah tool di `agent_mcp.py` (§9) memakai fungsi yang sama dengan REST, termasuk pengecekan izin.

## 12. Pertanyaan terbuka (jawab sebelum HR-1)

1. Siapa yang menjadi HR? (Dibutuhkan untuk seed role.)
2. Pola kerja nyata per orang: siapa shift pagi, siapa siang, siapa fleksibel, hari Sabtu kerja atau tidak?
3. Apakah mesin fingerprint kantor masih dipakai? Jika ya, HR-6 menjadi prioritas lebih tinggi.
4. Apakah absen di kantor perlu dibuktikan (lokasi/IP) sejak awal, atau cukup kejujuran dulu? (Rekomendasi: kejujuran dulu, ukur 1 bulan, lalu putuskan.)
5. Apakah raport terbit dapat dilihat anggota yang bersangkutan? (Rekomendasi: ya — raport yang tidak dilihat orangnya tidak mengubah perilaku.)
6. Bobot amaliyah di skor raport: 15 atau 0 (informasi saja)?

## 13. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Absen aplikasi berbasis kejujuran (bisa "Masuk Kantor" dari rumah) | Data kantor tidak bisa dipercaya penuh | Mulai dengan budaya + audit acak; opsi D1 (GPS/IP) bila perlu |
| Tim merasa diawasi | Resistensi, data asal isi | Sosialisasi tujuan (keadilan & perencanaan, bukan hukuman); 1 bulan masa uji tanpa masuk raport |
| Aturan jadwal tidak sesuai kenyataan | Banyak "telat/alpa" palsu | HR-1 wajib mengisi pola kerja nyata; pantau minggu pertama |
| Skor raport dianggap mutlak | Keputusan SDM salah | Tampilkan komponen & cakupan data, bukan hanya angka total; penilaian atasan terpisah |
| AI eksekutor mengubah aturan izin akses | Kebocoran data antar tim | Uji izin otomatis (roadmap A4) sebelum HR-1 |
