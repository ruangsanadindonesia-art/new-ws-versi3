import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatApiErr } from "@/lib/AuthContext";
import { sasaranPapan, sasaranSyncMetrik } from "@/lib/api";
import { StatusPill, InfoTip, JenisTag, OtomatisTag, fmtAngka, sinceText, ARAH } from "@/pages/sasaran/parts";

const FILTER = [
  { k: "semua", label: "Semua" },
  { k: "merah", label: "Perlu dibahas" },
  { k: "saya", label: "Milik saya" },
  { k: "checkin", label: "Belum check-in" },
];

// Sparkline 13 pekan: titik terakhir = minggu ini. Garis putus-putus = target.
function Spark({ tren, target, arah }) {
  const pts = tren.map((t, i) => [i, t.nilai]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return <span className="text-[10px] text-emerald-800/40">{pts.length ? "1 data" : "–"}</span>;
  const vals = [...pts.map(([, v]) => v), ...(target != null ? [target] : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 96, H = 26, x = (i) => (i / (tren.length - 1)) * W, y = (v) => H - 2 - ((v - lo) / span) * (H - 4);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [li, lv] = pts[pts.length - 1], [, pv] = pts[pts.length - 2];
  const naik = lv > pv, baik = arah === "TURUN" ? lv <= pv : lv >= pv;
  return (
    <svg width={W} height={H} className="overflow-visible" aria-label={`Tren ${naik ? "naik" : "turun"}`}>
      {target != null && <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="currentColor" strokeDasharray="2 2" className="text-emerald-800/25" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-700" />
      <circle cx={x(li)} cy={y(lv)} r="2.5" className={baik ? "fill-emerald-600" : "fill-red-500"} />
    </svg>
  );
}

function Delta({ now, prev, arah, satuan }) {
  if (now == null || prev == null) return <span className="text-emerald-800/40">–</span>;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <span className="text-emerald-800/60">0</span>;
  const baik = arah === "TURUN" ? d < 0 : d > 0;
  return <span className={baik ? "text-emerald-700" : "text-red-600"}>{d > 0 ? "+" : ""}{fmtAngka(d, satuan === "%" ? "%" : "")}</span>;
}

export default function PapanSkor({ periodId, me, onCheckin, reloadKey }) {
  const [d, setD] = useState(null);
  const [filter, setFilter] = useState("semua");
  const [syncing, setSyncing] = useState(false);
  const load = () => sasaranPapan(periodId).then(setD).catch((e) => toast.error(formatApiErr(e)));
  // eslint-disable-next-line
  useEffect(() => { load(); }, [periodId, reloadKey]);

  const canCheckin = (r) => !!d && (d.is_spv || (me && (r.pic_id === me || r.pj_id === me)) || (d.head_divisi_id && r.divisi_id === d.head_divisi_id));
  const rows = useMemo(() => {
    if (!d) return [];
    let r = d.baris;
    if (filter === "merah") r = r.filter((x) => x.status === "TERTINGGAL" || x.status === "PERHATIAN");
    if (filter === "saya") r = r.filter((x) => me && (x.pic_id === me || x.pj_id === me));
    if (filter === "checkin") r = r.filter((x) => x.perlu_update);
    return r;
  }, [d, filter, me]);
  const groups = useMemo(() => {
    const g = [];
    rows.forEach((r) => { let x = g.find((y) => y.id === r.sasaran_id); if (!x) g.push(x = { id: r.sasaran_id, judul: r.sasaran_judul, tim: r.tim, level: r.sasaran_level, list: [] }); x.list.push(r); });
    g.forEach((x) => x.list.sort((a, b) => (a.jenis === "LEAD") - (b.jenis === "LEAD")));
    return g;
  }, [rows]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await sasaranSyncMetrik();
      if (r.ok === false) toast.error(`Gagal mengambil data Dashboard: ${r.error || "tidak diketahui"}`);
      else { toast.success(`Data Dashboard diperbarui · ${r.metrik} angka, ${r.kr_diperbarui} ukuran otomatis`); load(); }
    }
    catch (e) { toast.error(formatApiErr(e)); }
    setSyncing(false);
  };

  if (!d) return <p className="p-6 text-center text-sm text-emerald-800/60">Memuat papan skor…</p>;
  const cnt = (st) => d.baris.filter((x) => x.status === st).length;
  const sk = d.sinkron_terakhir;

  return (
    <div className="space-y-3" data-testid="papan-skor">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["SESUAI", "On track"], ["PERHATIAN", "At risk"], ["TERTINGGAL", "Off track"], ["BELUM_ADA_DATA", "No data"]].map(([k, l]) => (
          <div key={k} className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
            <p className="text-2xl font-semibold tabular-nums text-emerald-950">{cnt(k)}</p>
            <StatusPill status={k} small /><span className="sr-only">{l}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-emerald-100 bg-white p-0.5">
          {FILTER.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)} data-testid={`papan-f-${f.k}`}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${filter === f.k ? "bg-emerald-800 text-white" : "text-emerald-900 hover:bg-emerald-50"}`}>{f.label}</button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-800/70" data-testid="sync-info">
          <Zap size={11} className="text-amber-600" /> Data Dashboard: {sk ? `${sinceText(sk.at)} (data per ${sk.data_per || "-"})` : "belum pernah sinkron"} <InfoTip k="OTOMATIS" />
        </span>
        {d.is_spv && <Button size="sm" variant="outline" onClick={sync} disabled={syncing} data-testid="sync-btn" className="h-8 text-xs">
          {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Ambil data sekarang</Button>}
      </div>

      <p className="text-[11px] text-emerald-800/70">
        Cara membaca: <JenisTag jenis="LAG" /> = hasil yang dikejar <InfoTip k="LAG" />, <JenisTag jenis="LEAD" /> = kegiatan pekanan pendorongnya <InfoTip k="LEAD" />.
        Δ = perubahan sejak pekan lalu (hijau = membaik). Garis tren 13 pekan, putus-putus = target.
      </p>

      {groups.length === 0 && <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-emerald-800/70">Tidak ada ukuran untuk filter ini.</p>}
      {groups.map((g) => (
        <section key={g.id} className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
          <h3 className="border-b border-emerald-50 bg-emerald-50/40 px-3 py-2 text-sm font-semibold text-emerald-950">
            {g.judul} <span className="font-normal text-emerald-800/60">· {g.level === "TIM" ? `Tim ${g.tim || ""}` : "Lembaga"}</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-emerald-800/60">
                <tr className="text-left">
                  <th className="px-3 py-1.5 font-medium">Ukuran · PIC</th>
                  <th className="px-2 py-1.5 text-right font-medium">Target</th>
                  <th className="px-2 py-1.5 text-right font-medium">Pekan lalu</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sekarang</th>
                  <th className="px-2 py-1.5 text-right font-medium">Δ</th>
                  <th className="px-2 py-1.5 font-medium">Tren</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {g.list.map((r) => (
                  <tr key={r.id} className="border-t border-emerald-50 align-middle" data-testid={`papan-row-${r.id}`}>
                    <td className="px-3 py-2">
                      <p className="text-emerald-950"><JenisTag jenis={r.jenis} />{r.sumber && <OtomatisTag />}{r.nama}</p>
                      <p className="text-[11px] text-emerald-800/60">{ARAH[r.arah] || "Naik ↑"} · PIC {r.pic?.nama || <b className="text-amber-700">belum ada</b>}
                        {r.catatan_terakhir ? <> · “{r.catatan_terakhir.slice(0, 70)}”</> : null}</p>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-800/80">{fmtAngka(r.target, r.satuan)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-800/80">{fmtAngka(r.pekan_lalu, r.satuan)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-950">{fmtAngka(r.capaian, r.satuan)}</td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums"><Delta now={r.capaian} prev={r.pekan_lalu} arah={r.arah} satuan={r.satuan} /></td>
                    <td className="px-2 py-2"><Spark tren={r.tren} target={r.target} arah={r.arah} /></td>
                    <td className="px-2 py-2"><StatusPill status={r.status} small /></td>
                    <td className="px-3 py-2 text-right">
                      {canCheckin(r) && <Button size="sm" variant={r.perlu_update ? "default" : "outline"} onClick={() => onCheckin(r)} data-testid={`papan-ck-${r.id}`}
                        className={`h-7 px-2.5 text-xs ${r.perlu_update ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}`}>Check-in</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
