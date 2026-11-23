import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload, Settings2, ChevronLeft, ChevronRight, LayoutGrid, CalendarDays, List, Loader2, AlertTriangle, ExternalLink, Check, Search, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { formatApiErr } from "@/lib/AuthContext";
import { api, listAnggota } from "@/lib/api";

const K = {
  meta: () => api.get("/konten/meta").then((r) => r.data),
  list: (p) => api.get("/konten", { params: p }).then((r) => r.data),
  buat: (p) => api.post("/konten", p).then((r) => r.data),
  ubah: (id, p) => api.put(`/konten/${id}`, p).then((r) => r.data),
  tashih: (id, p) => api.post(`/konten/${id}/tashih`, p).then((r) => r.data),
  batal: (id) => api.post(`/konten/${id}/batal`).then((r) => r.data),
  atur: (p) => api.put("/konten/pengaturan/tahap", p).then((r) => r.data),
  pratinjau: (t) => api.get("/konten/jadwal/pratinjau", { params: { tanggal_tayang: t } }).then((r) => r.data),
  performa: (id, p) => api.put(`/konten/${id}/performa`, p).then((r) => r.data),
  rekap: (p) => api.get("/konten/rekap/performa", { params: p }).then((r) => r.data),
  impor: (fd) => api.post("/konten/impor/csv", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data),
};
const KOLOM = ["NASKAH", "TASHIH", "PRODUKSI", "APPROVAL", "POSTING", "LAPORAN", "SELESAI"];
const KOLOM_LABEL = { NASKAH: "Naskah", TASHIH: "Tashih guru", PRODUKSI: "Produksi & edit", APPROVAL: "Approval", POSTING: "Posting", LAPORAN: "Laporan 72 jam", SELESAI: "Selesai" };
const PLAT = { IG: "IG", TIKTOK: "TikTok", SHORT: "Short", YT: "YouTube" };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tglPendek = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" }) : "—");

function Titik({ tahapan }) {
  return (
    <div className="flex gap-0.5" aria-label="Progres tahap">
      {tahapan.map((t) => (
        <span key={t.tahap} title={`${t.label}: ${t.selesai ? "selesai" : t.telat ? "terlambat" : "belum"} · ${t.pic_nama || "-"} · ${t.deadline || ""}`}
          className={`h-1.5 flex-1 rounded-full ${t.selesai ? "bg-emerald-500" : t.telat ? "bg-red-500" : "bg-emerald-100"}`} />
      ))}
    </div>
  );
}

function Kartu({ k, onBuka }) {
  const kini = k.tahapan.find((t) => t.tahap === k.tahap);
  return (
    <button onClick={() => onBuka(k)} className={`w-full rounded-lg border bg-white p-2.5 text-left shadow-sm hover:border-emerald-300 ${k.terlambat ? "border-red-200" : "border-emerald-100"}`} data-testid={`konten-${k.kode}`}>
      <div className="flex items-center justify-between gap-2 text-[10px] text-emerald-800/60">
        <span className="font-mono">{k.kode}</span>
        <span className={k.terlambat ? "font-semibold text-red-600" : ""}>{k.terlambat && <AlertTriangle size={10} className="mb-0.5 mr-0.5 inline" />}tayang {tglPendek(k.tanggal_tayang)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-emerald-950">{k.judul}</p>
      <div className="mt-1.5"><Titik tahapan={k.tahapan} /></div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
        {(k.platforms || []).map((p) => <span key={p} className={`rounded px-1.5 py-px ${k.links?.[p] ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{PLAT[p]}</span>)}
        {kini && <span className="ml-auto text-emerald-800/70">{kini.pic_nama || "-"}</span>}
      </div>
    </button>
  );
}

export default function Konten() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem("ws_konten_view") || "pipeline"; } catch { return "pipeline"; } });
  const [bulan, setBulan] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [arsip, setArsip] = useState(false);
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(null);
  const [dlg, setDlg] = useState(null); // baru | impor | atur
  const [anggota, setAnggota] = useState([]);

  const pilihView = (v) => { setView(v); try { localStorage.setItem("ws_konten_view", v); } catch { /* abaikan */ } };
  const load = async () => {
    try {
      const params = view === "kalender"
        ? { dari: ymd(bulan), sampai: ymd(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 0)), arsip: true }
        : { arsip: view === "daftar" ? arsip : false };
      setRows(await K.list(params));
    } catch (e) { toast.error(formatApiErr(e)); setRows([]); }
  };
  useEffect(() => { K.meta().then(setMeta).catch((e) => toast.error(formatApiErr(e))); listAnggota().then(setAnggota).catch(() => {}); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === "performa") return; setRows(null); load(); }, [view, bulan, arsip]);
  const segar = (k) => { if (k) setBuka(k); load(); };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((k) => !s || `${k.kode} ${k.judul} ${k.pilar}`.toLowerCase().includes(s));
  }, [rows, q]);
  const telat = (rows || []).filter((k) => k.terlambat).length;

  if (!meta) return <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>;

  return (
    <div className="space-y-4" data-testid="konten-page">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-emerald-950">Produksi Konten</h3>
          <p className="text-xs text-emerald-800/70">Satu konten = satu kartu. Tiap tahap otomatis jadi tugas PIC dengan deadline mundur dari tanggal tayang.
            {telat > 0 && <b className="ml-1 text-red-600">{telat} konten terlambat.</b>}</p>
        </div>
        {meta.bisa_kelola && <>
          <Button size="sm" variant="outline" onClick={() => setDlg("atur")} className="h-8 text-xs" data-testid="konten-atur"><Settings2 size={13} /> Tahap & PIC</Button>
          <Button size="sm" variant="outline" onClick={() => setDlg("impor")} className="h-8 text-xs" data-testid="konten-impor"><Upload size={13} /> Impor CSV</Button>
          <Button size="sm" onClick={() => setDlg("baru")} className="h-8 bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="konten-baru"><Plus size={13} /> Konten baru</Button>
        </>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-emerald-200 bg-white p-1">
          {[["pipeline", "Pipeline", LayoutGrid], ["kalender", "Kalender", CalendarDays], ["daftar", "Daftar", List], ["performa", "Performa", BarChart3]].map(([k, l, I]) => (
            <button key={k} onClick={() => pilihView(k)} data-testid={`konten-view-${k}`}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === k ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><I size={13} /> {l}</button>
          ))}
        </div>
        {(view === "kalender" || view === "performa") && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setBulan(new Date(bulan.getFullYear(), bulan.getMonth() - 1, 1))}><ChevronLeft size={14} /></Button>
            <span className="min-w-[120px] text-center text-sm font-semibold text-emerald-950">{bulan.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setBulan(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 1))}><ChevronRight size={14} /></Button>
          </div>
        )}
        {view === "daftar" && <label className="flex items-center gap-1.5 text-xs text-emerald-900"><input type="checkbox" checked={arsip} onChange={(e) => setArsip(e.target.checked)} /> Tampilkan arsip</label>}
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-700/60" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, judul, pilar…" className="h-8 bg-white pl-8 text-xs" />
        </div>
      </div>

      {view === "performa" ? <Performa bulan={bulan} onBuka={(x) => api.get(`/konten/${x.id}`).then((r) => setBuka(r.data)).catch((e) => toast.error(formatApiErr(e)))} />
        : rows === null ? <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>
        : view === "pipeline" ? <Pipeline rows={filtered} onBuka={setBuka} />
        : view === "kalender" ? <Kalender rows={filtered} bulan={bulan} onBuka={setBuka} />
        : <Daftar rows={filtered} onBuka={setBuka} />}

      <DetailKonten k={buka} meta={meta} onClose={() => setBuka(null)} onSaved={segar} />
      {dlg === "baru" && <BaruDialog meta={meta} onClose={() => setDlg(null)} onSaved={(k) => { setDlg(null); segar(k); }} />}
      {dlg === "impor" && <ImporDialog onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}
      {dlg === "atur" && <AturDialog meta={meta} anggota={anggota.filter((a) => !meta.divisi_id || a.divisi_id === meta.divisi_id)} onClose={() => setDlg(null)} onSaved={(m) => { setMeta(m); setDlg(null); }} />}
    </div>
  );
}

function Pipeline({ rows, onBuka }) {
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2" data-testid="konten-pipeline">
      {KOLOM.map((c) => {
        const list = rows.filter((k) => k.tahap === c);
        return (
          <section key={c} className="flex w-[78vw] shrink-0 snap-start flex-col rounded-xl border border-emerald-100 bg-emerald-50/40 sm:w-64">
            <header className="flex items-center gap-2 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-950">{KOLOM_LABEL[c]}</p>
              {list.some((k) => k.terlambat) && <span className="h-2 w-2 rounded-full bg-red-500" title="Ada yang terlambat" />}
              <span className="ml-auto rounded-full bg-white px-2 text-xs tabular-nums text-emerald-800">{list.length}</span>
            </header>
            <div className="flex max-h-[65vh] min-h-[80px] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {list.length === 0 ? <p className="py-3 text-center text-[11px] text-emerald-800/40">Kosong</p> : list.map((k) => <Kartu key={k.id} k={k} onBuka={onBuka} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Kalender({ rows, bulan, onBuka }) {
  const y = bulan.getFullYear(), m = bulan.getMonth();
  const awal = (new Date(y, m, 1).getDay() + 6) % 7; // Senin = 0
  const n = new Date(y, m + 1, 0).getDate();
  const sel = [...Array(awal).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  const hariIni = ymd(new Date());
  return (
    <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white" data-testid="konten-kalender">
      <div className="grid min-w-[720px] grid-cols-7">
        {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Ahad"].map((h) => <div key={h} className="border-b border-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800/70">{h}</div>)}
        {sel.map((d, i) => {
          const t = d ? ymd(new Date(y, m, d)) : null;
          const isi = t ? rows.filter((k) => k.tanggal_tayang === t) : [];
          return (
            <div key={i} className={`min-h-[96px] border-b border-r border-emerald-50 p-1 ${t === hariIni ? "bg-emerald-50/60" : ""}`}>
              {d && <p className={`mb-1 text-[11px] font-semibold ${t === hariIni ? "text-emerald-900" : "text-emerald-800/50"}`}>{d}</p>}
              <div className="space-y-1">
                {isi.map((k) => (
                  <button key={k.id} onClick={() => onBuka(k)} title={`${k.kode} · ${k.tahap_label}`}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${k.tahap === "ARSIP" || k.tahap === "SELESAI" ? "bg-emerald-100 text-emerald-900" : k.terlambat ? "bg-red-100 text-red-800" : "bg-amber-50 text-amber-900"}`}>
                    {k.judul}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Daftar({ rows, onBuka }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white" data-testid="konten-daftar">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-emerald-50/60 text-left text-[11px] uppercase tracking-wide text-emerald-800/70">
          <tr><th className="px-3 py-2">Kode</th><th className="px-3 py-2">Judul</th><th className="px-3 py-2">Tayang</th><th className="px-3 py-2">Tahap</th><th className="px-3 py-2">Progres</th><th className="px-3 py-2">Pilar · Format</th><th className="px-3 py-2">Platform</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-emerald-800/60">Belum ada konten.</td></tr>}
          {rows.map((k) => (
            <tr key={k.id} onClick={() => onBuka(k)} className="cursor-pointer border-t border-emerald-50 hover:bg-emerald-50/40">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-emerald-800/70">{k.kode}</td>
              <td className="max-w-[280px] truncate px-3 py-2 font-medium text-emerald-950">{k.judul}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{tglPendek(k.tanggal_tayang)}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-xs ${k.terlambat ? "font-semibold text-red-600" : "text-emerald-900"}`}>{k.tahap_label}</td>
              <td className="w-28 px-3 py-2">{k.tahapan.length ? <Titik tahapan={k.tahapan} /> : <span className="text-[10px] text-emerald-800/40">arsip</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-800/70">{[k.pilar, k.format].filter(Boolean).join(" · ") || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{(k.platforms || []).map((p) => PLAT[p]).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormFields({ f, setF, meta }) {
  const togglePlat = (p) => setF({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] });
  return (
    <div className="space-y-3">
      <div><label className="text-xs font-medium" htmlFor="kt-judul">Judul / topik</label><Input id="kt-judul" value={f.judul} onChange={(e) => setF({ ...f, judul: e.target.value })} placeholder="mis. 9 Hukum Idgham" data-testid="kt-judul" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs font-medium" htmlFor="kt-tgl">Tanggal tayang</label><Input id="kt-tgl" type="date" value={f.tanggal_tayang} onChange={(e) => setF({ ...f, tanggal_tayang: e.target.value })} className="bg-white" data-testid="kt-tgl" /></div>
        <div><label className="text-xs font-medium" htmlFor="kt-format">Format</label>
          <select id="kt-format" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
            {["", "Reels", "Carousel", "Single post", "Video panjang", "Story"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}
          </select></div>
      </div>
      <div><p className="text-xs font-medium">Platform</p>
        <div className="mt-1 flex flex-wrap gap-1.5">{Object.entries(meta.platform).map(([k, l]) => (
          <button key={k} type="button" onClick={() => togglePlat(k)} className={`rounded-full border px-3 py-1 text-xs ${f.platforms.includes(k) ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900"}`}>{l}</button>
        ))}</div></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-xs font-medium" htmlFor="kt-pilar">Pilar</label><Input id="kt-pilar" value={f.pilar} onChange={(e) => setF({ ...f, pilar: e.target.value })} placeholder="Tahsin" /></div>
        <div><label className="text-xs font-medium" htmlFor="kt-bucket">Bucket</label>
          <select id="kt-bucket" value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">{["", "VALUE", "HUMAN", "SELL"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}</select></div>
        <div><label className="text-xs font-medium" htmlFor="kt-funnel">Funnel</label>
          <select id="kt-funnel" value={f.funnel} onChange={(e) => setF({ ...f, funnel: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">{["", "Awareness", "Consideration", "Conversion"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs font-medium" htmlFor="kt-cta">Kata kunci CTA</label><Input id="kt-cta" value={f.cta_keyword} onChange={(e) => setF({ ...f, cta_keyword: e.target.value.toUpperCase() })} placeholder="SANAD / AQU" /></div>
        <div><label className="text-xs font-medium" htmlFor="kt-naskah">Link naskah</label><Input id="kt-naskah" value={f.naskah_url} onChange={(e) => setF({ ...f, naskah_url: e.target.value })} placeholder="https://docs.google.com/…" /></div>
      </div>
      <div><label className="text-xs font-medium" htmlFor="kt-brief">Brief singkat</label><Textarea id="kt-brief" rows={3} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} placeholder="Tujuan, audiens, hook 3 detik, pesan kunci…" /></div>
    </div>
  );
}

function BaruDialog({ meta, onClose, onSaved }) {
  const besok = new Date(); besok.setDate(besok.getDate() + 7);
  const [f, setF] = useState({ judul: "", tanggal_tayang: ymd(besok), format: "Reels", platforms: ["IG", "TIKTOK", "SHORT"], pilar: "", bucket: "VALUE", funnel: "", cta_keyword: "", naskah_url: "", brief: "" });
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState(null);
  useEffect(() => { if (!f.tanggal_tayang) return; K.pratinjau(f.tanggal_tayang).then(setPv).catch(() => setPv(null)); }, [f.tanggal_tayang]);
  const simpan = async () => {
    setBusy(true);
    try { const k = await K.buat(f); toast.success(`${k.kode} dibuat — ${k.tahapan.length} tugas otomatis untuk tim`); onSaved(k); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="konten-baru-dialog">
        <DialogHeader><DialogTitle className="font-display text-lg">Konten baru</DialogTitle>
          <DialogDescription className="text-emerald-800/70">Tugas tiap tahap dibuat otomatis untuk PIC dengan deadline mundur dari tanggal tayang.</DialogDescription></DialogHeader>
        <FormFields f={f} setF={setF} meta={meta} />
        <div className={`rounded-lg p-2.5 text-[11px] ${pv?.dipadatkan ? "border border-amber-300 bg-amber-50 text-amber-950" : "bg-emerald-50/60 text-emerald-900"}`} data-testid="kt-jadwal">
          {pv?.dipadatkan && <p className="mb-1 font-semibold"><AlertTriangle size={11} className="mb-0.5 mr-1 inline" />Tanggal tayang kurang dari {pv.minimal_hari} hari lagi — jadwal tahap dipadatkan mulai hari ini. Pastikan tim sanggup, atau mundurkan tanggal tayang.</p>}
          {meta.tahap.map((t) => <p key={t.k}><b>{t.label}</b> — {t.pic_nama || "PIC belum diatur"} · {pv ? tglPendek(pv.deadline[t.k]) : "-"}</p>)}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={simpan} disabled={busy || !f.judul.trim()} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="kt-simpan">{busy && <Loader2 size={14} className="animate-spin" />} Buat konten</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailKonten({ k, meta, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [links, setLinks] = useState({});
  const [guru, setGuru] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!k) return;
    setF({ judul: k.judul, tanggal_tayang: k.tanggal_tayang || "", format: k.format || "", platforms: k.platforms || [], pilar: k.pilar || "", bucket: k.bucket || "", funnel: k.funnel || "", cta_keyword: k.cta_keyword || "", naskah_url: k.naskah_url || "", brief: k.brief || "" });
    setLinks(k.links || {}); setGuru("");
  }, [k]);
  if (!k || !f) return null;
  const aktif = k.status === "AKTIF";
  const jalan = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast.success(ok); onSaved(r?.id ? r : null); } catch (e) { toast.error(formatApiErr(e)); } setBusy(false); };
  return (
    <Sheet open={!!k} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="konten-detail">
        <SheetHeader className="text-left">
          <p className="font-mono text-xs text-emerald-800/60">{k.kode} · {k.tahap_label}</p>
          <SheetTitle className="font-display text-lg leading-snug">{k.judul}</SheetTitle>
          <SheetDescription className="sr-only">Detail konten</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-4 text-sm">
          {k.tahapan.length > 0 && (
            <section className="rounded-lg border border-emerald-100">
              <p className="border-b border-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">Tahapan (tugas otomatis)</p>
              <ul className="divide-y divide-emerald-50">
                {k.tahapan.map((t) => (
                  <li key={t.tahap} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${t.selesai ? "bg-emerald-500 text-white" : t.telat ? "bg-red-500 text-white" : "border border-emerald-200 text-emerald-800/50"}`}>{t.selesai ? <Check size={11} /> : ""}</span>
                    <span className="flex-1 font-medium text-emerald-950">{t.label}</span>
                    <span className="text-emerald-800/70">{t.pic_nama || "-"}</span>
                    <span className={`w-24 text-right tabular-nums ${t.telat ? "font-semibold text-red-600" : "text-emerald-800/60"}`}>{tglPendek(t.deadline)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-emerald-50 px-3 py-1.5 text-[10px] text-emerald-800/50">Tandai selesai dari menu Tugas (Untuk saya). Tahap Tashih & Posting juga bisa diselesaikan di sini.</p>
            </section>
          )}

          {aktif && (k.tahap === "TASHIH" || !k.tashih) && k.tahapan.some((t) => t.tahap === "TASHIH") && (
            <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-xs font-semibold text-amber-900">Tashih guru</p>
              {k.tashih ? <p className="mt-1 text-xs">Ditashih oleh <b>{k.tashih.guru}</b>.</p> : (
                <div className="mt-2 flex gap-2">
                  <Input value={guru} onChange={(e) => setGuru(e.target.value)} placeholder="Nama guru yang mentashih" className="h-9 bg-white text-xs" data-testid="kt-guru" />
                  <Button size="sm" disabled={busy || guru.trim().length < 2} onClick={() => jalan(() => K.tashih(k.id, { guru }), "Tashih tercatat")} className="h-9 bg-emerald-900 text-xs text-white">Sudah ditashih</Button>
                </div>
              )}
            </section>
          )}
          {k.tashih && <p className="text-xs text-emerald-800/80">Tashih: <b>{k.tashih.guru}</b>{k.tashih.catatan ? ` — ${k.tashih.catatan}` : ""}</p>}

          <section className="space-y-2">
            <p className="text-xs font-semibold text-emerald-900">Link tayang per platform</p>
            {(k.platforms || []).map((p) => (
              <div key={p} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-emerald-800/70">{PLAT[p]}</span>
                <Input value={links[p] || ""} onChange={(e) => setLinks({ ...links, [p]: e.target.value })} placeholder="https://…" className="h-8 bg-white text-xs" data-testid={`kt-link-${p}`} />
                {links[p] && <a href={links[p]} target="_blank" rel="noopener noreferrer" className="text-emerald-700"><ExternalLink size={14} /></a>}
              </div>
            ))}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => jalan(() => K.ubah(k.id, { links }), "Link disimpan")} className="h-8 text-xs" data-testid="kt-simpan-link">Simpan link</Button>
            <p className="text-[10px] text-emerald-800/50">Semua platform terisi → tahap Posting otomatis selesai.</p>
          </section>

          <PerformaForm k={k} onSaved={onSaved} />

          <section className="space-y-2 border-t border-emerald-50 pt-3">
            <p className="text-xs font-semibold text-emerald-900">Detail konten</p>
            <FormFields f={f} setF={setF} meta={meta} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => jalan(() => K.ubah(k.id, f), "Konten disimpan" + (f.tanggal_tayang !== k.tanggal_tayang ? " — deadline tugas ikut digeser" : ""))} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="kt-simpan-detail">Simpan</Button>
              {meta.bisa_kelola && aktif && <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Batalkan konten ini? Tugas yang belum selesai diarsipkan.") && jalan(() => K.batal(k.id), "Konten dibatalkan").then(onClose)} className="text-red-600 hover:bg-red-50">Batalkan konten</Button>}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImporDialog({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState(null);
  const kirim = async () => {
    if (!file) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append("file", file); const r = await K.impor(fd); setHasil(r); toast.success(`Impor selesai: ${r.arsip} arsip, ${r.aktif} aktif`); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && (hasil ? onSaved() : onClose())}>
      <DialogContent className="max-w-md" data-testid="konten-impor-dialog">
        <DialogHeader><DialogTitle className="font-display text-lg">Impor dari spreadsheet</DialogTitle>
          <DialogDescription className="text-emerald-800/70">Buka spreadsheet Content Calendar → tab <b>jadwal konten</b> → File → Download → CSV. Unggah file itu di sini.</DialogDescription></DialogHeader>
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-emerald-900/80">
          <li>Konten yang sudah posted (atau lebih dari 14 hari lalu) masuk <b>arsip</b> beserta link-nya.</li>
          <li>Konten yang belum tayang jadi <b>konten aktif</b> + tugas otomatis; tahap yang sudah lewat (mis. scripted) ditandai selesai.</li>
          <li>Kode RS-xxx yang sudah ada dilewati, jadi aman diimpor ulang.</li>
        </ul>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" data-testid="konten-impor-file" />
        {hasil && <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-900">Arsip {hasil.arsip} · aktif {hasil.aktif} · dilewati {hasil.lewati}{hasil.gagal.length ? ` · gagal: ${hasil.gagal.join("; ")}` : ""}</p>}
        <DialogFooter><Button variant="outline" onClick={() => (hasil ? onSaved() : onClose())}>{hasil ? "Tutup" : "Batal"}</Button>
          {!hasil && <Button onClick={kirim} disabled={!file || busy} className="bg-emerald-900 text-white hover:bg-emerald-800">{busy && <Loader2 size={14} className="animate-spin" />} Impor</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AturDialog({ meta, anggota, onClose, onSaved }) {
  const [pic, setPic] = useState(Object.fromEntries(meta.tahap.map((t) => [t.k, t.pic_id || ""])));
  const [off, setOff] = useState(Object.fromEntries(meta.tahap.map((t) => [t.k, t.offset])));
  const simpan = async () => {
    try { onSaved(await K.atur({ pic, offset: off })); toast.success("Pengaturan tahap disimpan (berlaku untuk konten baru)"); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="konten-atur-dialog">
        <DialogHeader><DialogTitle className="font-display text-lg">Tahap & PIC</DialogTitle>
          <DialogDescription className="text-emerald-800/70">Siapa mengerjakan tiap tahap dan berapa hari dari tanggal tayang (minus = sebelum tayang).</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {meta.tahap.map((t) => (
            <div key={t.k} className="grid grid-cols-[1fr_150px_72px] items-center gap-2">
              <div><p className="text-sm font-medium text-emerald-950">{t.label}</p><p className="text-[10px] text-emerald-800/60">{t.instruksi}</p></div>
              <select value={pic[t.k] || ""} onChange={(e) => setPic({ ...pic, [t.k]: e.target.value })} className="h-9 rounded-md border border-input bg-white px-2 text-xs">
                <option value="">— pilih —</option>{anggota.map((a) => <option key={a.id} value={a.id}>{a.nama}</option>)}
              </select>
              <Input type="number" value={off[t.k]} onChange={(e) => setOff({ ...off, [t.k]: Number(e.target.value) })} className="h-9 bg-white text-xs" aria-label={`Hari ${t.label}`} />
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={simpan} className="bg-emerald-900 text-white hover:bg-emerald-800">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const METRIK = [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["comments", "Komentar"], ["saves", "Simpan"], ["shares", "Bagikan"], ["follows", "Follow"], ["dm", "DM / tanya"]];

function PerformaForm({ k, onSaved }) {
  const plat = k.platforms || [];
  const [p, setP] = useState(plat[0] || "IG");
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(Object.fromEntries(METRIK.map(([f]) => [f, k.performa?.[p]?.[f] ?? ""]))); }, [p, k]);
  const tayang = k.tanggal_tayang ? new Date(`${k.tanggal_tayang}T00:00:00`) : null;
  const sudah72 = tayang && (Date.now() - tayang.getTime()) / 36e5 >= 72;
  const simpan = async () => {
    const body = { platform: p };
    METRIK.forEach(([f]) => { if (v[f] !== "" && v[f] != null) body[f] = Math.max(0, parseInt(v[f], 10) || 0); });
    setBusy(true);
    try { const r = await K.performa(k.id, body); toast.success(`Performa ${PLAT[p]} tersimpan`); onSaved(r); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  if (!plat.length) return null;
  return (
    <section className="space-y-2 border-t border-emerald-50 pt-3" data-testid="kt-performa">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-emerald-900">Performa 72 jam</p>
        {!sudah72 && <span className="text-[10px] text-amber-700">Idealnya diisi 72 jam setelah tayang</span>}
        <div className="ml-auto flex gap-1">
          {plat.map((x) => (
            <button key={x} onClick={() => setP(x)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${p === x ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900"}`}>
              {PLAT[x]}{k.performa?.[x] ? " ✓" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {METRIK.map(([f, l]) => (
          <label key={f} className="text-[10px] text-emerald-800/70">{l}
            <Input inputMode="numeric" value={v[f] ?? ""} onChange={(e) => setV({ ...v, [f]: e.target.value.replace(/[^0-9]/g, "") })} className="h-8 bg-white text-xs" data-testid={`kt-perf-${f}`} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={simpan} className="h-8 text-xs" data-testid="kt-perf-simpan">Simpan performa {PLAT[p]}</Button>
        {k.performa?.[p]?.diisi_at && <span className="text-[10px] text-emerald-800/50">diisi {k.performa[p].oleh} · {new Date(k.performa[p].diisi_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>}
      </div>
      <p className="text-[10px] text-emerald-800/50">Semua platform terisi → tahap Laporan otomatis selesai.</p>
    </section>
  );
}

const fmt = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}jt` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}rb` : String(n));

function TabelRekap({ judul, rows }) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
      <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">{judul}</p>
      {rows.length === 0 ? <p className="px-4 py-3 text-xs text-emerald-800/50">Belum ada data.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-emerald-800/50"><tr>
              <th className="px-4 py-1.5 text-left font-medium">{judul.replace("Per ", "")}</th><th className="px-2 text-right font-medium">Konten</th>
              <th className="px-2 text-right font-medium">Rata views</th><th className="px-2 text-right font-medium">Reach</th><th className="px-2 text-right font-medium" title="Interaksi ÷ reach">ER</th><th className="px-4 text-right font-medium">DM</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.nama} className="border-t border-emerald-50"><td className="px-4 py-1.5 font-medium text-emerald-950">{r.nama}</td><td className="px-2 text-right tabular-nums">{r.konten}</td>
                <td className="px-2 text-right font-semibold tabular-nums">{fmt(r.rata_views)}</td><td className="px-2 text-right tabular-nums">{fmt(r.reach)}</td>
                <td className="px-2 text-right tabular-nums">{r.er == null ? "—" : `${r.er}%`}</td><td className="px-4 text-right tabular-nums">{r.dm}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Performa({ bulan, onBuka }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    K.rekap({ dari: ymd(bulan), sampai: ymd(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 0)) }).then(setD).catch((e) => toast.error(formatApiErr(e)));
  }, [bulan]);
  if (!d) return <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>;
  if (!d.jumlah_konten) return <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">Belum ada performa yang diisi untuk bulan ini. Isi di kartu konten → Performa 72 jam.</div>;
  const Top = ({ judul, list, key2 }) => (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
      <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">{judul}</p>
      <ol className="divide-y divide-emerald-50">{list.map((x, i) => (
        <li key={x.id}><button onClick={() => onBuka(x)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-50/50">
          <span className="w-4 font-semibold text-emerald-800/50">{i + 1}</span><span className="min-w-0 flex-1 truncate text-emerald-950">{x.judul}</span>
          <span className="font-semibold tabular-nums text-emerald-900">{fmt(x[key2])}</span></button></li>
      ))}{list.length === 0 && <li className="px-4 py-3 text-xs text-emerald-800/50">Belum ada.</li>}</ol>
    </section>
  );
  return (
    <div className="space-y-4" data-testid="konten-performa">
      <p className="text-xs text-emerald-800/70">{d.jumlah_konten} konten berdata performa bulan ini. ER = (likes + komentar + simpan + bagikan) ÷ reach.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Top judul="Views tertinggi" list={d.top_views} key2="views" />
        <Top judul="DM / pertanyaan terbanyak" list={d.top_dm} key2="dm" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelRekap judul="Per platform" rows={d.platform} />
        <TabelRekap judul="Per pilar" rows={d.pilar} />
        <TabelRekap judul="Per format" rows={d.format} />
        <TabelRekap judul="Per bucket" rows={d.bucket} />
      </div>
    </div>
  );
}
