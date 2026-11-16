// Tab halaman sederhana (dipakai Harian Saya, Laporan, Pengaturan)
export function PageTabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-emerald-100 bg-white p-1.5" role="tablist" data-testid="page-tabs">
      {tabs.map((t) => (
        <button key={t.k} role="tab" aria-selected={value === t.k} onClick={() => onChange(t.k)} data-testid={`tab-${t.k}`}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === t.k ? "bg-emerald-900 text-white" : "text-emerald-900 hover:bg-emerald-50"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
