import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatApiErr } from "@/lib/AuthContext";
import { sasaranEvaluasi, sasaranSaveEvaluasi, sasaranPdf } from "@/lib/api";
import { StatusPill, fmtAngka, STATUS } from "@/pages/sasaran/parts";

const KESIMPULAN = { NETRAL: "Netral", REWARD: "Layak apresiasi", EVALUASI: "Perlu evaluasi" };

export default function EvaluasiSasaran({ periodId, isSpv, divisiList }) {
  const [d, setD] = useState(null);
  const [n, setN] = useState({ summary: "", kesimpulan: "NETRAL", highlights: "", improvements: "", next_focus: "" });
  const [busy, setBusy] = useState("");
  const [divisi, setDivisi] = useState("");
  const load = async () => {
    try {
      const r = await sasaranEvaluasi(periodId); setD(r);
      const c = r.catatan || {};
      setN({ summary: c.summary || "", kesimpulan: c.kesimpulan || "NETRAL", highlights: (c.highlights || []).join("\n"),
        improvements: (c.improvements || []).join("\n"), next_focus: (c.next_focus || []).join("\n") });
    } catch (e) { toast.error(formatApiErr(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [periodId]);
  const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy("save");
    try { await sasaranSaveEvaluasi(periodId, { summary: n.summary, kesimpulan: n.kesimpulan, highlights: lines(n.highlights), improvements: lines(n.improvements), next_focus: lines(n.next_focus) }); toast.success("Catatan evaluasi disimpan"); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy("");
  };
  const unduh = async (jenis) => {
    setBusy(jenis);
    try {
      const blob = await sasaranPdf(jenis, periodId, jenis === "komitmen" ? divisi || undefined : undefined);
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `${jenis}-${(d?.period?.nama || "periode").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error("Gagal membuat PDF"); }
    setBusy("");
  };
  if (!d) return <p className="p-6 text-center text-sm text-emerald-800/60">Menyusun rekap…</p>;
  const st = d.stats || {};
  return (
    <div className="space-y-4" data-testid="evaluasi-sasaran">
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white p-3">
        <p className="mr-auto text-sm text-emerald-950">
          <b>{st.sasaran || 0}</b> objective · <b>{st.ukuran || 0}</b> key result: {st.sesuai || 0} on track, {st.perhatian || 0} at risk, {st.tertinggal || 0} off track, {st.belum_data || 0} no data.
        </p>
        <select value={divisi} onChange={(e) => setDivisi(e.target.value)} className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-xs" aria-label="Tim untuk PDF komitmen">
          <option value="">Komitmen: semua tim</option>
          {divisiList.map((x) => <option key={x.id} value={x.id}>Komitmen: {x.nama}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => unduh("komitmen")} disabled={!!busy} data-testid="pdf-komitmen">{busy === "komitmen" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF Komitmen</Button>
        <Button size="sm" variant="outline" onClick={() => unduh("evaluasi")} disabled={!!busy} data-testid="pdf-evaluasi">{busy === "evaluasi" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF Evaluasi</Button>
      </section>

      <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-emerald-50 text-left text-[11px] uppercase tracking-wider text-emerald-800/70">
            <tr><th className="px-3 py-2">Objective / Key Result</th><th className="px-3 py-2">PIC</th><th className="px-3 py-2 text-right">Baseline</th><th className="px-3 py-2 text-right">Realisasi</th><th className="px-3 py-2 text-right">Target</th><th className="px-3 py-2">Check-in</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {d.sasaran.map((s) => [
              <tr key={s.id} className="border-t border-emerald-100 bg-emerald-50/30">
                <td className="px-3 py-2 font-semibold text-emerald-950" colSpan={6}>{s.judul}<span className="ml-2 text-[11px] font-normal text-emerald-800/60">{s.level === "TIM" ? s.divisi?.nama : "Lembaga"}{s.tugas_summary.total ? ` · tugas ${s.tugas_summary.selesai}/${s.tugas_summary.total}` : ""}</span></td>
                <td className="px-3 py-2"><StatusPill status={s.status} small /></td>
              </tr>,
              ...s.ukuran.map((u) => (
                <tr key={u.id} className="border-t border-emerald-50 align-top">
                  <td className="px-3 py-2 pl-6 text-emerald-950">{u.nama}{u.catatan_terakhir ? <span className="block text-[11px] text-emerald-800/60">“{u.catatan_terakhir}”</span> : null}</td>
                  <td className="px-3 py-2 text-xs">{u.pic?.nama || "–"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{fmtAngka(u.awal, u.satuan)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtAngka(u.capaian, u.satuan)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{fmtAngka(u.target, u.satuan)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{u.jumlah_checkin || 0}×</td>
                  <td className="px-3 py-2"><StatusPill status={u.status} small /></td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>

      <section className="space-y-3 rounded-xl border border-emerald-100 bg-white p-4">
        <h3 className="font-display text-base font-semibold text-emerald-950">Catatan & kesimpulan {isSpv ? "" : "(diisi SPV)"}</h3>
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <div><label className="text-xs font-medium text-emerald-900" htmlFor="ev-kes">Kesimpulan periode</label>
            <select id="ev-kes" disabled={!isSpv} value={n.kesimpulan} onChange={(e) => setN({ ...n, kesimpulan: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm disabled:opacity-70">
              {Object.entries(KESIMPULAN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label className="text-xs font-medium text-emerald-900" htmlFor="ev-sum">Ringkasan</label>
            <Textarea id="ev-sum" rows={2} disabled={!isSpv} value={n.summary} onChange={(e) => setN({ ...n, summary: e.target.value })} placeholder="Ringkasan hasil periode untuk rapat evaluasi" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["highlights", "Yang berjalan baik"], ["improvements", "Yang perlu diperbaiki"], ["next_focus", "Fokus periode berikutnya"]].map(([k, l]) => (
            <div key={k}><label className="text-xs font-medium text-emerald-900" htmlFor={`ev-${k}`}>{l} <span className="font-normal text-emerald-800/50">(satu per baris)</span></label>
              <Textarea id={`ev-${k}`} rows={4} disabled={!isSpv} value={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.value })} /></div>
          ))}
        </div>
        {isSpv && <Button onClick={save} disabled={busy === "save"} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="ev-save"><Save size={14} /> Simpan catatan</Button>}
        <p className="text-[11px] text-emerald-800/60">Status mengikuti satu aturan: {Object.values(STATUS).map((x) => x.label).join(" · ")}. KR dengan baseline dinilai dari progres terhadap waktu; tanpa baseline, realisasi dibanding langsung dengan target.</p>
      </section>
    </div>
  );
}
