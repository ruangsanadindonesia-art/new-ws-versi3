import { useMemo } from "react";
import { KONTEN_STATUS, kontenWarna } from "./shared";

const STATUS = { BELUM_MULAI: "Belum dimulai", DALAM_PROSES: "Dalam proses", MENUNGGU_REVIEW: "Menunggu review", REVISI: "Revisi", TERKENDALA: "Terkendala", SELESAI: "Selesai" };
const WARNA = { BELUM_MULAI: "bg-slate-100 text-slate-700", DALAM_PROSES: "bg-sky-100 text-sky-800", MENUNGGU_REVIEW: "bg-yellow-300 text-yellow-950",
  REVISI: "bg-red-100 text-red-700", TERKENDALA: "bg-orange-100 text-orange-800", SELESAI: "bg-emerald-100 text-emerald-800" };
const HEAD = ["#1d4ed8", "#9d4b7a", "#047857", "#b45309", "#6d28d9", "#0e7490", "#be123c", "#4d7c0f"];
const lokal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tgl = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

// Tampilan "Per orang" (tab Tim saya): satu tabel to-do per anggota, berdampingan — seperti spreadsheet action plan tim.
export default function PerOrang({ tasks, anggota, anggotaMap, onEdit }) {
  const hariIni = lokal(new Date());
  const tigaHari = lokal(new Date(Date.now() + 3 * 864e5));
  const kolom = useMemo(() => {
    const per = {};
    tasks.forEach((t) => { const id = t.penerima_tugas_id || "-"; (per[id] = per[id] || []).push(t); });
    const ids = [...anggota.map((a) => a.id), ...Object.keys(per).filter((id) => !anggota.some((a) => a.id === id))];
    return ids.map((id) => ({
      id, nama: anggotaMap[id]?.nama || (id === "-" ? "Tanpa penanggung jawab" : "?"),
      list: (per[id] || []).slice().sort((a, b) => (a.status === "SELESAI") - (b.status === "SELESAI") || (a.deadline || "9999").localeCompare(b.deadline || "9999")),
    })).filter((c) => c.list.length || anggota.some((a) => a.id === c.id));
  }, [tasks, anggota, anggotaMap]);
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="per-orang">
      {kolom.map((c, ci) => {
        const aktif = c.list.filter((t) => t.status !== "SELESAI");
        const telat = aktif.filter((t) => t.deadline && t.deadline < hariIni).length;
        return (
          <section key={c.id} className="overflow-hidden rounded-xl border border-emerald-100 bg-white" data-testid={`orang-${c.id}`}>
            <header className="flex items-center gap-2 px-3 py-2 text-white" style={{ background: HEAD[ci % HEAD.length] }}>
              <p className="text-sm font-bold uppercase tracking-wide">{c.nama}</p>
              <span className="ml-auto text-[11px] opacity-90">{aktif.length} aktif{telat ? ` · ${telat} terlambat` : ""}</span>
            </header>
            {c.list.length === 0 ? <p className="px-3 py-4 text-center text-xs text-emerald-800/50">Tidak ada tugas.</p> : (
              <div className="max-h-[70vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-emerald-50 text-[10px] uppercase tracking-wide text-emerald-800/70">
                    <tr><th className="w-8 px-2 py-1.5 text-left">No</th><th className="px-2 text-left">To do list</th><th className="px-2 text-left">Status</th><th className="w-[84px] px-2 text-right">Deadline</th></tr>
                  </thead>
                  <tbody>
                    {c.list.map((t, i) => {
                      const selesai = t.status === "SELESAI";
                      const dl = (t.deadline || "").slice(0, 10);
                      const lewat = !selesai && /^\d{4}-/.test(dl) && dl < hariIni;
                      const dekat = !selesai && !lewat && /^\d{4}-/.test(dl) && dl <= tigaHari;
                      return (
                        <tr key={t.id} onClick={() => onEdit(t)} className={`cursor-pointer border-t border-emerald-50 hover:bg-emerald-50/50 ${selesai ? "opacity-50" : ""}`}>
                          <td className="px-2 py-1.5 tabular-nums text-emerald-800/60">{i + 1}</td>
                          <td className="max-w-0 px-2 py-1.5"><p className={`truncate text-emerald-950 ${selesai ? "line-through" : ""}`} title={t.nama}>{t.nama}</p></td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {t.konten_id
                              ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${kontenWarna(t.konten_status)}`}>{KONTEN_STATUS[t.konten_status] || t.konten_status}</span>
                              : <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${WARNA[t.status] || WARNA.BELUM_MULAI}`}>{STATUS[t.status] || t.status}</span>}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${lewat ? "bg-red-100 font-semibold text-red-700" : dekat ? "bg-amber-100 text-amber-900" : "text-emerald-900"}`}>{tgl(t.deadline)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <p className="text-[11px] text-emerald-800/60 md:col-span-2 2xl:col-span-3">Merah = lewat deadline · kuning = jatuh tempo ≤ 3 hari. Diurutkan per deadline; tugas selesai di bawah. Klik baris untuk membuka.</p>
    </div>
  );
}
