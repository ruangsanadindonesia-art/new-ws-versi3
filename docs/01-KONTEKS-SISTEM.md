# 01 — Konteks Sistem Workspace Ruang Sanad

> Kondisi per 16 November 2026, branch `fitur/sasaran` (commit `dbdc0eb`). Dokumen ini wajib dibaca AI sebelum mengubah kode.

## 1. Apa aplikasi ini

Workspace internal tim Ruang Sanad (lembaga belajar Al-Qur'an) di `https://workspace.ruangsanad.com`. Dipakai ±10–20 orang staf (bukan santri) untuk:

| Menu | Fungsi | Siapa |
|---|---|---|
| **Tugas** | Tugas tim dengan RACI, kanban/tabel, siklus review | Semua |
| **Harian Saya** | Checklist tugas rutin + amaliyah harian + check-in KPI | Semua |
| **Target Bersama** | Sistem manajemen target: Papan Skor, Rapat Mingguan, OKR/BSC/KPI, Evaluasi | SPV saja (sementara) |
| **Laporan** | Monitoring tim, raport per orang (tugas + amaliyah) | SPV, kepala tim |
| **Pengaturan** | Pengguna, tim/divisi, kategori, amaliyah, Integrasi AI | SPV (sebagian semua) |

Aplikasi terpisah yang terkait: **Dashboard Ruang Sanad** (`dashboard.ruangsanad.com`, data santri/kelas/tagihan/lead; diakses lewat MCP) dan agen AI **Hermes** (mengakses Workspace lewat MCP).

## 2. Stack & infrastruktur

| Lapisan | Teknologi |
|---|---|
| Backend | Python 3.12, FastAPI 0.110, Pydantic 2, Motor 3.3 (MongoDB async), ReportLab (PDF) |
| Database | MongoDB, database `workspace_rs_v2` (data kecil: ±200 dokumen) |
| Frontend | React 19, React Router 7, CRA + craco 7, Tailwind, shadcn/ui (Radix), lucide-react, sonner (toast) |
| Server | 1 VPS Ubuntu. systemd `workspace-v3` → `uvicorn server:app --port 8001` di `/var/www/new-ws-versi3/backend` |
| Web | nginx: `/` → `/var/www/new-ws-versi3/frontend/build`, `/api/` → `127.0.0.1:8001` |
| Repo | GitHub `ruangsanadindonesia-art/new-ws-versi3` (**publik** — jangan commit rahasia) |

## 3. Struktur kode

```
backend/
  server.py          # app utama: auth, tugas, RACI, review, divisi/anggota, amaliyah, todo, raport, notifikasi, startup
  auth.py            # login/sesi (cookie/Bearer di user_sessions), API key MCP, seed admin
  sasaran.py         # Target Bersama: periode, objective (sasaran), key result (ukuran), check-in, papan skor, pengaturan ritme
  ritme.py           # Rapat Target Mingguan: rapat, isu (IDS), komitmen → tugas
  dashboard_sync.py  # Tarik 23 metrik dari Dashboard Ruang Sanad tiap 6 jam
  agent_mcp.py       # Server MCP (/api/mcp) untuk Hermes, per-user API key
  monitoring.py, pdf_export.py, sasaran_pdf.py, ...  # laporan & PDF
  strategy.py        # modul Strategi lama (tidak dipakai di menu, data dimigrasi ke sasaran)
frontend/src/
  App.js                       # routing; ProtectedRoute requireSpv / requireMonitor
  layouts/AppShell.jsx         # sidebar NAV (spvOnly filter)
  lib/api.js                   # SEMUA pemanggilan API (axios) ada di sini
  lib/AuthContext.jsx          # useAuth(), formatApiErr()
  components/ui/*              # shadcn/ui
  components/PageTabs.jsx, NotificationBell.jsx
  pages/Tasks.jsx + pages/tasks/*      # tugas, RACI (raci.jsx: PersonSelect, PeopleSelect)
  pages/Harian.jsx, Laporan.jsx, Raport.jsx, Monitoring.jsx, Pengaturan.jsx, IntegrasiAI.jsx
  pages/Sasaran.jsx + pages/sasaran/*  # Target Bersama (PapanSkor, Rapat, Panduan, Evaluasi, parts)
```

### Pola kode yang harus diikuti

- **Router modul baru** dibuat sebagai fungsi builder, lalu di-include di `server.py`:
  ```python
  # ritme.py
  def build_ritme_router(srv) -> APIRouter:      # srv = modul server (akses srv.db, srv.get_current_user, srv.user_scope, srv.create_task)
      router = APIRouter(prefix="/ritme")
      ...
      return router
  # server.py (setelah `import sys as _sys`)
  api_router.include_router(build_ritme_router(_sys.modules[__name__]))
  ```
- Dokumen Mongo memakai field `id` (UUID string), **bukan** `_id`. Selalu proyeksi `{"_id": 0}`.
- Waktu disimpan ISO 8601 UTC (`datetime.now(timezone.utc).isoformat()`); tanggal kerja `YYYY-MM-DD` dalam **WIB (Asia/Jakarta)**.
- Validasi input dengan Pydantic `BaseModel` + `ConfigDict(extra="ignore")`. Error ke pengguna: `HTTPException(400/403/404, "pesan Bahasa Indonesia")`.
- Index dibuat di `on_startup()` dalam `server.py` (try/except).
- Frontend: fungsi API baru ditambahkan ke `lib/api.js`; error ditampilkan `toast.error(formatApiErr(e))`; warna utama Tailwind `emerald`; setiap elemen penting diberi `data-testid`.
- Semua teks UI Bahasa Indonesia; istilah manajemen boleh Inggris dengan tooltip (`InfoTip`).

## 4. Pengguna, peran, dan izin

| Konsep | Penyimpanan | Catatan |
|---|---|---|
| Akun login | `users` (`user_id`, `email`, `role`, `status`, `anggota_id`) | `role`: `spv` atau `anggota`. `status`: `pending`/`approved`/`rejected` |
| Orang di tim | `anggota` (`id`, `nama`, `divisi_id`) | Satu akun ditautkan ke satu anggota lewat `users.anggota_id` |
| Tim | `divisi` (`id`, `nama`, `head_anggota_id`) | **Kepala tim tidak punya role sendiri**: dia anggota yang id-nya = `head_anggota_id` |

Fungsi kunci `user_scope(user)` di `server.py` mengembalikan `{is_spv, anggota_id, divisi_id, is_head, head_divisi_id}`. **Semua pengecekan izin harus memakai fungsi ini**, bukan membaca `role` langsung.

Tim yang ada: Head Marketing, Customer Service, Admin Kelas, Multimedia, Koor. Guru, Finance, Supervisor.

## 5. Data utama (koleksi MongoDB)

| Koleksi | Isi |
|---|---|
| `tasks` | Tugas. RACI: `penerima_tugas_id`=R, `pemberi_id`=A, `consulted_ids`, `informed_ids`. Status `BELUM_MULAI/DALAM_PROSES/MENUNGGU_REVIEW/REVISI/TERKENDALA/SELESAI`. `kategori` HARIAN/MINGGUAN/BULANAN (rutin) atau PROJECT. `sasaran_id`, `komitmen_rapat_id` opsional |
| `task_lists`, `task_activity`, `task_labels`, `kategori` | Kolom kanban per divisi, log aktivitas, label |
| `todo_entries` | Centang tugas rutin per periode |
| `amaliyah_items`, `amaliyah_entries` | Daftar amaliyah dan centang harian per user |
| `raport_notes` | Catatan SPV untuk raport per anggota |
| `strategy_periods` | Periode/siklus (aktif satu) |
| `sasaran`, `ukuran`, `ukuran_checkins` | Objective, key result (jenis LAG/LEAD, `sumber` metrik otomatis), riwayat check-in |
| `metric_snapshots`, `dashboard_sync_log` | Snapshot harian 23 metrik Dashboard |
| `rapat_target`, `isu_target`, `target_settings` | Rapat mingguan, isu, pengaturan ritme (Selasa 09:00, fasilitator) |
| `api_keys`, `agent_chat_links`, `agent_audit` | MCP Hermes |
| `users`, `user_sessions` | Akun & sesi |

## 6. Aturan bisnis yang sudah berlaku (jangan dirusak)

1. **RACI:** tepat 1 R dan 1 A per tugas. Jika R ≠ A, tugas yang ditandai selesai oleh R masuk `MENUNGGU_REVIEW` dan harus disetujui A (atau dikembalikan `REVISI`).
2. Status tugas dan kolom kanban selalu sinkron (satu fungsi di `server.py`).
3. Anggota hanya melihat tugas di mana ia R/A/C/I; kepala tim melihat tugas timnya; SPV melihat semua.
4. Target Bersama: status KR berbasis waktu (progres vs waktu berjalan bila ada baseline). KR bersumber otomatis tidak boleh diisi angka manual.
5. Komitmen rapat menjadi tugas dengan R = orangnya, A = fasilitator, tenggat 6 hari.
6. API key (`rs_live_...`) **hanya** berlaku untuk `/api/mcp`, tidak untuk REST API.

## 7. Cara uji & deploy (wajib diikuti)

1. **Backup**: `mongodump --db workspace_rs_v2 --archive=/root/backups/<nama>/db.archive.gz --gzip` + tar folder `frontend/build` dan file backend yang diubah.
2. **Uji backend di salinan DB**: restore ke DB `ws3_test`, jalankan salinan backend di port lain (mis. 8099) dengan `DB_NAME=ws3_test` dan `DASHBOARD_SYNC=0`, jalankan skrip uji API.
3. **Build frontend** di server: `CI=false GENERATE_SOURCEMAP=false node_modules/.bin/craco build`. Sebelum build, jalankan eslint aturan `no-undef` (pernah terjadi halaman putih karena import lupa).
4. **Deploy**: salin file backend → `systemctl restart workspace-v3` → cek `journalctl -u workspace-v3`. Frontend: ganti folder `build` secara atomik (`build.new` → `build`).
5. **Rollback**: kembalikan file dari folder backup, `mongorestore --drop` bila data berubah.

## 8. Masalah yang diketahui

- Repo publik dan riwayat commit lama (`23d9fb1`) memuat kredensial; password admin default harus diganti.
- Pull request perbaikan keamanan/RACI (`perbaikan/keamanan-logika-raci`) belum di-merge ke `main`; production berjalan dari branch `fitur/sasaran`.
- Modul `strategy.py` + `pages/strategy/*` sudah tidak dipakai (data dipindah ke `sasaran`); kandidat dihapus.
- Belum ada test otomatis di repo; pengujian selama ini memakai skrip ad-hoc.
- Tidak ada konsep "jam kerja", "absensi", "izin", atau "cuti" sama sekali (lihat `03-PRD-MODUL-HR.md`).
