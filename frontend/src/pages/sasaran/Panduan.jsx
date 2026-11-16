import { useEffect, useState } from "react";
import { ritmePengaturan } from "@/lib/api";
import { InfoTip, JenisTag } from "@/pages/sasaran/parts";

// Panduan kerja Target Bersama: siapa melakukan apa, kapan, bagaimana. Ditulis untuk orang tanpa latar manajemen.
export default function Panduan() {
  const [c, setC] = useState(null);
  useEffect(() => { ritmePengaturan().then(setC).catch(() => setC({})); }, []);
  const fas = c?.fasilitator_nama || "fasilitator";
  const hari = (c?.hari_rapat || "SELASA").toLowerCase();
  const jam = c?.jam_rapat || "09:00";
  const batas = c?.batas_checkin || "Senin 17.00";

  const PERAN = [
    { siapa: "Pimpinan / SPV", tanggung: "Pemilik target lembaga. Menetapkan objective & target per siklus, memutuskan prioritas bila ada bentrok sumber daya.",
      kapan: "Awal siklus (penyusunan), akhir bulan (review), akhir siklus (evaluasi).", cara: "Tab OKR → buat objective + key result. Tab Evaluasi di akhir siklus." },
    { siapa: `Fasilitator rapat (${fas})`, tanggung: "Menjaga ritme: rapat tiap pekan berjalan tepat waktu, isu ditutup dengan keputusan, komitmen tercatat.",
      kapan: `Senin sore cek siapa belum check-in; ${hari} ${jam} memimpin rapat.`, cara: "Tab Rapat → Mulai rapat pekan ini → ikuti 5 langkah. Menjadi A (penyetuju) semua komitmen." },
    { siapa: "Kepala tim (owner objective)", tanggung: "Bertanggung jawab objective timnya tercapai. Memastikan setiap key result punya PIC dan ukuran proses yang jelas.",
      kapan: "Tiap pekan sebelum rapat; ikut rapat mingguan.", cara: "Papan Skor → filter Milik saya. Bawa usulan solusi untuk isu timnya." },
    { siapa: "PIC ukuran", tanggung: "Memegang satu angka. Menjelaskan kenapa angka naik/turun dan menjalankan komitmen yang menggerakkannya.",
      kapan: `Check-in paling lambat ${batas}.`, cara: "Papan Skor → Check-in. Ukuran manual: isi angka. Ukuran otomatis: isi keyakinan + catatan penyebab." },
    { siapa: "Anggota tim", tanggung: "Menjalankan tugas yang terhubung ke target (termasuk komitmen rapat yang diberikan kepadanya).",
      kapan: "Harian.", cara: "Menu Tugas → Untuk saya. Tandai selesai; laporkan bila terkendala." },
    { siapa: "Sistem (otomatis)", tanggung: "Mengambil angka dari Dashboard Ruang Sanad, menghitung status, membuat isu dari angka merah/kuning, mengubah komitmen menjadi tugas.",
      kapan: "Setiap 6 jam; saat rapat dimulai.", cara: "Tidak perlu dioperasikan. SPV bisa menekan Ambil data sekarang di Papan Skor." },
    { siapa: "Hermes (asisten AI)", tanggung: "Membantu PIC check-in dan melihat target lewat chat. Tidak mengambil keputusan.",
      kapan: "Kapan saja.", cara: "Tanya Hermes: “target saya apa?”, “check-in KR X, catatan …”." },
  ];

  const MINGGU = [
    { hari: "Senin", isi: `PIC check-in semua ukurannya sebelum ${batas}. Sore: ${fas} membuka Papan Skor, filter Belum check-in, mengingatkan yang belum.` },
    { hari: hari[0].toUpperCase() + hari.slice(1), isi: `${jam} Rapat Target Mingguan 45 menit (SPV, ${fas}, kepala tim, PIC). Hasil: isu terputus + komitmen baru menjadi tugas.` },
    { hari: "Rabu–Jumat", isi: "Semua orang menjalankan komitmen. Yang terkendala menandai tugasnya Terkendala agar terlihat lebih awal." },
    { hari: "Tiap 6 jam", isi: "Sistem memperbarui angka otomatis dari Dashboard dan menyimpan riwayat harian." },
    { hari: "Rapat terakhir tiap bulan", isi: "Tambah 30 menit: lihat tren 4–5 pekan, apakah ukuran proses benar-benar menggerakkan ukuran hasil. Bila tidak, ganti ukuran prosesnya." },
    { hari: "Akhir siklus", isi: "SPV mengisi tab Evaluasi, unduh PDF, lalu susun siklus berikutnya (salin OKR yang masih relevan)." },
  ];

  return (
    <div className="space-y-4 text-sm text-emerald-950" data-testid="panduan-view">
      <section className="rounded-xl border border-emerald-100 bg-white p-4">
        <h3 className="font-display text-base font-semibold">Inti sistem dalam 4 kalimat</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-emerald-900/90">
          <li><b>Sedikit target.</b> Tiap siklus maksimal 3–5 objective lembaga; tiap objective 2–4 angka (key result).</li>
          <li><b>Pisahkan hasil dan proses.</b> <JenisTag jenis="LAG" /> angka hasil (mis. santri aktif) <InfoTip k="LAG" /> digerakkan oleh <JenisTag jenis="LEAD" /> kegiatan pekanan (mis. % lead sampai discovery) <InfoTip k="LEAD" />. Tim fokus menggerakkan angka proses.</li>
          <li><b>Satu papan skor.</b> Angka diambil otomatis dari Dashboard bila tersedia; sisanya di-check-in PIC tiap pekan.</li>
          <li><b>Ritme tetap.</b> Rapat 45 menit tiap {hari} {jam}: lihat angka merah → putuskan → komitmen → dicek pekan depan.</li>
        </ol>
      </section>

      <section className="rounded-xl border border-emerald-100 bg-white p-4">
        <h3 className="font-display text-base font-semibold">Siapa melakukan apa</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-[10px] uppercase tracking-wide text-emerald-800/60"><tr><th className="py-1 pr-3">Peran</th><th className="py-1 pr-3">Tanggung jawab</th><th className="py-1 pr-3">Kapan</th><th className="py-1">Caranya di aplikasi</th></tr></thead>
            <tbody>{PERAN.map((p) => (
              <tr key={p.siapa} className="border-t border-emerald-50 align-top"><td className="py-2 pr-3 font-semibold">{p.siapa}</td><td className="py-2 pr-3">{p.tanggung}</td><td className="py-2 pr-3">{p.kapan}</td><td className="py-2">{p.cara}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-emerald-100 bg-white p-4">
        <h3 className="font-display text-base font-semibold">Kalender kerja</h3>
        <ul className="mt-2 space-y-1.5">{MINGGU.map((m) => <li key={m.hari} className="flex gap-3"><span className="w-40 shrink-0 font-semibold">{m.hari}</span><span className="text-emerald-900/90">{m.isi}</span></li>)}</ul>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-100 bg-white p-4">
          <h3 className="font-display text-base font-semibold">Contoh alur satu pekan</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-emerald-900/90">
            <li>Sistem: konversi lead ke discovery turun ke 18% (target 35%) → status Off track.</li>
            <li>Senin: Kang Nurdin (PIC) check-in, catatan “CS kewalahan, 200 lead tidak dibalas 24 jam”.</li>
            <li>{hari[0].toUpperCase() + hari.slice(1)}: rapat otomatis memuat isu “Off track: Lead ke discovery”.</li>
            <li>IDS: akar masalah = balasan pertama lambat. Keputusan: template balasan + jadwal piket CS. PJ: Kang Nurdin.</li>
            <li>Komitmen: Kang Nurdin “Buat template & piket CS” → otomatis jadi tugas, tenggat 6 hari.</li>
            <li>Pekan depan: langkah 2 rapat mengecek selesai/tidak; Papan Skor menunjukkan apakah angkanya naik.</li>
          </ol>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-white p-4">
          <h3 className="font-display text-base font-semibold">Aturan main</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-emerald-900/90">
            <li>Setiap angka punya tepat 1 PIC. Angka tanpa PIC tidak akan bergerak.</li>
            <li>Angka hijau tidak dibahas di rapat. Waktu rapat untuk yang merah/kuning.</li>
            <li>Isu ditutup hanya dengan keputusan + penanggung jawab.</li>
            <li>Komitmen = tindakan baru yang menggerakkan angka, bukan pekerjaan rutin.</li>
            <li>Disiplin komitmen sehat ≥ 80% selesai. Di bawah itu, kurangi jumlah komitmen, jangan menambah.</li>
            <li>Ukuran proses yang 4 pekan hijau tapi ukuran hasil tidak bergerak = ganti ukuran prosesnya.</li>
            <li>Target realistis lebih berguna daripada target ambisius yang semua orang tahu tidak akan tercapai.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
