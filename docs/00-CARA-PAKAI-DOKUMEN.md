# 00 — Cara Melanjutkan Development dengan AI Lain

Dokumen di folder `docs/` ditulis agar AI lain (ChatGPT, Gemini, Claude, Codex, Cursor) bisa melanjutkan pengembangan Workspace Ruang Sanad tanpa mengulang analisis.

| File | Isi | Kapan diupload |
|---|---|---|
| `00-CARA-PAKAI-DOKUMEN.md` | Panduan ini + template prompt | Dibaca pemilik proyek |
| `01-KONTEKS-SISTEM.md` | Kondisi sistem saat ini: stack, struktur, data, peran, aturan, cara deploy | **Selalu** diupload di setiap percakapan baru |
| `02-ROADMAP.md` | Daftar pekerjaan berikutnya + prioritas | Saat memilih pekerjaan |
| `03-PRD-MODUL-HR.md` | Spesifikasi lengkap modul HR (absensi, izin/cuti, raport bulanan) | Saat mengerjakan modul HR |

---

## 1. Batasan yang perlu dipahami

**ChatGPT/Gemini versi chat tidak bisa membuka repo GitHub maupun server.** Artinya:

1. AI hanya tahu isi file yang Anda upload/tempel. Jika Anda meminta mengubah `server.py` tanpa mengupload `server.py`, AI akan **menebak** isi file dan hasilnya hampir pasti salah.
2. AI tidak bisa menjalankan test, build, atau melihat error. Anda yang menjalankan dan menempel error-nya kembali.
3. Anda yang menyalin hasil ke server. Salah tempel di production = aplikasi mati.

Konsekuensi: cara chat **bisa** dipakai, tetapi lambat dan berisiko untuk perubahan besar seperti modul HR (±15–25 file). Alternatif yang lebih aman untuk eksekusi:

| Alat | Bisa baca repo | Bisa jalankan test | Cocok untuk |
|---|---|---|---|
| ChatGPT / Gemini (chat) | Tidak (upload manual) | Tidak | Desain, review, perubahan 1–3 file |
| ChatGPT Codex / Claude Code / Cursor | Ya | Ya | Implementasi fitur multi-file |

Rekomendasi: gunakan chat untuk **merancang dan mereview**, gunakan agen coding (Codex/Claude Code/Cursor) untuk **mengeksekusi**. Dokumen ini berlaku untuk keduanya.

---

## 2. Alur kerja yang disarankan (cara chat)

1. **Mulai percakapan baru per fase.** Satu percakapan = satu fase dari PRD (mis. "Fase HR-1: data & pengaturan"). Percakapan panjang membuat AI lupa detail awal.
2. **Upload:** `01-KONTEKS-SISTEM.md` + PRD terkait + **file kode yang akan diubah** (lihat kolom "File yang disentuh" di setiap fase PRD). Ambil file terbaru dari GitHub: `https://github.com/ruangsanadindonesia-art/<repo>/blob/<branch>/<path>` → tombol *Raw* → simpan.
3. **Tempel prompt pembuka** (template di bagian 3).
4. **Minta rencana dulu, kode belakangan.** AI harus menjelaskan file apa yang diubah dan kenapa sebelum menulis kode.
5. **Minta file utuh**, bukan potongan "tambahkan di sekitar baris X". Potongan sering salah tempat.
6. **Uji di lingkungan uji dulu** (lihat `01-KONTEKS-SISTEM.md` bagian Deploy). Tempelkan error apa adanya ke AI.
7. **Commit per fase** dengan pesan yang menjelaskan fase tersebut, lalu perbarui `02-ROADMAP.md` (centang yang selesai).

## 3. Template prompt pembuka

```
Kamu adalah engineer senior yang melanjutkan proyek Workspace Ruang Sanad.
Saya lampirkan:
- 01-KONTEKS-SISTEM.md (kondisi sistem dan aturan proyek — WAJIB dipatuhi)
- 03-PRD-MODUL-HR.md (spesifikasi fitur)
- File kode: [sebutkan, mis. backend/server.py, frontend/src/App.js]

Tugas: kerjakan [Fase HR-1] dari PRD.

Aturan:
1. Jangan menebak isi file yang tidak saya lampirkan. Jika butuh file lain, minta dulu.
2. Langkah 1: tulis rencana singkat (file yang diubah/dibuat, endpoint, koleksi data, risiko). Tunggu persetujuan saya.
3. Langkah 2: tulis kode sebagai FILE UTUH per file, lengkap dengan path.
4. Ikuti pola kode yang sudah ada (FastAPI router builder, Pydantic, Motor; React + shadcn/ui + Tailwind emerald).
5. Semua teks UI dalam Bahasa Indonesia.
6. Sertakan langkah uji manual dan daftar kriteria penerimaan dari PRD yang terpenuhi.
7. Jika ada keputusan yang tidak dijawab PRD, tanyakan — jangan mengarang aturan bisnis.
```

## 4. Prompt lanjutan yang berguna

- Review: `Review kode ini terhadap PRD bagian X. Sebutkan bug, celah izin akses, dan kriteria penerimaan yang belum terpenuhi. Jangan menulis ulang kodenya.`
- Debug: `Ini error lengkap: [tempel]. Ini file terkait: [lampirkan]. Jelaskan penyebab dulu, baru perbaikan minimal.`
- Lanjut sesi: `Kita di Fase HR-2. Fase HR-1 sudah selesai di commit [hash]. Berikut file terbarunya: ...`

## 5. Hal yang JANGAN dilakukan

- Jangan menempel isi `.env`, password, API key, atau token ke AI mana pun.
- Jangan meminta AI "memperbaiki semua sekaligus". Satu fase per kali.
- Jangan deploy ke production tanpa backup database (`mongodump`) dan build lama.
- Jangan menerima kode yang mengubah aturan izin akses (siapa boleh melihat/mengubah apa) tanpa membandingkan dengan tabel izin di PRD.
