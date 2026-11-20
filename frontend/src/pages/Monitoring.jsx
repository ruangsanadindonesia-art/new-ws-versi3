import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Clock, Hourglass, Eye, Loader2, RefreshCw, Search, BellRing, CalendarPlus, X, Users2, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, formatApiErr } from "@/lib/AuthContext";
import { api, updateTask, taskAddComment } from "@/lib/api";

// Pusat Kendali: satu layar untuk memastikan tidak ada tugas tim yang terlambat.
const BUCKET = {
  TERLAMBAT: { label: "Terlambat", hint: "Lewat deadline, belum selesai", icon: AlertTriangle, tile: "border-red-200 bg-red-50 text-red-800", dot: "bg-red-500", bar: "bg-red-500" },
  HARI_INI: { label: "Jatuh tempo hari ini", hint: "Deadline hari ini", icon: CalendarClock, tile: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500", bar: "bg-amber-500" },
  SEGERA: { label: "≤ 3 hari lagi", hint: "Deadline 1–3 hari lagi", icon: Hourglass, tile: "border-yellow-200 bg-yellow-50 text-yellow-800", dot: "bg-yellow-400", bar: "bg-yellow-400" },
  REVIEW_LAMA: { label: "Review tertahan", hint: "Menunggu review A lebih dari 2 hari", icon: Eye, tile: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500", bar: "bg-violet-500" },
  MACET: { label: "Macet", hint: "Tidak ada perubahan 3 hari atau lebih", icon: Clock, tile: "border-slate-200 bg-slate-50 text-slate-700", dot: "bg-slate-400", bar: "bg-slate-400" },
  TANPA_DEADLINE: { label: "Tanpa deadline", hint: "Belum diberi deadline — sulit dipantau", icon: CircleDashed, tile: "border-emerald-100 bg-white text-emerald-800", dot: "bg-emerald-300", bar: "bg-emerald-300" },
};
const STATUS = { BELUM_MULAI: "Belum mulai", DALAM_PROSES: "Dikerjakan", MENUNGGU_REVIEW: "Menunggu review", REVISI: "Revisi", TERKENDALA: "Terkendala" };
const PRIO = { TINGGI: "bg-red-100 text-red-700", SEDANG: "bg-amber-100 text-amber-800", RENDAH: "bg-slate-100 text-slate-600" };

const waktuTeks = (i) => {
  if (i.bucket === "TERLAMBAT") return i.telat_hari ? `telat ${i.telat_hari} hari` : "telat hari ini";
  if (i.bucket === "HARI_INI") return i.deadline_jam ? `hari ini ${i.deadline_jam}` : "hari ini";
  if (i.bucket === "SEGERA") return i.sisa_hari === 1 ? "besok" : `${i.sisa_hari} hari lagi`;
  if (i.bucket === "MACET" || i.bucket === "REVIEW_LAMA") return `diam ${i.diam_hari} hari`;
  return "tanpa deadline";
};
const fmtTgl = (d, j) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + (j ? ` ${j}` : "") : "—");

export default function Monitoring() {
  const { user } = useAuth();
  const isSpv = user?.role === "spv";
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tim, setTim] = useState("");
  const [bucket, setBucket] = useState("");
  const [orang, setOrang] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState({});
  const [timList, setTimList] = useState([]); // ringkasan semua tim (dari muatan tanpa filter)

  const load = async (t = tim) => {
    setLoading(true);
    try {
      const r = (await api.get("/monitoring/kendali", { params: t ? { divisi_id: t } : {} })).data;
      setD(r); if (!t) setTimList(r.per_tim);
    }
    catch (e) { toast.error(formatApiErr(e)); }
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(tim); }, [tim]);

  const items = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.items.filter((i) => (!bucket || i.bucket === bucket) && (!orang || (i.r_id || "_") === orang)
      && (!s || `${i.nama} ${i.r_nama} ${i.tim_nama}`.toLowerCase().includes(s)));
  }, [d, bucket, orang, q]);
  const grouped = useMemo(() => Object.keys(BUCKET).map((k) => ({ k, list: items.filter((i) => i.bucket === k) })).filter((g) => g.list.length), [items]);

  const ingatkan = async (i) => {
    setBusy((b) => ({ ...b, [i.id]: "ingat" }));
    const ket = i.bucket === "TERLAMBAT" ? `sudah ${waktuTeks(i)}` : i.bucket === "MACET" ? `belum ada perkembangan ${i.diam_hari} hari` : i.bucket === "REVIEW_LAMA" ? `menunggu review ${i.diam_hari} hari` : `deadline ${waktuTeks(i)}`;
    try {
      await taskAddComment(i.id, `Pengingat dari ${user?.name || "SPV"}: tugas ini ${ket}. Mohon perbarui status hari ini, atau sampaikan kendala/perpanjangan yang dibutuhkan.`);
      toast.success(`Pengingat terkirim ke ${i.r_nama}`);
    } catch (e) { toast.error(formatApiErr(e)); }
    setBusy((b) => ({ ...b, [i.id]: null }));
  };
  const undur = async (i, hari) => {
    setBusy((b) => ({ ...b, [i.id]: "undur" }));
    const base = new Date(`${i.bucket === "TERLAMBAT" || !i.deadline ? new Date().toISOString().slice(0, 10) : i.deadline}T00:00:00`);
    base.setDate(base.getDate() + hari);
    const baru = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    try { await updateTask(i.id, { deadline: baru }); toast.success(`Deadline "${i.nama}" menjadi ${fmtTgl(baru)}`); load(); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy((b) => ({ ...b, [i.id]: null }));
  };

  if (!d) return <div className="grid place-items-center rounded-xl border border-emerald-100 bg-white p-12"><Loader2 className="animate-spin text-emerald-800" size={24} /></div>;
  const sm = d.summary;
  const butuh = sm.TERLAMBAT + sm.HARI_INI;
  const orangNama = orang ? d.per_orang.find((o) => o.id === orang)?.nama : "";

  return (
    <div className="space-y-4" data-testid="pusat-kendali">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-emerald-950">Pusat Kendali Tugas</h3>
          <p className="text-xs text-emerald-800/70">
            {butuh ? <><b className="text-red-700">{butuh} tugas</b> butuh tindakan hari ini.</> : "Tidak ada tugas terlambat atau jatuh tempo hari ini."}
            {" "}Diperbarui {new Date(d.dihitung_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={loading} className="h-8 text-xs" data-testid="kendali-refresh">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Muat ulang
        </Button>
      </div>

      {isSpv && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" data-testid="kendali-tim">
          {[{ id: "", nama: "Semua tim" }, ...timList].map((t) => (
            <button key={t.id || "all"} onClick={() => { setTim(t.id); setOrang(""); }}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${tim === t.id ? "border-emerald-900 bg-emerald-900 text-white" : "border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50"}`}>
              {t.nama}{t.terlambat ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{t.terlambat}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(BUCKET).map(([k, b]) => {
          const Icon = b.icon; const on = bucket === k;
          return (
            <button key={k} onClick={() => setBucket(on ? "" : k)} title={b.hint} data-testid={`tile-${k}`}
              className={`rounded-xl border p-3 text-left transition ${b.tile} ${on ? "ring-2 ring-emerald-900 ring-offset-1" : "hover:shadow-sm"} ${sm[k] === 0 ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between"><Icon size={15} /><span className="font-display text-2xl font-bold tabular-nums">{sm[k]}</span></div>
              <p className="mt-1 text-[11px] font-medium leading-tight">{b.label}</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Daftar perlu tindakan */}
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700/60" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari tugas, orang, tim…" className="h-9 bg-white pl-9" data-testid="kendali-cari" />
            </div>
            {(bucket || orang) && (
              <button onClick={() => { setBucket(""); setOrang(""); }} className="inline-flex items-center gap-1 rounded-full bg-emerald-900 px-3 py-1 text-xs text-white">
                {[bucket && BUCKET[bucket].label, orangNama].filter(Boolean).join(" · ")} <X size={12} />
              </button>
            )}
          </div>
          {grouped.length === 0 && (
            <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">
              Tidak ada tugas yang perlu tindakan{bucket || orang || q ? " untuk filter ini" : ". Alhamdulillah, semua terkendali"}.
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.k} className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
              <div className="flex items-center gap-2 border-b border-emerald-50 px-4 py-2">
                <span className={`h-2 w-2 rounded-full ${BUCKET[g.k].dot}`} />
                <p className="text-sm font-semibold text-emerald-950">{BUCKET[g.k].label}</p>
                <span className="text-xs text-emerald-800/60">{g.list.length} tugas · {BUCKET[g.k].hint}</span>
              </div>
              <ul className="divide-y divide-emerald-50">
                {g.list.map((i) => (
                  <li key={i.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center" data-testid={`kendali-item-${i.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-emerald-950" title={i.nama}>
                        {i.prioritas && <span className={`mr-1.5 rounded px-1.5 py-px text-[10px] font-semibold ${PRIO[i.prioritas]}`}>{i.prioritas[0] + i.prioritas.slice(1).toLowerCase()}</span>}
                        {i.nama}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-emerald-800/70">
                        <button onClick={() => setOrang(i.r_id || "_")} className="font-medium text-emerald-900 hover:underline">{i.r_nama}</button>
                        <span>· {i.tim_nama}</span><span>· {STATUS[i.status] || i.status}</span>
                        {i.a_nama && i.a_nama !== i.r_nama && <span>· penyetuju {i.a_nama}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className={`text-xs font-semibold ${g.k === "TERLAMBAT" ? "text-red-700" : g.k === "HARI_INI" ? "text-amber-700" : "text-emerald-900"}`}>{waktuTeks(i)}</p>
                        <p className="text-[10px] text-emerald-800/50">{fmtTgl(i.deadline, i.deadline_jam)}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={!!busy[i.id] || !i.r_id} onClick={() => ingatkan(i)} title="Kirim komentar pengingat ke yang mengerjakan" className="h-8 px-2 text-xs" data-testid={`ingatkan-${i.id}`}>
                        {busy[i.id] === "ingat" ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}<span className="hidden sm:inline">Ingatkan</span>
                      </Button>
                      {isSpv && (
                        <Button size="sm" variant="ghost" disabled={!!busy[i.id]} onClick={() => undur(i, g.k === "TANPA_DEADLINE" ? 3 : 2)} title={g.k === "TANPA_DEADLINE" ? "Beri deadline 3 hari dari sekarang" : "Undur deadline 2 hari"} className="h-8 px-2 text-xs text-emerald-800" data-testid={`undur-${i.id}`}>
                          <CalendarPlus size={13} /><span className="hidden sm:inline">{g.k === "TANPA_DEADLINE" ? "Beri +3h" : "+2 hari"}</span>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Panel kanan: per tim & per orang */}
        <aside className="space-y-4">
          {isSpv && !tim && (
            <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white" data-testid="kendali-per-tim">
              <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">Per tim</p>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-emerald-800/50">
                  <tr><th className="px-4 py-1.5 text-left font-medium">Tim</th><th className="px-1 text-right font-medium">Aktif</th><th className="px-1 text-right font-medium">Telat</th><th className="px-1 text-right font-medium">≤3h</th><th className="px-4 text-right font-medium" title="Tugas jatuh tempo 30 hari terakhir yang selesai tepat waktu">Tepat</th></tr>
                </thead>
                <tbody>
                  {d.per_tim.map((t) => (
                    <tr key={t.id} onClick={() => setTim(t.id)} className="cursor-pointer border-t border-emerald-50 hover:bg-emerald-50/50">
                      <td className="px-4 py-2"><p className="font-medium text-emerald-950">{t.nama}</p><p className="text-[10px] text-emerald-800/50">{t.kepala ? `Kepala: ${t.kepala}` : "Belum ada kepala tim"}</p></td>
                      <td className="px-1 text-right tabular-nums">{t.aktif}</td>
                      <td className={`px-1 text-right font-semibold tabular-nums ${t.terlambat ? "text-red-600" : "text-emerald-800/40"}`}>{t.terlambat}</td>
                      <td className={`px-1 text-right tabular-nums ${t.segera + t.hari_ini ? "text-amber-700" : "text-emerald-800/40"}`}>{t.segera + t.hari_ini}</td>
                      <td className={`px-4 text-right tabular-nums ${t.tepat_waktu_pct == null ? "text-emerald-800/30" : t.tepat_waktu_pct >= 80 ? "text-emerald-700" : t.tepat_waktu_pct >= 60 ? "text-amber-700" : "text-red-600"}`}>{t.tepat_waktu_pct == null ? "—" : `${t.tepat_waktu_pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-emerald-50 px-4 py-1.5 text-[10px] text-emerald-800/50">Tepat = tugas yang jatuh tempo 30 hari terakhir dan selesai tepat waktu. Sehat ≥ 80%.</p>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white" data-testid="kendali-per-orang">
            <p className="flex items-center gap-1.5 border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950"><Users2 size={14} /> Beban per orang</p>
            {d.per_orang.length === 0 ? <p className="px-4 py-3 text-xs text-emerald-800/60">Tidak ada tugas aktif.</p> : (
              <ul className="max-h-[420px] divide-y divide-emerald-50 overflow-y-auto">
                {d.per_orang.map((o) => {
                  const max = Math.max(...d.per_orang.map((x) => x.aktif), 1);
                  return (
                    <li key={o.id}>
                      <button onClick={() => setOrang(orang === o.id ? "" : o.id)} className={`w-full px-4 py-2 text-left hover:bg-emerald-50/50 ${orang === o.id ? "bg-emerald-50" : ""}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-medium text-emerald-950">{o.nama} <span className="font-normal text-emerald-800/50">· {o.tim_nama}</span></span>
                          <span className="shrink-0 text-[11px] tabular-nums text-emerald-800/70">{o.aktif} aktif{o.terlambat ? <b className="ml-1 text-red-600">{o.terlambat} telat</b> : null}</span>
                        </div>
                        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-emerald-50">
                          <div className="bg-red-500" style={{ width: `${(o.terlambat / max) * 100}%` }} />
                          <div className="bg-amber-400" style={{ width: `${(o.segera / max) * 100}%` }} />
                          <div className="bg-emerald-400" style={{ width: `${((o.aktif - o.terlambat - o.segera) / max) * 100}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-emerald-50 px-4 py-1.5 text-[10px] text-emerald-800/50">Merah = terlambat · kuning = ≤3 hari · hijau = aman. Klik nama untuk memfilter.</p>
          </section>

          <section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 text-[11px] leading-relaxed text-emerald-900/80">
            <p className="mb-1 font-semibold text-emerald-950">Rutinitas kontrol harian (5 menit)</p>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>Kosongkan kotak <b>Terlambat</b>: ingatkan, atau setujui perpanjangan.</li>
              <li>Cek <b>Jatuh tempo hari ini</b> sebelum jam 12.00.</li>
              <li><b>Review tertahan</b>: tegur penyetuju (A), bukan pengerjanya.</li>
              <li><b>Macet</b> 3 hari: tanyakan kendalanya.</li>
              <li><b>Tanpa deadline</b>: beri deadline agar bisa dipantau.</li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
