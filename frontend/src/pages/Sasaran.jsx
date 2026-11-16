import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarRange, ChevronDown, ChevronRight, Copy, Archive, Plus, Settings2, Pencil, ListChecks, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAuth, formatApiErr } from "@/lib/AuthContext";
import { PageTabs } from "@/components/PageTabs";
import {
  sasaranOverview, sasaranPeriods, sasaranCreatePeriod, sasaranActivatePeriod, sasaranArchivePeriod, sasaranCopyFrom,
  sasaranVisi, sasaranSaveVisi, listAnggota, listDivisi,
} from "@/lib/api";
import { StatusPill, ProgressBar, UkuranRow, CheckinDialog, UkuranDialog, SasaranSheet, PERSPEKTIF, PERSPEKTIF_ARTI, STATUS, InfoTip, ISTILAH } from "@/pages/sasaran/parts";
import EvaluasiSasaran from "@/pages/sasaran/Evaluasi";
import PapanSkor from "@/pages/sasaran/PapanSkor";
import RapatMingguan from "@/pages/sasaran/Rapat";
import Panduan from "@/pages/sasaran/Panduan";

// Satu data (Objective → Key Result → Tugas), beberapa sudut pandang manajemen.
const TABS = [
  { k: "papan", label: "Papan Skor", hint: "Semua angka target dalam satu tabel: sekarang vs pekan lalu, tren 13 pekan, status" },
  { k: "rapat", label: "Rapat Mingguan", hint: ISTILAH.RAPAT.isi },
  { k: "ringkasan", label: "Dashboard", hint: "Ringkasan kondisi target periode ini" },
  { k: "bsc", label: "BSC", hint: ISTILAH.BSC.isi },
  { k: "sasaran", label: "OKR", hint: ISTILAH.OKR.isi },
  { k: "kpi", label: "KPI", hint: ISTILAH.KPI.isi },
  { k: "evaluasi", label: "Evaluasi", hint: "Rekap akhir periode, catatan SPV, PDF Komitmen & Evaluasi" },
  { k: "panduan", label: "Panduan", hint: "Siapa melakukan apa, kapan, dan bagaimana" },
];

export default function Sasaran() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "papan";
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [ov, setOv] = useState(null);
  const [anggotaAll, setAnggotaAll] = useState([]);
  const [divisiList, setDivisiList] = useState([]);
  const [visi, setVisi] = useState(null);
  const [checkinU, setCheckinU] = useState(null);
  const [ukuranEdit, setUkuranEdit] = useState(null); // {sasaran, ukuran?}
  const [sheet, setSheet] = useState(null); // {sasaran?} | null
  const [periodDlg, setPeriodDlg] = useState(false);
  const [visiDlg, setVisiDlg] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = async (pid = periodId) => {
    try {
      const [o, ps] = await Promise.all([sasaranOverview(pid || undefined), sasaranPeriods()]);
      setOv(o); setPeriods(ps); if (o.period && !pid) setPeriodId(o.period.id);
    } catch (e) { toast.error(formatApiErr(e)); }
  };
  useEffect(() => {
    load();
    Promise.all([listAnggota(), listDivisi(), sasaranVisi()]).then(([a, d, v]) => { setAnggotaAll(a); setDivisiList(d); setVisi(v); }).catch(() => {});
    // eslint-disable-next-line
  }, []);
  const pickPeriod = (id) => { setPeriodId(id); load(id); };

  const me = user?.anggota_id;
  const canCheckin = (s, u) => !!ov && (ov.is_spv || (me && (u.pic_id === me || s.pj_id === me)) || (ov.head_divisi_id && s.divisi_id === ov.head_divisi_id));
  const sById = useMemo(() => Object.fromEntries((ov?.sasaran || []).map((s) => [s.id, s])), [ov]);
  const period = ov?.period;
  const isSpv = ov?.is_spv;

  if (!ov) return <p className="p-8 text-center text-sm text-emerald-800/60">Memuat Target Bersama…</p>;

  return (
    <div className="space-y-4" data-testid="sasaran-page">
      {/* Header periode — ringkas */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-100 bg-white px-4 py-3">
        <CalendarRange size={18} className="text-emerald-700" />
        <select value={periodId || ""} onChange={(e) => pickPeriod(e.target.value)} data-testid="period-select"
          className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-sm font-semibold text-emerald-950">
          {periods.length === 0 && <option value="">Belum ada periode</option>}
          {periods.map((p) => <option key={p.id} value={p.id}>{p.nama}{p.active ? " · aktif" : p.archived ? " · arsip" : ""}</option>)}
        </select>
        {period && (
          <div className="order-last flex w-full items-center gap-2 text-xs text-emerald-800/70 lg:order-none lg:w-auto lg:min-w-[180px] lg:flex-1">
            <span className="whitespace-nowrap tabular-nums">{period.start} → {period.end}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-emerald-100"><div className="h-full bg-emerald-400" style={{ width: `${ov.expected_pct}%` }} /></div>
            <span className="whitespace-nowrap">waktu berjalan {Math.round(ov.expected_pct)}%</span>
          </div>
        )}
        {isSpv && (
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" size="sm" className="ml-auto lg:ml-0" data-testid="period-menu"><Settings2 size={14} /> Periode</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              <MenuBtn onClick={() => setPeriodDlg(true)} icon={Plus}>Periode baru</MenuBtn>
              {period && !period.active && <MenuBtn onClick={async () => { await sasaranActivatePeriod(period.id); toast.success("Periode diaktifkan"); load(period.id); }} icon={CalendarRange}>Jadikan periode aktif</MenuBtn>}
              {period && !period.archived && <MenuBtn onClick={async () => { await sasaranArchivePeriod(period.id); toast.success("Periode diarsipkan"); load(period.id); }} icon={Archive}>Arsipkan periode ini</MenuBtn>}
              {period && periods.filter((p) => p.id !== period.id).length > 0 && (
                <div className="mt-1 border-t border-emerald-50 pt-1">
                  <p className="px-2 py-1 text-[10px] uppercase text-emerald-800/50">Salin OKR dari periode</p>
                  {periods.filter((p) => p.id !== period.id).map((p) => (
                    <MenuBtn key={p.id} icon={Copy} onClick={async () => { try { const r = await sasaranCopyFrom(period.id, p.id); toast.success(`${r.sasaran_disalin} objective disalin`); load(period.id); } catch (e) { toast.error(formatApiErr(e)); } }}>{p.nama}</MenuBtn>
                  ))}
                </div>
              )}
              <div className="mt-1 border-t border-emerald-50 pt-1"><MenuBtn onClick={() => setVisiDlg(true)} icon={Quote}>Ubah visi & misi</MenuBtn></div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <PageTabs tabs={TABS} value={tab} onChange={(k) => setParams(k === "papan" ? {} : { tab: k })} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-emerald-800/70" data-testid="glosarium">
        <span>Apa itu:</span>
        {["BSC", "OKR", "KPI", "KR", "LAG", "LEAD", "BASELINE", "POLARITAS", "CHECKIN", "STATUS"].map((k) => (
          <span key={k} className="inline-flex items-center gap-0.5">{({ KR: "Key Result", LAG: "Hasil", LEAD: "Proses", BASELINE: "Baseline", POLARITAS: "Polaritas", CHECKIN: "Check-in", STATUS: "Status" })[k] || k}<InfoTip k={k} /></span>
        ))}
      </div>

      {tab === "panduan" ? <Panduan /> : !period ? (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">
          Belum ada periode aktif. {isSpv ? "Buat periode lewat tombol Periode." : "Minta SPV membuat periode."}
        </div>
      ) : tab === "papan" ? (
        <PapanSkor periodId={period.id} me={me} onCheckin={setCheckinU} reloadKey={reloadKey} />
      ) : tab === "rapat" ? (
        <RapatMingguan isSpv={isSpv} anggotaAll={anggotaAll} divisiList={divisiList} sasaranList={ov.sasaran} />
      ) : tab === "ringkasan" ? (
        <Ringkasan ov={ov} visi={visi} canCheckin={canCheckin} sById={sById} onCheckin={setCheckinU} onOpen={() => setParams({ tab: "sasaran" })} />
      ) : tab === "bsc" ? (
        <BscView ov={ov} onOpen={() => setParams({ tab: "sasaran" })} />
      ) : tab === "kpi" ? (
        <KpiView ov={ov} canCheckin={canCheckin} sById={sById} onCheckin={setCheckinU} />
      ) : tab === "sasaran" ? (
        <DaftarSasaran ov={ov} canCheckin={canCheckin} onCheckin={setCheckinU} divisiList={divisiList}
          onNew={() => setSheet({})} onEdit={(s) => setSheet({ sasaran: s })}
          onAddUkuran={(s) => setUkuranEdit({ sasaran: s })} onEditUkuran={(s, u) => setUkuranEdit({ sasaran: s, ukuran: u })} />
      ) : (
        <EvaluasiSasaran periodId={period.id} isSpv={isSpv} divisiList={divisiList} />
      )}

      <CheckinDialog ukuran={checkinU} open={!!checkinU} onOpenChange={(v) => !v && setCheckinU(null)} onSaved={() => { load(periodId); setReloadKey((x) => x + 1); }} />
      <UkuranDialog open={!!ukuranEdit} onOpenChange={(v) => !v && setUkuranEdit(null)} sasaran={ukuranEdit?.sasaran} ukuran={ukuranEdit?.ukuran}
        anggotaAll={anggotaAll} divisiList={divisiList} onSaved={() => load(periodId)} />
      <SasaranSheet open={!!sheet} onOpenChange={(v) => !v && setSheet(null)} sasaran={sheet?.sasaran} periodId={periodId} ov={ov}
        anggotaAll={anggotaAll} divisiList={divisiList} onSaved={() => load(periodId)} />
      <PeriodDialog open={periodDlg} onOpenChange={setPeriodDlg} onSaved={(p) => { setPeriodId(p.id); load(p.id); }} />
      <VisiDialog open={visiDlg} onOpenChange={setVisiDlg} visi={visi} onSaved={setVisi} />
    </div>
  );
}

// Persen objective hanya dari KR yang sudah punya realisasi — tampilkan berapa yang sudah ada datanya.
function dataInfo(s) {
  const n = s.ukuran.length, ada = s.ukuran.filter((u) => u.capaian !== null && u.capaian !== undefined).length;
  if (!n) return "belum ada KR";
  return ada === n ? `${n} KR` : `${ada} dari ${n} KR ada data`;
}

function BscView({ ov, onOpen }) {
  const groups = [...Object.keys(PERSPEKTIF), "_"].map((k) => ({ k, list: ov.sasaran.filter((s) => (s.perspektif || "_") === k) }));
  return (
    <div className="space-y-3" data-testid="bsc-view">
      <p className="text-xs text-emerald-800/70">Objective dikelompokkan per perspektif Balanced Scorecard <InfoTip k="BSC" />. Atur perspektif lewat tombol Ubah di tab OKR.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.filter((g) => g.k !== "_" || g.list.length).map((g) => (
          <section key={g.k} className="rounded-xl border border-emerald-100 bg-white p-4" data-testid={`bsc-${g.k}`}>
            <h3 className="font-display text-base font-semibold text-emerald-950">{g.k === "_" ? "Tanpa perspektif" : PERSPEKTIF[g.k]}</h3>
            <p className="mb-3 text-[11px] text-emerald-800/60">{g.k === "_" ? "Objective yang belum diberi perspektif BSC." : PERSPEKTIF_ARTI[g.k]}</p>
            {g.list.length === 0 ? <p className="text-xs italic text-emerald-800/50">Belum ada objective di perspektif ini.</p> : (
              <ul className="space-y-2">
                {g.list.map((s) => (
                  <li key={s.id}>
                    <button onClick={onOpen} className="w-full rounded-lg border border-emerald-50 p-2.5 text-left hover:bg-emerald-50/50">
                      <div className="flex items-start justify-between gap-2"><span className="text-sm text-emerald-950">{s.judul}</span><StatusPill status={s.status} small /></div>
                      <p className="mt-0.5 text-[11px] text-emerald-800/60">{s.level === "TIM" ? `Tim ${s.divisi?.nama}` : "Lembaga"} · {dataInfo(s)}</p>
                      <div className="mt-1.5 flex items-center gap-2"><ProgressBar pct={s.pct} status={s.status} /><span className="w-9 text-right text-[11px] tabular-nums">{s.pct == null ? "–" : `${Math.round(Math.min(s.pct, 100))}%`}</span></div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function KpiView({ ov, canCheckin, sById, onCheckin }) {
  const byPic = {};
  ov.sasaran.forEach((s) => s.ukuran.forEach((u) => { const k = u.pic?.id || "_"; (byPic[k] = byPic[k] || { nama: u.pic?.nama || "Belum ada PIC", list: [] }).list.push(u); }));
  const people = Object.entries(byPic).sort(([a, x], [b, y]) => (a === "_") - (b === "_") || x.nama.localeCompare(y.nama));
  return (
    <div className="space-y-3" data-testid="kpi-view">
      <p className="text-xs text-emerald-800/70">KPI per orang <InfoTip k="KPI" /> — setiap Key Result yang punya PIC menjadi KPI orang tersebut. Check-in dilakukan oleh PIC.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {people.map(([id, p]) => {
          const cnt = (st) => p.list.filter((u) => u.status === st).length;
          return (
            <section key={id} className="rounded-xl border border-emerald-100 bg-white p-4" data-testid={`kpi-${id}`}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-emerald-950">{p.nama}</h3>
                <span className="text-[11px] text-emerald-800/70">{p.list.length} KPI · {cnt("SESUAI")} on track · {cnt("PERHATIAN") + cnt("TERTINGGAL")} perlu perhatian · {p.list.filter((u) => u.perlu_update).length} perlu check-in</span>
              </div>
              <div className="space-y-2">
                {p.list.map((u) => <UkuranRow key={u.id} u={u} compact canCheckin={canCheckin(sById[u.sasaran_id] || {}, u)} onCheckin={onCheckin} />)}
              </div>
            </section>
          );
        })}
      </div>
      {people.length === 0 && <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-emerald-800/70">Belum ada KPI. Tambahkan Key Result dengan PIC di tab OKR.</p>}
    </div>
  );
}

function MenuBtn({ onClick, icon: Icon, children }) {
  return <button onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-emerald-950 hover:bg-emerald-50"><Icon size={13} className="text-emerald-700" />{children}</button>;
}

function Ringkasan({ ov, visi, canCheckin, sById, onCheckin, onOpen }) {
  const st = ov.stats || {};
  const perlu = ov.checkin_saya_perlu || [];
  const lembaga = ov.sasaran.filter((s) => s.level === "LEMBAGA");
  const tim = ov.sasaran.filter((s) => s.level === "TIM");
  return (
    <div className="space-y-4" data-testid="ringkasan">
      {visi?.visi && <p className="rounded-xl bg-emerald-50/70 px-4 py-3 text-sm italic text-emerald-900"><Quote size={14} className="mb-1 mr-1 inline text-emerald-600" />{visi.visi}</p>}

      {ov.ukuran_saya.length > 0 && (
        <section className={`rounded-xl border p-4 ${perlu.length ? "border-amber-200 bg-amber-50/60" : "border-emerald-100 bg-white"}`} data-testid="checkin-saya">
          <h3 className="mb-1 font-display text-base font-semibold text-emerald-950">KPI saya — check-in <InfoTip k="CHECKIN" /></h3>
          <p className="mb-3 text-xs text-emerald-800/70">{perlu.length ? `${perlu.length} KPI Anda belum di-check-in dalam 10 hari terakhir.` : "Semua KPI Anda sudah di-check-in. Terima kasih."}</p>
          <div className="space-y-2">
            {ov.ukuran_saya.map((u) => <UkuranRow key={u.id} u={u} compact canCheckin={canCheckin(sById[u.sasaran_id] || {}, u)} onCheckin={onCheckin} />)}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2 text-xs" data-testid="ringkasan-stats">
        {[["SESUAI", st.sesuai], ["PERHATIAN", st.perhatian], ["TERTINGGAL", st.tertinggal], ["BELUM_ADA_DATA", st.belum_data]].map(([k, n]) => (
          <span key={k} className={`rounded-full px-3 py-1 font-semibold ${STATUS[k].cls}`}>{n || 0} {STATUS[k].label.toLowerCase()}</span>
        ))}
        <span className="rounded-full bg-white px-3 py-1 text-emerald-800 ring-1 ring-emerald-100">{st.perlu_update || 0} KR perlu check-in</span><InfoTip k="STATUS" />
      </div>

      {[["Objective lembaga", lembaga], ["Objective tim", tim]].map(([judul, list]) => list.length > 0 && (
        <section key={judul} className="rounded-xl border border-emerald-100 bg-white">
          <h3 className="border-b border-emerald-50 px-4 py-3 font-display text-base font-semibold text-emerald-950">{judul}</h3>
          <ul>
            {list.map((s) => (
              <li key={s.id}>
                <button onClick={onOpen} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-emerald-50 px-4 py-3 text-left last:border-b-0 hover:bg-emerald-50/40 sm:grid-cols-[1fr_160px_auto]">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-emerald-950">{s.judul}</span>
                    <span className="block text-[11px] text-emerald-800/60">
                      {s.level === "TIM" ? s.divisi?.nama : "Lembaga"}{s.pj ? ` · Owner ${s.pj.nama}` : ""}{s.perspektif ? ` · BSC ${PERSPEKTIF[s.perspektif]}` : ""} · {dataInfo(s)}
                      {s.tugas_summary.total ? ` · tugas ${s.tugas_summary.selesai}/${s.tugas_summary.total}` : ""}
                    </span>
                  </span>
                  <span className="order-3 col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
                    <ProgressBar pct={s.pct} status={s.status} /><span className="w-10 text-right text-xs tabular-nums text-emerald-900">{s.pct == null ? "–" : `${Math.round(Math.min(s.pct, 100))}%`}</span>
                  </span>
                  <StatusPill status={s.status} small />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ov.sasaran.length === 0 && <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-emerald-800/70">Belum ada objective di periode ini.</p>}
    </div>
  );
}

function DaftarSasaran({ ov, canCheckin, onCheckin, onNew, onEdit, onAddUkuran, onEditUkuran, divisiList }) {
  const [filter, setFilter] = useState("SEMUA");
  const [open, setOpen] = useState(() => new Set());
  const filters = [["SEMUA", "Semua"], ["LEMBAGA", "Lembaga"],
    ...divisiList.filter((d) => ov.sasaran.some((s) => s.divisi_id === d.id)).map((d) => [`TIM:${d.id}`, d.nama]),
    ...Object.entries(PERSPEKTIF).filter(([k]) => ov.sasaran.some((s) => s.perspektif === k)).map(([k, l]) => [`P:${k}`, l])];
  const list = ov.sasaran.filter((s) => filter === "SEMUA" || (filter === "LEMBAGA" && s.level === "LEMBAGA")
    || (filter.startsWith("TIM:") && s.divisi_id === filter.slice(4)) || (filter.startsWith("P:") && s.perspektif === filter.slice(2)));
  const toggle = (id) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const parentName = (id) => ov.sasaran.find((s) => s.id === id)?.judul;
  return (
    <div className="space-y-3" data-testid="daftar-sasaran">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === k ? "bg-emerald-900 text-white" : "bg-white text-emerald-900 ring-1 ring-emerald-100 hover:bg-emerald-50"}`}>{l}</button>
        ))}
        {ov.bisa_buat && <Button size="sm" onClick={onNew} className="ml-auto bg-emerald-900 text-white hover:bg-emerald-800" data-testid="sasaran-new"><Plus size={14} /> Objective baru</Button>}
      </div>
      {list.map((s) => {
        const isOpen = open.has(s.id) || list.length <= 3;
        return (
          <article key={s.id} className="rounded-xl border border-emerald-100 bg-white" data-testid={`sasaran-${s.id}`}>
            <header className="flex items-start gap-2 px-4 py-3">
              <button onClick={() => toggle(s.id)} className="mt-0.5 text-emerald-700" aria-label={isOpen ? "Tutup" : "Buka"}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
              <div className="min-w-0 flex-1">
                <button onClick={() => toggle(s.id)} className="text-left font-display text-[15px] font-semibold text-emerald-950">{s.judul}</button>
                <p className="mt-0.5 text-[11px] text-emerald-800/65">
                  {s.level === "TIM" ? `Tim ${s.divisi?.nama || "-"}` : "Lembaga"}{s.pj ? ` · Owner ${s.pj.nama}` : " · belum ada owner"}
                  {s.perspektif ? ` · BSC ${PERSPEKTIF[s.perspektif]}` : ""}{s.parent_id && parentName(s.parent_id) ? ` · turunan “${parentName(s.parent_id)}”` : ""} · {dataInfo(s)}
                </p>
                <div className="mt-2 flex items-center gap-2"><ProgressBar pct={s.pct} status={s.status} /><span className="text-xs tabular-nums">{s.pct == null ? "–" : `${Math.round(Math.min(s.pct, 100))}%`}</span></div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusPill status={s.status} />
                {s.bisa_ubah && <Button size="sm" variant="ghost" onClick={() => onEdit(s)} className="h-7 px-2 text-xs text-emerald-800"><Pencil size={12} /> Ubah</Button>}
              </div>
            </header>
            {isOpen && (
              <div className="space-y-2 border-t border-emerald-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800/60">Key Results <InfoTip k="KR" /></p>
                {s.ukuran.length === 0 && <p className="text-xs text-emerald-800/60">Belum ada Key Result. {s.bisa_ubah ? "Tambahkan 2–4 angka yang membuktikan objective ini tercapai." : ""}</p>}
                {s.ukuran.map((u) => <UkuranRow key={u.id} u={u} canCheckin={canCheckin(s, u)} canEdit={s.bisa_ubah} onCheckin={onCheckin} onEdit={(x) => onEditUkuran(s, x)} />)}
                {s.bisa_ubah && <Button size="sm" variant="outline" onClick={() => onAddUkuran(s)} className="h-7 text-xs"><Plus size={12} /> Tambah Key Result</Button>}
                <div className="mt-2 rounded-lg bg-emerald-50/50 p-2.5">
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-800/60"><ListChecks size={12} /> Tugas pendukung {s.tugas_summary.total ? `· ${s.tugas_summary.selesai}/${s.tugas_summary.total} selesai` : ""}</p>
                  {s.tugas.length === 0 ? <p className="text-xs text-emerald-800/60">Belum ada. Tautkan dari form Tugas › Detail lainnya › “Mendukung objective”.</p> : (
                    <ul className="space-y-0.5 text-xs text-emerald-950">
                      {s.tugas.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.nama}{t.R ? <span className="text-emerald-800/50"> · {t.R}</span> : ""}</span><span className="shrink-0 text-emerald-800/60">{t.status.replace("_", " ").toLowerCase()}</span></li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
      {list.length === 0 && <p className="rounded-xl border border-dashed border-emerald-200 bg-white p-6 text-center text-sm text-emerald-800/70">Tidak ada objective untuk filter ini.</p>}
    </div>
  );
}

function PeriodDialog({ open, onOpenChange, onSaved }) {
  const [f, setF] = useState({ nama: "", start: "", end: "", active: true });
  const save = async () => {
    if (!f.start || !f.end) return toast.error("Isi tanggal mulai dan akhir");
    try { const p = await sasaranCreatePeriod(f); toast.success(`Periode ${p.nama} dibuat`); onOpenChange(false); onSaved(p); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Periode baru</DialogTitle>
          <DialogDescription>Disarankan 2–3 bulan. Nama dibuat otomatis dari tanggal jika dikosongkan.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs" htmlFor="pd-start">Mulai</label><Input id="pd-start" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <div><label className="text-xs" htmlFor="pd-end">Akhir</label><Input id="pd-end" type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          </div>
          <div><label className="text-xs" htmlFor="pd-nama">Nama (opsional)</label><Input id="pd-nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="mis. Siklus 5 · Jan–Feb 2027" /></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Jadikan periode aktif</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button><Button onClick={save} className="bg-emerald-900 text-white hover:bg-emerald-800">Buat</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VisiDialog({ open, onOpenChange, visi, onSaved }) {
  const [v, setV] = useState("");
  const [misi, setMisi] = useState("");
  const [nilai, setNilai] = useState("");
  useEffect(() => { if (open) { setV(visi?.visi || ""); setMisi((visi?.misi || []).join("\n")); setNilai((visi?.nilai || []).join("\n")); } }, [open, visi]);
  const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    try { onSaved(await sasaranSaveVisi({ visi: v.trim(), misi: lines(misi), nilai: lines(nilai) })); toast.success("Visi & misi disimpan"); onOpenChange(false); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Visi & misi lembaga</DialogTitle><DialogDescription>Berlaku untuk semua periode.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <div><label className="text-xs" htmlFor="vs-visi">Visi</label><Textarea id="vs-visi" rows={3} value={v} onChange={(e) => setV(e.target.value)} /></div>
          <div><label className="text-xs" htmlFor="vs-misi">Misi (satu per baris)</label><Textarea id="vs-misi" rows={4} value={misi} onChange={(e) => setMisi(e.target.value)} /></div>
          <div><label className="text-xs" htmlFor="vs-nilai">Nilai (satu per baris)</label><Textarea id="vs-nilai" rows={2} value={nilai} onChange={(e) => setNilai(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button><Button onClick={save} className="bg-emerald-900 text-white hover:bg-emerald-800">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
