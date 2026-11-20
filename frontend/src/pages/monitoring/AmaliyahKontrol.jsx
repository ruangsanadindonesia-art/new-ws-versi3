import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, HeartHandshake, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatApiErr } from "@/lib/AuthContext";
import { monitoringAmaliyah } from "@/lib/api";

const warna = (p) => (p == null ? "text-emerald-800/30" : p >= 80 ? "text-emerald-700" : p >= 50 ? "text-amber-700" : "text-red-600");
const bar = (p) => (p == null ? "bg-slate-200" : p >= 80 ? "bg-emerald-500" : p >= 50 ? "bg-amber-400" : "bg-red-500");
const diamTeks = (o) => (o.terakhir == null ? "belum pernah check-in" : o.diam_hari === 0 ? "check-in hari ini" : o.diam_hari === 1 ? "terakhir kemarin" : `terakhir ${o.diam_hari} hari lalu`);

// Kontrol amaliyah seluruh tim: persentase pemenuhan (bukan isi harian). Hari haid tidak dihitung untuk item yang gugur.
export default function AmaliyahKontrol({ tim, isSpv }) {
  const [days, setDays] = useState(7);
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  const [hanyaPerhatian, setHanyaPerhatian] = useState(false);
  useEffect(() => {
    setD(null);
    monitoringAmaliyah({ days, ...(tim ? { divisi_id: tim } : {}) }).then(setD).catch((e) => toast.error(formatApiErr(e)));
  }, [days, tim]);
  const orang = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.orang.filter((o) => (!s || `${o.nama} ${o.tim_nama}`.toLowerCase().includes(s))
      && (!hanyaPerhatian || (o.pct ?? 0) < 50 || o.diam_hari == null || o.diam_hari >= 3));
  }, [d, q, hanyaPerhatian]);

  if (!d) return <div className="grid place-items-center rounded-xl border border-emerald-100 bg-white p-12"><Loader2 className="animate-spin text-emerald-800" size={24} /></div>;
  if (!d.ringkasan) return <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">Belum ada item amaliyah aktif.</div>;
  const r = d.ringkasan;
  const periode = `${new Date(`${d.start}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${new Date(`${d.end}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`;

  return (
    <div className="space-y-4" data-testid="amaliyah-kontrol">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-emerald-200 bg-white p-1">
          {[[7, "7 hari"], [30, "30 hari"]].map(([n, l]) => (
            <button key={n} onClick={() => setDays(n)} className={`rounded-md px-3 py-1 text-xs font-medium ${days === n ? "bg-emerald-900 text-white" : "text-emerald-800"}`} data-testid={`am-days-${n}`}>{l}</button>
          ))}
        </div>
        <span className="text-xs text-emerald-800/60">{periode}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-white p-3"><p className={`font-display text-2xl font-bold tabular-nums ${warna(r.pct)}`}>{r.pct ?? "—"}{r.pct != null && "%"}</p><p className="text-[11px] text-emerald-800/70">Rata-rata pemenuhan</p></div>
        <div className="rounded-xl border border-emerald-100 bg-white p-3"><p className="font-display text-2xl font-bold tabular-nums text-emerald-950">{r.orang}</p><p className="text-[11px] text-emerald-800/70">Orang dipantau</p></div>
        <button onClick={() => setHanyaPerhatian(!hanyaPerhatian)} className={`rounded-xl border p-3 text-left ${hanyaPerhatian ? "border-red-300 bg-red-50 ring-2 ring-red-200" : "border-red-100 bg-white"}`}>
          <p className="font-display text-2xl font-bold tabular-nums text-red-600">{r.di_bawah_50}</p><p className="text-[11px] text-emerald-800/70">Di bawah 50%</p></button>
        <button onClick={() => setHanyaPerhatian(!hanyaPerhatian)} className={`rounded-xl border p-3 text-left ${hanyaPerhatian ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200" : "border-amber-100 bg-white"}`}>
          <p className="font-display text-2xl font-bold tabular-nums text-amber-700">{r.diam_3}</p><p className="text-[11px] text-emerald-800/70">Tidak check-in ≥ 3 hari</p></button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-emerald-100 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-emerald-50 px-4 py-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-950"><HeartHandshake size={14} /> Per orang</p>
            <span className="text-[11px] text-emerald-800/60">{hanyaPerhatian ? "hanya yang perlu perhatian" : "terendah di atas"}</span>
            <div className="relative ml-auto w-44">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-700/60" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama…" className="h-8 bg-white pl-8 text-xs" />
            </div>
          </div>
          {orang.length === 0 ? <p className="px-4 py-6 text-center text-xs text-emerald-800/60">Tidak ada yang cocok.</p> : (
            <ul className="divide-y divide-emerald-50">
              {orang.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`am-orang-${o.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-emerald-950">{o.nama} <span className="text-xs font-normal text-emerald-800/50">· {o.tim_nama}</span></p>
                    <p className={`text-[11px] ${o.diam_hari == null || o.diam_hari >= 3 ? "font-medium text-amber-700" : "text-emerald-800/60"}`}>
                      {(o.diam_hari == null || o.diam_hari >= 3) && <AlertTriangle size={10} className="mb-0.5 mr-0.5 inline" />}{diamTeks(o)}
                      {o.checkin > 0 && o.item_lemah.length > 0 && <span className="text-emerald-800/60"> · lemah: {o.item_lemah.join(", ")}</span>}
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-50"><div className={`h-full ${bar(o.pct)}`} style={{ width: `${o.pct ?? 0}%` }} /></div>
                  </div>
                  <div className="w-16 shrink-0 text-right">
                    <p className={`font-display text-lg font-bold tabular-nums ${warna(o.pct)}`}>{o.pct ?? "—"}{o.pct != null && "%"}</p>
                    <p className="text-[10px] tabular-nums text-emerald-800/50">{o.checkin}/{o.target}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {isSpv && !tim && (
            <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
              <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">Per tim</p>
              <ul className="divide-y divide-emerald-50">
                {d.tim.map((t) => (
                  <li key={t.id || "x"} className="px-4 py-2">
                    <div className="flex items-baseline justify-between text-xs"><span className="font-medium text-emerald-950">{t.nama}</span><span className={`font-semibold tabular-nums ${warna(t.pct)}`}>{t.pct ?? "—"}{t.pct != null && "%"}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-50"><div className={`h-full ${bar(t.pct)}`} style={{ width: `${t.pct ?? 0}%` }} /></div>
                    <p className="mt-0.5 text-[10px] text-emerald-800/50">{t.orang} orang{t.perlu_perhatian ? ` · ${t.perlu_perhatian} perlu perhatian` : ""}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
            <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">Per amaliyah</p>
            <ul className="divide-y divide-emerald-50">
              {d.item.map((i) => (
                <li key={i.id} className="px-4 py-2">
                  <div className="flex items-baseline justify-between text-xs"><span className="text-emerald-950">{i.nama}</span><span className={`font-semibold tabular-nums ${warna(i.pct)}`}>{i.pct ?? "—"}{i.pct != null && "%"}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-50"><div className={`h-full ${bar(i.pct)}`} style={{ width: `${i.pct ?? 0}%` }} /></div>
                </li>
              ))}
            </ul>
            <p className="border-t border-emerald-50 px-4 py-1.5 text-[10px] text-emerald-800/50">Hijau ≥ 80% · kuning 50–79% · merah &lt; 50%. Hari haid tidak dihitung untuk item yang gugur. Isi harian tiap orang tetap privat.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
