import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Settings2, ChevronLeft, ChevronRight, LayoutGrid, CalendarDays, List, Loader2, AlertTriangle, Search, BarChart3, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatApiErr } from "@/lib/AuthContext";
import { K, JENIS_URUT, JENIS_PENDEK, JenisBadge, StatusBadge, FASE, faseOf, ymd, tglPendek, fmt, PERAN_LABEL } from "./konten/shared";
import DetailKonten from "./konten/Detail";
import BaruDialog from "./konten/Baru";

const VIEWS = [["pipeline", "Pipeline", LayoutGrid], ["kalender", "Kalender", CalendarDays], ["daftar", "Daftar", List], ["performa", "Performa", BarChart3]];
const akhirBulan = (b) => new Date(b.getFullYear(), b.getMonth() + 1, 0);

function Kartu({ k, onBuka }) {
  return (
    <button onClick={() => onBuka(k)} className={`w-full rounded-lg border bg-white p-2.5 text-left shadow-sm hover:border-emerald-300 ${k.terlambat ? "border-red-200" : "border-emerald-100"}`} data-testid={`konten-${k.kode}`}>
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-800/60">
        <JenisBadge j={k.jenis} /><span className="font-mono">{k.kode}</span>
        <span className={`ml-auto ${k.terlambat ? "font-semibold text-red-600" : ""}`}>{k.terlambat && <AlertTriangle size={10} className="mb-0.5 mr-0.5 inline" />}{tglPendek(k.tanggal_tayang)}{k.jam_tayang ? ` ${k.jam_tayang}` : ""}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-emerald-950">{k.judul}</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-emerald-50"><div className="h-full bg-emerald-500" style={{ width: `${k.progres}%` }} /></div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px]">
        <StatusBadge k={k} />
        <span className="ml-auto truncate text-emerald-800/70">{k.pelaksana_nama || "-"}</span>
      </div>
    </button>
  );
}

function Pipeline({ rows, jenis, meta, onBuka }) {
  // Satu tipe dipilih → kolom = status tipe itu. Campuran → kolom = fase.
  const kolom = jenis.length === 1
    ? meta.jenis[jenis[0]].alur.map((a) => ({ k: a.k, label: a.label, cocok: (x) => x.status_konten === a.k }))
    : FASE.map((f) => ({ k: f.k, label: f.label, cocok: (x) => faseOf(x) === f.k }));
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2" data-testid="konten-pipeline">
      {kolom.map((c) => {
        const list = rows.filter(c.cocok);
        return (
          <section key={c.k} className="flex w-[78vw] shrink-0 snap-start flex-col rounded-xl border border-emerald-100 bg-emerald-50/40 sm:w-60">
            <header className="flex items-center gap-2 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-950">{c.label}</p>
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
  const awal = (new Date(y, m, 1).getDay() + 6) % 7;
  const n = akhirBulan(bulan).getDate();
  const sel = [...Array(awal).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  const hariIni = ymd(new Date());
  return (
    <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white" data-testid="konten-kalender">
      <div className="grid min-w-[760px] grid-cols-7">
        {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Ahad"].map((h) => <div key={h} className="border-b border-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800/70">{h}</div>)}
        {sel.map((d, i) => {
          const t = d ? ymd(new Date(y, m, d)) : null;
          const isi = t ? rows.filter((k) => k.tanggal_tayang === t) : [];
          return (
            <div key={i} className={`min-h-[104px] border-b border-r border-emerald-50 p-1 ${t === hariIni ? "bg-emerald-50/60" : ""}`}>
              {d && <p className={`mb-1 text-[11px] font-semibold ${t === hariIni ? "text-emerald-900" : "text-emerald-800/50"}`}>{d}</p>}
              <div className="space-y-1">
                {isi.slice(0, 6).map((k) => (
                  <button key={k.id} onClick={() => onBuka(k)} title={`${k.kode} · ${k.jenis_label} · ${k.status_label}${k.jam_tayang ? ` · ${k.jam_tayang}` : ""}\n${k.judul}`}
                    className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left text-[10px] ${k.terlambat ? "border-red-200 bg-red-50" : ["SELESAI", "POSTED", "LAPORAN"].includes(k.status_konten) ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50/60"}`}>
                    <JenisBadge j={k.jenis} /><span className="truncate text-emerald-950">{k.judul}</span>
                  </button>
                ))}
                {isi.length > 6 && <p className="text-center text-[10px] text-emerald-800/50">+{isi.length - 6} lagi</p>}
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
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-emerald-50/60 text-left text-[11px] uppercase tracking-wide text-emerald-800/70">
          <tr><th className="px-3 py-2">Kode</th><th className="px-3 py-2">Tipe</th><th className="px-3 py-2">Judul</th><th className="px-3 py-2">Tayang</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Dikerjakan</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Pilar</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-emerald-800/60">Belum ada konten.</td></tr>}
          {rows.map((k) => (
            <tr key={k.id} onClick={() => onBuka(k)} className="cursor-pointer border-t border-emerald-50 hover:bg-emerald-50/40">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-emerald-800/70">{k.kode}</td>
              <td className="px-3 py-2"><JenisBadge j={k.jenis} /></td>
              <td className="max-w-[280px] truncate px-3 py-2 font-medium text-emerald-950">{k.judul}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{tglPendek(k.tanggal_tayang)}{k.jam_tayang ? ` ${k.jam_tayang}` : ""}</td>
              <td className="px-3 py-2"><StatusBadge k={k} /></td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-900">{k.pelaksana_nama || "-"}</td>
              <td className={`whitespace-nowrap px-3 py-2 text-xs ${k.terlambat ? "font-semibold text-red-600" : "text-emerald-800/70"}`}>{k.status_konten === "SELESAI" ? "—" : tglPendek(k.deadline)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-800/70">{k.pilar || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelRekap({ judul, rows }) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
      <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">{judul}</p>
      {rows.length === 0 ? <p className="px-4 py-3 text-xs text-emerald-800/50">Belum ada data.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-emerald-800/50"><tr>
            <th className="px-4 py-1.5 text-left font-medium">{judul.replace("Per ", "")}</th><th className="px-2 text-right font-medium">Konten</th>
            <th className="px-2 text-right font-medium">Rata views</th><th className="px-2 text-right font-medium">Reach</th><th className="px-2 text-right font-medium" title="Interaksi ÷ reach">ER</th>
            <th className="px-2 text-right font-medium">Leads</th><th className="px-4 text-right font-medium">Daftar</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.nama} className="border-t border-emerald-50"><td className="px-4 py-1.5 font-medium text-emerald-950">{r.nama}</td><td className="px-2 text-right tabular-nums">{r.konten}</td>
              <td className="px-2 text-right font-semibold tabular-nums">{fmt(r.rata_views)}</td><td className="px-2 text-right tabular-nums">{fmt(r.reach)}</td>
              <td className="px-2 text-right tabular-nums">{r.er == null ? "—" : `${r.er}%`}</td><td className="px-2 text-right tabular-nums">{r.leads}</td><td className="px-4 text-right tabular-nums">{r.daftar}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Top({ judul, list, key2, onBuka }) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
      <p className="border-b border-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-950">{judul}</p>
      <ol className="divide-y divide-emerald-50">{list.map((x, i) => (
        <li key={x.id}><button onClick={() => onBuka(x)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-50/50">
          <span className="w-4 font-semibold text-emerald-800/50">{i + 1}</span><JenisBadge j={x.jenis} /><span className="min-w-0 flex-1 truncate text-emerald-950">{x.judul}</span>
          <span className="font-semibold tabular-nums text-emerald-900">{fmt(x[key2])}</span></button></li>
      ))}</ol>
    </section>
  );
}

function Performa({ bulan, jenis, onBuka }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    K.rekap({ dari: ymd(bulan), sampai: ymd(akhirBulan(bulan)), ...(jenis.length ? { jenis: jenis.join(",") } : {}) }).then(setD).catch((e) => toast.error(formatApiErr(e)));
  }, [bulan, jenis]);
  if (!d) return <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>;
  if (!d.jumlah_konten) return <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">Belum ada performa untuk bulan & tipe ini. Performa diisi publisher saat konten berstatus Laporan.</div>;
  return (
    <div className="space-y-4" data-testid="konten-performa">
      <p className="text-xs text-emerald-800/70">{d.jumlah_konten} konten berdata performa (tayang bulan ini). ER = interaksi ÷ reach. Leads = DM, tanya harga, tanya program, voice note.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Top judul="Views tertinggi" list={d.top_views} key2="views" onBuka={onBuka} />
        <Top judul="Leads terbanyak" list={d.top_leads} key2="leads" onBuka={onBuka} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelRekap judul="Per tipe" rows={d.jenis} />
        <TabelRekap judul="Per platform" rows={d.platform} />
        <TabelRekap judul="Per pilar" rows={d.pilar} />
        <TabelRekap judul="Per bucket" rows={d.bucket} />
      </div>
    </div>
  );
}

function PilihAnggota({ meta, v, onChange, label }) {
  return (
    <select value={v || ""} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-input bg-white px-2 text-xs" aria-label={label}>
      <option value="">—</option>{meta.anggota_tim.map((a) => <option key={a.id} value={a.id}>{a.nama}</option>)}
    </select>
  );
}

function PeranDialog({ meta, onClose, onSaved }) {
  const [peran, setPeran] = useState(Object.fromEntries(Object.entries(meta.peran).map(([r, v]) => [r, v.id || ""])));
  const teks = JENIS_URUT.filter((j) => meta.jenis[j].grup === "TEKS");
  const [penulis, setPenulis] = useState(Object.fromEntries(teks.map((j) => [j, meta.jenis[j].penulis?.id || ""])));
  const simpan = async () => {
    try { onSaved(await K.peran({ peran, penulis })); toast.success("Peran disimpan — tugas konten aktif ikut diperbarui"); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto" data-testid="konten-peran-dialog">
        <DialogHeader><DialogTitle className="font-display text-lg">Peran tim konten</DialogTitle>
          <DialogDescription className="text-emerald-800/70">Menentukan siapa memegang tugas di tiap status. Perubahan langsung berlaku juga untuk konten yang sedang berjalan.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {["LEAD", "PRODUKSI", "PUBLISHER"].map((r) => (
            <div key={r} className="grid grid-cols-[150px_1fr] items-center gap-2"><span className="text-xs font-medium text-emerald-950">{PERAN_LABEL[r]}</span>
              <PilihAnggota meta={meta} v={peran[r]} label={r} onChange={(v) => setPeran({ ...peran, [r]: v })} /></div>
          ))}
          <p className="pt-2 text-xs font-semibold text-emerald-950">Penulis copy (status Scripting)</p>
          {teks.map((j) => (
            <div key={j} className="grid grid-cols-[150px_1fr] items-center gap-2"><span className="text-xs text-emerald-900">{meta.jenis[j].label}</span>
              <PilihAnggota meta={meta} v={penulis[j]} label={j} onChange={(v) => setPenulis({ ...penulis, [j]: v })} /></div>
          ))}
          <p className="text-[10px] text-emerald-800/50">Kosong = Lead konten.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={simpan} className="bg-emerald-900 text-white hover:bg-emerald-800">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Panduan({ meta }) {
  const [buka, setBuka] = useState(() => { try { return localStorage.getItem("ws_konten_panduan2") === "1"; } catch { return false; } });
  const toggle = () => { setBuka(!buka); try { localStorage.setItem("ws_konten_panduan2", buka ? "0" : "1"); } catch { /* abaikan */ } };
  const nama = (r, j) => (r === "PENULIS" ? meta.jenis[j].penulis?.nama : meta.peran[r]?.nama) || "-";
  const grup = [["REELS", "Reels / Video"], ["CAROUSEL", "Carousel & Single image"], ["THREADS", "Threads, IG Story, WA Channel"]];
  return (
    <section className="rounded-xl border border-emerald-100 bg-white" data-testid="konten-panduan">
      <button onClick={toggle} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-semibold text-emerald-950">
        Siapa memegang status apa <span className="text-xs font-normal text-emerald-700">{buka ? "Tutup" : "Buka"}</span>
      </button>
      {buka && (
        <div className="space-y-3 border-t border-emerald-50 p-4">
          {grup.map(([j, l]) => (
            <div key={j} className="overflow-x-auto">
              <p className="mb-1 text-xs font-semibold text-emerald-950">{l}</p>
              <table className="text-[11px]"><tbody>
                {["LEAD", "PENULIS", "PRODUKSI", "PUBLISHER"].filter((r) => meta.jenis[j].alur.some((a) => a.pemegang.includes(r)))
                  .filter((r) => r !== "PENULIS" || nama("PENULIS", j) !== nama("LEAD", j)).map((r) => {
                    // Penulis = lead → digabung ke baris lead.
                    const peranku = (a) => [r, ...(r === "LEAD" && nama("PENULIS", j) === nama("LEAD", j) ? ["PENULIS"] : [])].some((x) => a.pemegang.includes(x));
                    const kerjaku = (a) => a.pelaksana === r || (r === "LEAD" && a.pelaksana === "PENULIS" && nama("PENULIS", j) === nama("LEAD", j));
                    return (
                      <tr key={r}><td className="whitespace-nowrap pr-3 font-medium text-emerald-900">{nama(r, j)}</td>
                        {meta.jenis[j].alur.map((a) => <td key={a.k} className="px-0.5 py-0.5"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 ${peranku(a) ? (kerjaku(a) ? "bg-emerald-800 text-white" : "bg-emerald-100 text-emerald-900") : "text-slate-300"}`}>{a.label}</span></td>)}</tr>
                    );
                  })}
              </tbody></table>
            </div>
          ))}
          <p className="text-[11px] text-emerald-800/70">Hijau tua = yang mengerjakan langkah itu. Hijau muda = tugasnya ikut tampil di <b>Tugas › Untuk saya</b>. Otomatis: semua link platform terisi → Posted; 72 jam setelah Posted → Laporan; performa terisi → Selesai. Semua anggota tim tetap bisa melihat seluruh konten di menu ini.</p>
        </div>
      )}
    </section>
  );
}

export default function Konten() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem("ws_konten_view") || "pipeline"; } catch { return "pipeline"; } });
  const [bulan, setBulan] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [jenis, setJenis] = useState([]);
  const [punyaSaya, setPunyaSaya] = useState(false);
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [sp, setSp] = useSearchParams();

  const pilihView = (v) => { setView(v); try { localStorage.setItem("ws_konten_view", v); } catch { /* abaikan */ } };
  const pakaiBulan = view !== "pipeline";
  const bulanKey = pakaiBulan ? ymd(bulan) : "";
  const load = async () => {
    try {
      setRows(await K.list(pakaiBulan ? { dari: ymd(bulan), sampai: ymd(akhirBulan(bulan)), arsip: true } : {}));
    } catch (e) { toast.error(formatApiErr(e)); setRows([]); }
  };
  useEffect(() => { K.meta().then(setMeta).catch((e) => toast.error(formatApiErr(e))); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === "performa") return; setRows(null); load(); }, [view, bulanKey]);
  // Buka konten dari tautan (mis. dari menu Tugas: /konten?buka=<id>)
  useEffect(() => {
    const id = sp.get("buka");
    if (id) K.detail(id).then(setBuka).catch((e) => toast.error(formatApiErr(e)));
  }, [sp]);
  const tutup = () => { setBuka(null); if (sp.get("buka")) { sp.delete("buka"); setSp(sp, { replace: true }); } };
  const bukaKonten = (k) => K.detail(k.id).then(setBuka).catch((e) => toast.error(formatApiErr(e)));
  const segar = (k) => { if (k) setBuka(k); if (view !== "performa") load(); };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((k) => (!jenis.length || jenis.includes(k.jenis))
      && (!punyaSaya || (k.pemegang_ids || []).includes(meta?.anggota_id))
      && (!s || `${k.kode} ${k.judul} ${k.pilar || ""} ${k.status_label}`.toLowerCase().includes(s))
      && (view !== "pipeline" || k.status_konten !== "SELESAI" || (Date.now() - new Date(k.updated_at || k.created_at).getTime()) < 14 * 864e5));
  }, [rows, q, jenis, punyaSaya, meta, view]);
  const telat = filtered.filter((k) => k.terlambat).length;
  const togJenis = (j) => setJenis(jenis.includes(j) ? jenis.filter((x) => x !== j) : [...jenis, j]);

  if (!meta) return <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>;

  return (
    <div className="space-y-4" data-testid="konten-page">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-emerald-950">Produksi Konten</h3>
          <p className="text-xs text-emerald-800/70">Satu konten = satu tugas. Statusnya mengikuti alur tipe konten, dan tugasnya berpindah ke orang yang memegang tiap status.
            {telat > 0 && <b className="ml-1 text-red-600">{telat} konten lewat target.</b>}</p>
        </div>
        {meta.bisa_kelola && <Button size="sm" variant="outline" onClick={() => setDlg("peran")} className="h-8 text-xs" data-testid="konten-peran"><Settings2 size={13} /> Peran</Button>}
        <Button size="sm" onClick={() => setDlg("baru")} className="h-8 bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="konten-baru"><Plus size={13} /> Konten baru</Button>
      </div>

      <Panduan meta={meta} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-emerald-200 bg-white p-1">
          {VIEWS.map(([k, l, I]) => (
            <button key={k} onClick={() => pilihView(k)} data-testid={`konten-view-${k}`}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === k ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><I size={13} /> {l}</button>
          ))}
        </div>
        {pakaiBulan && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setBulan(new Date(bulan.getFullYear(), bulan.getMonth() - 1, 1))} aria-label="Bulan sebelumnya"><ChevronLeft size={14} /></Button>
            <span className="min-w-[120px] text-center text-sm font-semibold text-emerald-950">{bulan.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setBulan(new Date(bulan.getFullYear(), bulan.getMonth() + 1, 1))} aria-label="Bulan berikutnya"><ChevronRight size={14} /></Button>
          </div>
        )}
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-700/60" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, judul, status…" className="h-8 bg-white pl-8 text-xs" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1" data-testid="konten-filter-jenis">
        <button onClick={() => setJenis([])} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${!jenis.length ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 bg-white text-emerald-900"}`}>Semua tipe</button>
        {JENIS_URUT.map((j) => (
          <button key={j} onClick={() => togJenis(j)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${jenis.includes(j) ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 bg-white text-emerald-900"}`} data-testid={`konten-jenis-${j}`}>{JENIS_PENDEK[j]}</button>
        ))}
        {meta.anggota_id && view !== "performa" && (
          <button onClick={() => setPunyaSaya(!punyaSaya)} className={`ml-1 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${punyaSaya ? "border-amber-500 bg-amber-100 text-amber-900" : "border-emerald-200 bg-white text-emerald-900"}`} data-testid="konten-punya-saya"><UserCheck size={11} /> Pegangan saya</button>
        )}
        {view === "pipeline" && <span className="text-[10px] text-emerald-800/50">{jenis.length === 1 ? `Kolom = status ${meta.jenis[jenis[0]].label}` : "Pilih satu tipe untuk melihat kolom per status"}</span>}
      </div>

      {view === "performa" ? <Performa bulan={bulan} jenis={jenis} onBuka={bukaKonten} />
        : rows === null ? <div className="grid place-items-center p-12"><Loader2 className="animate-spin text-emerald-800" /></div>
        : view === "pipeline" ? <Pipeline rows={filtered} jenis={jenis} meta={meta} onBuka={bukaKonten} />
        : view === "kalender" ? <Kalender rows={filtered} bulan={bulan} onBuka={bukaKonten} />
        : <Daftar rows={filtered} onBuka={bukaKonten} />}

      {buka && <DetailKonten k={buka} meta={meta} onClose={tutup} onSaved={segar} />}
      {dlg === "baru" && <BaruDialog meta={meta} onClose={() => setDlg(null)} onSaved={(k) => { setDlg(null); segar(k); }} />}
      {dlg === "peran" && <PeranDialog meta={meta} onClose={() => setDlg(null)} onSaved={(m) => { setMeta(m); setDlg(null); load(); }} />}
    </div>
  );
}
