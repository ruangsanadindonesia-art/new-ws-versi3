export const WARNA_PILIHAN = [
  "#0f172a", "#64748b", "#eab308", "#78350f", "#a3e635",
  "#c084fc", "#a8a29e", "#1e3a8a", "#0c4a6e", "#94a3b8",
  "#84cc16", "#facc15", "#dc2626", "#312e81", "#059669",
  "#f472b6", "#06b6d4", "#f97316", "#57534e", "#10b981",
  "#fde68a", "#a855f7", "#f59e0b", "#3b82f6", "#fb923c",
  "#2563eb", "#7c3aed", "#22d3ee", "#ef4444", "#fb7185",
];

// Tugas Produksi Konten (1 konten = 1 tugas, status khusus per tipe konten)
export const KONTEN_JENIS = { REELS: "Reels / Video", CAROUSEL: "Carousel", SINGLE: "Single image", THREADS: "Threads", STORY: "IG Story", WA: "WA Channel" };
export const KONTEN_STATUS = { IDE: "Ide", SCRIPTING: "Scripting", SCRIPTED: "Scripted", SHOOTING: "Shooting", SHOOTED: "Shooted", EDITING: "Editing", DESIGN: "Design", DESIGNED: "Designed", REVIEW: "Review", REVISI: "Revisi", EDITED: "Edited", POSTING: "Posting", POSTED: "Posted", LAPORAN: "Laporan", SELESAI: "Selesai" };
export const kontenWarna = (s) => (s === "SELESAI" ? "bg-emerald-600 text-white" : s === "REVISI" ? "bg-red-600 text-white" : ["REVIEW", "DESIGNED"].includes(s) ? "bg-amber-100 text-amber-900"
  : ["POSTED", "LAPORAN"].includes(s) ? "bg-sky-100 text-sky-900" : s === "IDE" ? "bg-slate-100 text-slate-700" : "bg-violet-100 text-violet-900");
export function KontenStatus({ t }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${kontenWarna(t.konten_status)}`} data-testid={`konten-status-${t.id}`}>{KONTEN_STATUS[t.konten_status] || t.konten_status}</span>;
}

// Fixed system types (drives routing to Rutin Tracker)
export const TIPES = ["PROJECT", "HARIAN", "MINGGUAN", "BULANAN"];
export const KATEGORI_LABEL = {
  PROJECT: "Project (sekali/proyek)",
  HARIAN: "Rutin — Harian",
  MINGGUAN: "Rutin — Mingguan",
  BULANAN: "Rutin — Bulanan",
};

export function ColorPicker({ value, onChange }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-emerald-900">Pilih Warna</p>
      <div className="grid grid-cols-6 gap-1.5">
        {WARNA_PILIHAN.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`h-7 w-7 rounded transition ${value === c ? "ring-2 ring-emerald-900 ring-offset-1" : "hover:scale-110"}`}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}
