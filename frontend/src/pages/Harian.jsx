import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, HeartHandshake, Repeat } from "lucide-react";
import { toast } from "sonner";
import { listAmaliyahItems, listEntries, upsertEntry, listTasks, listTodoEntries, upsertTodoEntry, listAnggota } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import Spiritual from "@/pages/Spiritual";
import TugasRutin from "@/pages/TugasRutin";
import { PageTabs } from "@/components/PageTabs";

// Tanggal lokal (WIB), bukan UTC — toISOString() bergeser sehari sebelum jam 07.00.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function isoWeekKey(d) {
  const t = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const year = t.getFullYear();
  const firstThursday = t.valueOf();
  t.setMonth(0, 1);
  if (t.getDay() !== 4) t.setMonth(0, 1 + ((4 - t.getDay()) + 7) % 7);
  const w = 1 + Math.ceil((firstThursday - t) / 604800000);
  return `${year}-W${String(w).padStart(2, "0")}`;
}

const TABS = [
  { k: "hari-ini", label: "Hari ini" },
  { k: "amaliyah", label: "Amaliyah (bulanan)" },
  { k: "rutin", label: "Tugas rutin (bulanan)" },
];

export default function Harian() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "hari-ini";
  return (
    <div className="space-y-4">
      <PageTabs tabs={TABS} value={tab} onChange={(k) => setParams(k === "hari-ini" ? {} : { tab: k })} />
      {tab === "hari-ini" && <HariIni onOpen={(k) => setParams({ tab: k })} />}
      {tab === "amaliyah" && <Spiritual />}
      {tab === "rutin" && <TugasRutin />}
    </div>
  );
}

function HariIni({ onOpen }) {
  const { user } = useAuth();
  const now = new Date();
  const today = ymd(now);
  const isSunday = now.getDay() === 0;
  const periods = { HARIAN: today, MINGGUAN: isoWeekKey(now), BULANAN: today.slice(0, 7) };
  const [items, setItems] = useState([]);
  const [amal, setAmal] = useState({});
  const [rutin, setRutin] = useState([]);
  const [todo, setTodo] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [it, en, rtAll, ag] = await Promise.all([listAmaliyahItems(), listEntries({ start: today, end: today }), listTasks({ tipe: "RUTIN" }), listAnggota()]);
        const myDiv = ag.find((a) => a.id === user?.anggota_id)?.divisi_id;
        // Tugas rutin tim saya atau yang ditugaskan ke saya (SPV tidak melihat rutin semua tim di sini)
        const rt = rtAll.filter((t) => t.penerima_tugas_id === user?.anggota_id || (myDiv && t.divisi_id === myDiv));
        setItems(it.filter((x) => x.aktif !== false));
        setAmal(Object.fromEntries(en.filter((e) => e.checked).map((e) => [e.item_id, true])));
        setRutin(rt);
        if (rt.length) {
          const ps = Object.values(periods);
          const te = await listTodoEntries({ task_ids: rt.map((t) => t.id).join(",") });
          setTodo(Object.fromEntries(te.filter((e) => e.checked && ps.includes(e.period)).map((e) => [`${e.task_id}::${e.period}`, true])));
        }
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, []);

  const toggleAmal = async (id) => {
    const next = !amal[id];
    setAmal((p) => ({ ...p, [id]: next }));
    try { await upsertEntry({ item_id: id, tanggal: today, checked: next }); }
    catch { setAmal((p) => ({ ...p, [id]: !next })); toast.error("Gagal menyimpan"); }
  };
  const toggleRutin = async (t) => {
    const period = periods[t.kategori];
    const key = `${t.id}::${period}`;
    const next = !todo[key];
    setTodo((p) => ({ ...p, [key]: next }));
    try { await upsertTodoEntry({ task_id: t.id, period, checked: next }); }
    catch { setTodo((p) => ({ ...p, [key]: !next })); toast.error("Gagal menyimpan"); }
  };

  const doneAmal = items.filter((i) => amal[i.id]).length;
  const rutinVisible = useMemo(() => rutin.filter((t) => !(t.kategori === "HARIAN" && isSunday)), [rutin, isSunday]);
  const doneRutin = rutinVisible.filter((t) => todo[`${t.id}::${periods[t.kategori]}`]).length;
  const tanggal = now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (loading) return <p className="p-6 text-center text-sm text-emerald-800/60">Memuat…</p>;

  return (
    <div className="space-y-4" data-testid="hari-ini">
      <p className="text-sm text-emerald-800/70">{tanggal}. Centang yang sudah dikerjakan; tersimpan otomatis.</p>

      <section className="rounded-xl border border-emerald-100 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-emerald-50 px-4 py-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-emerald-950"><HeartHandshake size={16} className="text-emerald-700" /> Amaliyah hari ini</h3>
          <span className="text-xs font-semibold tabular-nums text-emerald-800">{doneAmal}/{items.length}</span>
        </header>
        {items.length === 0 ? <p className="px-4 py-4 text-xs text-emerald-800/60">Belum ada item amaliyah. SPV dapat menambahkannya di tab Amaliyah.</p> : (
          <ul>
            {items.map((i) => (
              <ChecklistRow key={i.id} checked={!!amal[i.id]} onClick={() => toggleAmal(i.id)} title={i.nama} sub={i.target_metrik} testId={`hari-amal-${i.id}`} />
            ))}
          </ul>
        )}
        <button onClick={() => onOpen("amaliyah")} className="w-full border-t border-emerald-50 px-4 py-2 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-50">Lihat rekap bulan ini & streak →</button>
      </section>

      <section className="rounded-xl border border-emerald-100 bg-white">
        <header className="flex items-center justify-between gap-2 border-b border-emerald-50 px-4 py-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-emerald-950"><Repeat size={16} className="text-emerald-700" /> Tugas rutin</h3>
          <span className="text-xs font-semibold tabular-nums text-emerald-800">{doneRutin}/{rutinVisible.length}</span>
        </header>
        {rutinVisible.length === 0 ? <p className="px-4 py-4 text-xs text-emerald-800/60">{isSunday && rutin.length ? "Ahad libur untuk tugas harian." : "Tidak ada tugas rutin untuk Anda."}</p> : (
          <ul>
            {rutinVisible.map((t) => (
              <ChecklistRow key={t.id} checked={!!todo[`${t.id}::${periods[t.kategori]}`]} onClick={() => toggleRutin(t)} title={t.nama}
                sub={{ HARIAN: "Harian · hari ini", MINGGUAN: "Mingguan · pekan ini", BULANAN: "Bulanan · bulan ini" }[t.kategori]} testId={`hari-rutin-${t.id}`} />
            ))}
          </ul>
        )}
        <button onClick={() => onOpen("rutin")} className="w-full border-t border-emerald-50 px-4 py-2 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-50">Lihat rekap bulan ini →</button>
      </section>
    </div>
  );
}

function ChecklistRow({ checked, onClick, title, sub, testId }) {
  return (
    <li className="border-b border-emerald-50 last:border-b-0">
      <button onClick={onClick} data-testid={testId} aria-pressed={checked}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-emerald-50/60">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition ${checked ? "border-emerald-700 bg-emerald-700 text-white" : "border-emerald-300 bg-white"}`}>
          {checked && <Check size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${checked ? "text-emerald-800/60 line-through" : "text-emerald-950"}`}>{title}</span>
          {sub && <span className="block text-[11px] text-emerald-800/60">{sub}</span>}
        </span>
      </button>
    </li>
  );
}
