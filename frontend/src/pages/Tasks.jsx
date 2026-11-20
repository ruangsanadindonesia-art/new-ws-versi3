import { useEffect, useMemo, useState, useRef } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Trash2, LayoutGrid, Table as TableIcon, Search, X, Users, Archive, ArchiveRestore, ArrowRightLeft, FileUp, BarChart3, ChevronDown, UserPlus, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, formatApiErr } from "@/lib/AuthContext";
import {
  listTasks, createTask, updateTask, deleteTask, archiveTask, unarchiveTask, bulkDeleteTasks,
  bulkArchiveTasks, bulkUnarchiveTasks,
  listTaskLists, listTaskLabels, listDivisi, listAnggota, markSeenTasks, moveTask,
  importExcel, anggotaAnalytics, revisiTask, submitReview, approveTask, sasaranOverview,
  ajukanPindah, putuskanPindah, pindahMenunggu,
} from "@/lib/api";
import KanbanBoard from "./tasks/KanbanBoard";
import TableView from "./tasks/TableView";
import {
  TaskDialog, MoveTaskDialog, BulkMoveDialog,
  DivisiManagerDialog, AnggotaManagerDialog,
} from "./tasks/dialogs";

const emptyForm = {
  nama: "", kategori: "PROJECT", status: "BELUM_MULAI",
  penerima_tugas: "", penerima_tugas_id: null, pemberi_id: null, consulted_ids: [], informed_ids: [],
  tanggal_mulai: "", deadline: "", deadline_jam: "", prioritas: "",
  catatan_tim: "", divisi_id: null, list_id: null, label_ids: [],
  brief_link: "", hasil_link: "", hasil_catatan: "",
};

const SORT_KEY = "ws_task_sort_v1";
const PRIO_RANK = { TINGGI: 0, SEDANG: 1, RENDAH: 2 };
// Kunci urut "Cerdas": selesai di bawah, lalu terlambat, lalu deadline terdekat (tanggal+jam), lalu prioritas, tanpa deadline paling akhir.
const deadlineKey = (t) => (t.deadline ? `${t.deadline}T${t.deadline_jam || "23:59"}` : "9999");
const SORTS = {
  cerdas: { label: "Cerdas (disarankan)", fn: (a, b) => (a.status === "SELESAI") - (b.status === "SELESAI") || deadlineKey(a).localeCompare(deadlineKey(b)) || (PRIO_RANK[a.prioritas] ?? 3) - (PRIO_RANK[b.prioritas] ?? 3) },
  prioritas: { label: "Prioritas", fn: (a, b) => (a.status === "SELESAI") - (b.status === "SELESAI") || (PRIO_RANK[a.prioritas] ?? 3) - (PRIO_RANK[b.prioritas] ?? 3) || deadlineKey(a).localeCompare(deadlineKey(b)) },
  deadline: { label: "Deadline terdekat", fn: (a, b) => deadlineKey(a).localeCompare(deadlineKey(b)) },
  terbaru: { label: "Terbaru dibuat", fn: (a, b) => (b.created_at || "").localeCompare(a.created_at || "") },
  manual: { label: "Manual (urutan kanban)", fn: null },
};

export default function Tasks() {
  const outlet = useOutletContext();
  const { user } = useAuth();
  const isSpv = user?.role === "spv";
  const myAnggotaId = user?.anggota_id || null;
  const [divisiList, setDivisiList] = useState([]);
  const [divisiId, setDivisiId] = useState("");
  const [tasks, setTasks] = useState([]);
  const [lists, setLists] = useState([]);
  const [labels, setLabels] = useState([]);
  const [anggotaAll, setAnggotaAll] = useState([]);
  const [allListsMap, setAllListsMap] = useState({});
  const [arsipMode, setArsipMode] = useState(false);
  const [view, setView] = useState("table");
  // Mode tampilan: saya (R) | review (A, menunggu review) | berikan (A, dikerjakan orang lain) | diikuti (C/I) | tim
  const [mode, setMode] = useState(user?.anggota_id ? "saya" : "tim");
  const [reviewCount, setReviewCount] = useState(0);
  const [sasaranList, setSasaranList] = useState([]);
  const [filter, setFilter] = useState({ search: "", list_id: "ALL", label_id: "ALL", penerima_id: "ALL" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortBy, setSortBy] = useState(() => { try { return localStorage.getItem(SORT_KEY) || "cerdas"; } catch { return "cerdas"; } });
  const [pindahList, setPindahList] = useState([]);

  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTaskState, setMoveTaskState] = useState(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [divisiMgrOpen, setDivisiMgrOpen] = useState(false);
  const [anggotaMgrOpen, setAnggotaMgrOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const anggotaMap = useMemo(() => Object.fromEntries(anggotaAll.map((a) => [a.id, a])), [anggotaAll]);
  const myDivisiId = myAnggotaId ? anggotaMap[myAnggotaId]?.divisi_id : null;
  const headDivisiId = myAnggotaId ? divisiList.find((d) => d.head_anggota_id === myAnggotaId)?.id || null : null;
  const isHead = !!headDivisiId;
  const canSeeTim = isSpv || isHead;
  const visibleDivisi = isSpv ? divisiList : divisiList.filter((d) => d.id === headDivisiId);
  // Ganti R langsung: SPV, atau kepala tim untuk tugas timnya. Selain itu lewat pengajuan.
  const canGantiR = (t) => isSpv || (isHead && t && (t.divisi_id === headDivisiId || anggotaMap[t.penerima_tugas_id]?.divisi_id === headDivisiId));

  useEffect(() => {
    (async () => {
      const [d, lb, ag] = await Promise.all([listDivisi(), listTaskLabels(), listAnggota()]);
      setDivisiList(d); setLabels(lb); setAnggotaAll(ag);
      sasaranOverview().then((o) => setSasaranList((o.sasaran || []).map((s) => ({ id: s.id, judul: s.judul, tim: s.level === "TIM" ? s.divisi?.nama : "Lembaga" })))).catch(() => {});
      const myAng = user?.anggota_id ? ag.find((a) => a.id === user.anggota_id) : null;
      const hd = myAng ? d.find((x) => x.head_anggota_id === myAng.id)?.id : null;
      const firstDiv = user?.role === "spv" ? "ALL" : (hd || myAng?.divisi_id || d[0]?.id);
      if (!divisiId && firstDiv) setDivisiId(firstDiv);
    })();
    // eslint-disable-next-line
  }, []);

  const refreshAllListsMap = async () => {
    const all = await listTaskLists();
    const map = {};
    all.forEach((l) => { const k = l.divisi_id || "none"; if (!map[k]) map[k] = []; map[k].push(l); });
    setAllListsMap(map);
  };

  const isTim = mode === "tim";
  const listsDivisi = isTim && divisiId !== "ALL" ? divisiId : (myDivisiId || (divisiId !== "ALL" ? divisiId : null));

  const fetchTasks = async () => {
    const a = { archived: arsipMode };
    if (mode === "saya") return listTasks({ ...a, peran: "R" });
    if (mode === "review") return listTasks({ perlu_review: true });
    if (mode === "berikan") return (await listTasks({ ...a, peran: "A" })).filter((t) => t.penerima_tugas_id !== myAnggotaId);
    if (mode === "diikuti") {
      const [c, i] = await Promise.all([listTasks({ ...a, peran: "C" }), listTasks({ ...a, peran: "I" })]);
      const seen = new Set(); return [...c, ...i].filter((t) => !seen.has(t.id) && seen.add(t.id));
    }
    return listTasks(divisiId === "ALL" ? a : { ...a, divisi_id: divisiId });
  };

  const refresh = async () => {
    if (isTim && !divisiId) return;
    const [t, l, rv, pm] = await Promise.all([
      fetchTasks(),
      listsDivisi ? listTaskLists({ divisi_id: listsDivisi }) : Promise.resolve([]),
      myAnggotaId || isSpv ? listTasks({ perlu_review: true }) : Promise.resolve([]),
      pindahMenunggu().catch(() => []),
    ]);
    setTasks(t); setLists(l); setReviewCount(rv.length + pm.length); setPindahList(pm); refreshAllListsMap();
    outlet?.refreshUnread?.();
  };

  useEffect(() => {
    (async () => {
      await refresh(); setSelectedIds([]);
      if (isTim && divisiId && divisiId !== "ALL" && !arsipMode) { await markSeenTasks(divisiId); outlet?.refreshUnread?.(); }
    })();
    // eslint-disable-next-line
  }, [divisiId, arsipMode, mode]);

  const refreshDivisi = async () => {
    const d = await listDivisi(); setDivisiList(d);
    if (divisiId !== "ALL" && !d.find((x) => x.id === divisiId) && d.length > 0) setDivisiId(myDivisiId || d[0].id);
  };
  const refreshLabels = async () => setLabels(await listTaskLabels());
  const refreshAnggota = async () => setAnggotaAll(await listAnggota());
  const refreshLists = async () => { if (listsDivisi) setLists(await listTaskLists({ divisi_id: listsDivisi })); refreshAllListsMap(); };

  const filteredRaw = useMemo(() => tasks.filter((t) => {
    if (filter.search && !t.nama?.toLowerCase().includes(filter.search.toLowerCase())) return false;
    if (filter.list_id !== "ALL" && (t.list_id || "no-list") !== filter.list_id) return false;
    if (filter.label_id !== "ALL" && !(t.label_ids || []).includes(filter.label_id)) return false;
    if (filter.penerima_id !== "ALL" && t.penerima_tugas_id !== filter.penerima_id) return false;
    return true;
  }), [tasks, filter]);
  const filtered = useMemo(() => (SORTS[sortBy]?.fn ? [...filteredRaw].sort(SORTS[sortBy].fn) : filteredRaw), [filteredRaw, sortBy]);
  const pilihSort = (v) => { setSortBy(v); try { localStorage.setItem(SORT_KEY, v); } catch { /* abaikan */ } };
  const putuskan = async (id, setuju) => {
    const catatan = setuju ? "" : (window.prompt("Alasan menolak (opsional):", "") || "");
    try { await putuskanPindah(id, { setuju, catatan }); toast.success(setuju ? "Pemindahan disetujui" : "Pemindahan ditolak"); refresh(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };

  const openNew = () => { setEditing(null); setForm({ ...emptyForm, divisi_id: myDivisiId || divisiId, list_id: lists.find((l) => !l.is_done)?.id || null, penerima_tugas_id: myAnggotaId, pemberi_id: myAnggotaId }); setTaskDialogOpen(true); };
  const openEdit = (t) => { setEditing(t); setForm({ ...emptyForm, ...t, tanggal_mulai: t.tanggal_mulai || "", deadline: t.deadline || "", deadline_jam: t.deadline_jam || "", prioritas: t.prioritas || "", label_ids: t.label_ids || [], consulted_ids: t.consulted_ids || [], informed_ids: t.informed_ids || [] }); setTaskDialogOpen(true); };
  const openMove = (t) => { setMoveTaskState(t); setMoveOpen(true); };

  // keepOpen: dipakai tombol "Simpan & kirim untuk review" — simpan dulu, lalu aksi review menutup dialog.
  const submit = async ({ keepOpen = false } = {}) => {
    if (!form.nama.trim()) { toast.error("Nama tugas wajib diisi"); throw new Error("invalid"); }
    try {
      const payload = { ...form };
      const alasanPindah = (payload._alasan_pindah || "").trim();
      delete payload._alasan_pindah;
      if (!payload.tanggal_mulai) payload.tanggal_mulai = null;
      if (!payload.deadline) { payload.deadline = null; payload.deadline_jam = ""; }
      let ajukanKe = null;
      if (editing && payload.penerima_tugas_id !== editing.penerima_tugas_id && !canGantiR(editing)) {
        if (alasanPindah.length < 3) { toast.error("Tulis alasan pemindahan R untuk kepala tim"); throw new Error("invalid"); }
        ajukanKe = payload.penerima_tugas_id;
        payload.penerima_tugas_id = editing.penerima_tugas_id; // R tetap sampai disetujui
      }
      delete payload.link_output; delete payload.pemberi_tugas;
      if (!editing && !payload.sasaran_id) delete payload.sasaran_id;
      if (editing) {
        await updateTask(editing.id, payload);
        if (ajukanKe) { await ajukanPindah(editing.id, { penerima_id: ajukanKe, alasan: alasanPindah }); toast.success("Disimpan. Pengajuan ganti R dikirim ke kepala tim."); }
        else if (!keepOpen) toast.success("Tugas disimpan");
      }
      else {
        delete payload.catatan_spv;
        if (!payload.penerima_tugas_id) { toast.error("Pilih R (yang mengerjakan)"); return; }
        const created = await createTask(payload);
        const rNama = anggotaMap[created.penerima_tugas_id]?.nama;
        toast.success(created.penerima_tugas_id === myAnggotaId ? "Tugas dibuat" : `Tugas dibuat dan ditugaskan ke ${rNama || "R"}`);
        if (isTim && myDivisiId && divisiId !== "ALL" && divisiId !== myDivisiId) { setDivisiId(myDivisiId); setTaskDialogOpen(false); return; }
      }
      if (!keepOpen) { setTaskDialogOpen(false); refresh(); }
    } catch (e) { toast.error(formatApiErr(e)); throw e; }
  };

  const saveCell = async (id, patch) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
    // Pakai hasil dari server: server bisa menolak sebagian field sesuai peran RACI, atau menyinkronkan status/kolom.
    try { const saved = await updateTask(id, patch); setTasks((prev) => prev.map((t) => t.id === id ? saved : t)); }
    catch (e) { toast.error(formatApiErr(e)); refresh(); }
  };

  const submitRevisi = async (taskId, catatan) => {
    try {
      await revisiTask(taskId, catatan);
      toast.success("Revisi dikirim — penerima akan melihat catatanmu");
      setTaskDialogOpen(false);
      refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal kirim revisi"); }
  };

  const kirimReview = async (id) => {
    try { await submitReview(id); toast.success("Dikirim ke A untuk direview"); setTaskDialogOpen(false); refresh(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  const setujui = async (id) => {
    try { await approveTask(id); toast.success("Hasil disetujui — tugas Selesai"); setTaskDialogOpen(false); refresh(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };

  const archive = async (id) => { await archiveTask(id); toast.success("Diarsipkan"); refresh(); };
  const unarchive = async (id) => { await unarchiveTask(id); toast.success("Dikembalikan"); refresh(); };
  const remove = async (id) => { if (!window.confirm("Hapus tugas ini permanen?")) return; await deleteTask(id); toast.success("Dihapus"); refresh(); };
  const bulkRemove = async () => { if (!window.confirm(`Hapus ${selectedIds.length} tugas?`)) return; await bulkDeleteTasks(selectedIds); toast.success(`${selectedIds.length} dihapus`); setSelectedIds([]); refresh(); };
  const bulkArchive = async () => { await bulkArchiveTasks(selectedIds); toast.success(`${selectedIds.length} diarsipkan`); setSelectedIds([]); refresh(); };
  const bulkUnarchive = async () => { await bulkUnarchiveTasks(selectedIds); toast.success(`${selectedIds.length} dikembalikan`); setSelectedIds([]); refresh(); };

  const onDragEndTask = async (taskId, overId) => {
    const task = tasks.find((t) => t.id === taskId); if (!task) return;
    let newListId = overId; if (newListId === "no-list") newListId = null;
    if (newListId === task.list_id) return;
    const targetList = lists.find((l) => l.id === newListId);
    // Selalu sinkronkan status saat pindah kolom — agar workspace pemberi tugas
    // (yang mungkin tidak punya list ini) tetap melihat status terbaru.
    const patch = { list_id: newListId };
    if (targetList) {
      patch.status = targetList.is_done ? "SELESAI" : (targetList.urutan <= 1 ? "BELUM_MULAI" : "DALAM_PROSES");
    }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
    try {
      const saved = await updateTask(taskId, patch);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? saved : t)));
      if (saved.status === "MENUNGGU_REVIEW" && targetList?.is_done) toast.success(`Dikirim untuk review: ${task.nama}`);
      else if (saved.status === "SELESAI" && !arsipMode) toast.success(`Selesai! ${task.nama}`, { action: { label: "Arsipkan", onClick: () => archive(taskId) } });
    } catch { toast.error("Gagal"); refresh(); }
  };

  const onReorderLocal = (r) => setTasks(r);
  const outletUnread = outlet?.unread?.by_divisi || {};
  const filterActive = filter.search || filter.list_id !== "ALL" || filter.label_id !== "ALL" || filter.penerima_id !== "ALL";
  const filteredAnggotaCurrent = anggotaAll.filter((a) => a.divisi_id === divisiId);

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-emerald-100 bg-white p-1.5" data-testid="mode-tabs">
        {[
          ...(myAnggotaId ? [
            { k: "saya", label: "Untuk saya", hint: "Tugas yang Anda kerjakan (R)" },
            { k: "review", label: "Perlu review", hint: "Hasil yang menunggu persetujuan Anda (A)", badge: reviewCount },
            { k: "berikan", label: "Saya berikan", hint: "Tugas yang Anda tanggung jawabi (A), dikerjakan orang lain" },
            { k: "diikuti", label: "Diikuti", hint: "Anda Consulted (C) atau Informed (I)" },
          ] : (isSpv ? [{ k: "review", label: "Perlu review", hint: "Semua hasil yang menunggu persetujuan", badge: reviewCount }] : [])),
          ...(canSeeTim ? [{ k: "tim", label: isSpv ? "Semua tugas tim" : "Tim saya", hint: "Semua tugas anggota tim Anda" }] : []),
        ].map((m) => (
          <button key={m.k} onClick={() => setMode(m.k)} title={m.hint} data-testid={`mode-${m.k}`}
            className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m.k ? "bg-emerald-900 text-white" : "text-emerald-900 hover:bg-emerald-50"}`}>
            {m.label}
            {m.badge > 0 && <span className="ml-1.5 rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">{m.badge}</span>}
          </button>
        ))}
      </div>

      {/* Divisi Selector */}
      {isTim && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white p-2" data-testid="divisi-selector">
        <Users size={16} className="mx-2 text-emerald-700" />
        <div className="flex flex-wrap gap-1">
          {isSpv && (
            <button onClick={() => setDivisiId("ALL")} data-testid="divisi-tab-all"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${divisiId === "ALL" ? "bg-emerald-900 text-white shadow-sm" : "text-emerald-900 hover:bg-emerald-50"}`}>Semua tim</button>
          )}
          {visibleDivisi.map((d) => {
            const count = outletUnread[d.id] || 0;
            return (
              <button key={d.id} onClick={() => setDivisiId(d.id)} data-testid={`divisi-tab-${d.id}`}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${divisiId === d.id ? "bg-emerald-900 text-white shadow-sm" : "text-emerald-900 hover:bg-emerald-50"}`}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: d.warna }} />
                {d.nama}
                {count > 0 && divisiId !== d.id && (
                  <span data-testid={`divisi-badge-${d.id}`} className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0 text-[9px] font-bold text-white">{count}</span>
                )}
              </button>
            );
          })}
          {isSpv && (
            <button onClick={() => setDivisiMgrOpen(true)} data-testid="open-divisi-mgr" className="rounded-lg border border-dashed border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"><Plus size={12} className="inline" /> Tim</button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          {divisiId !== "ALL" && <Button size="sm" variant="ghost" onClick={() => setAnalyticsOpen(true)} data-testid="open-analytics" className="text-emerald-800 hover:bg-emerald-50"><BarChart3 size={14} /> Analytics</Button>}
          {isSpv && (
            <Button size="sm" variant="ghost" onClick={() => setAnggotaMgrOpen(true)} data-testid="open-anggota-mgr" className="text-emerald-800 hover:bg-emerald-50"><UserPlus size={14} /> Anggota</Button>
          )}
        </div>
      </div>}

      {/* Simplified toolbar: search + filter dropdown + preset + view + tugas baru */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white p-2">
        <Tabs value={arsipMode ? "arsip" : "aktif"} onValueChange={(v) => setArsipMode(v === "arsip")}>
          <TabsList className="bg-emerald-50">
            <TabsTrigger value="aktif" data-testid="tab-aktif">Aktif</TabsTrigger>
            <TabsTrigger value="arsip" data-testid="tab-arsip"><Archive size={12} className="mr-1" />Arsip</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700/60" />
          <Input data-testid="filter-search" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Cari nama tugas..." className="h-9 pl-9" />
        </div>

        {/* Consolidated Filter Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="open-filter" className="relative">
              Filter {filterActive && <span className="ml-1 h-2 w-2 rounded-full bg-emerald-500" />}
              <ChevronDown size={12} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="end">
            <p className="mb-2 text-[10px] uppercase font-semibold text-emerald-800/60">Filter Tugas</p>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-emerald-800/70">Status</label>
                <MiniSelect value={filter.list_id} onChange={(v) => setFilter({ ...filter, list_id: v })} options={[{ id: "ALL", nama: "Semua" }, ...lists, { id: "no-list", nama: "Tanpa status" }]} testId="filter-list" />
              </div>
              <div>
                <label className="text-[10px] text-emerald-800/70">Label</label>
                <MiniSelect value={filter.label_id} onChange={(v) => setFilter({ ...filter, label_id: v })} options={[{ id: "ALL", nama: "Semua" }, ...labels]} testId="filter-label" />
              </div>
              <div>
                <label className="text-[10px] text-emerald-800/70">Mengerjakan (R)</label>
                <MiniSelect value={filter.penerima_id} onChange={(v) => setFilter({ ...filter, penerima_id: v })} options={[{ id: "ALL", nama: "Semua" }, ...filteredAnggotaCurrent]} testId="filter-penerima" />
              </div>
              {filterActive && (
                <Button size="sm" variant="ghost" onClick={() => setFilter({ search: "", list_id: "ALL", label_id: "ALL", penerima_id: "ALL" })} className="w-full text-xs" data-testid="filter-reset"><X size={12} /> Reset</Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <label className="flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs text-emerald-900" title="Urutkan tugas">
          <ArrowUpDown size={12} className="text-emerald-700" />
          <select value={sortBy} onChange={(e) => pilihSort(e.target.value)} data-testid="sort-select" className="h-8 bg-transparent pr-1 text-xs outline-none">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>

        {isTim && divisiId !== "ALL" && <div className="flex rounded-lg border border-emerald-200 bg-white p-1">
          <button data-testid="view-board" onClick={() => setView("board")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === "board" ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><LayoutGrid size={13} /> Kanban</button>
          <button data-testid="view-table" onClick={() => setView("table")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${view === "table" ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><TableIcon size={13} /> Tabel</button>
        </div>}

        <Button onClick={openNew} data-testid="add-task-button" className="bg-emerald-900 text-white hover:bg-emerald-800 h-9"><Plus size={16} /> Tugas Baru</Button>
      </div>

      {/* Bulk Toolbar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 shadow-md" data-testid="bulk-toolbar">
          <span className="text-sm font-semibold text-amber-900">{selectedIds.length} tugas terpilih</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setBulkMoveOpen(true)} variant="outline" data-testid="bulk-move-open"><ArrowRightLeft size={14} /> Pindahkan</Button>
            {arsipMode ? <Button size="sm" onClick={bulkUnarchive} variant="outline" data-testid="bulk-unarchive"><ArchiveRestore size={14} /> Kembalikan</Button>
              : <Button size="sm" onClick={bulkArchive} variant="outline" data-testid="bulk-archive"><Archive size={14} /> Arsipkan</Button>}
            <Button size="sm" onClick={bulkRemove} className="bg-red-600 hover:bg-red-700 text-white" data-testid="bulk-delete"><Trash2 size={14} /> Hapus</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} data-testid="bulk-cancel"><X size={14} /></Button>
          </div>
        </div>
      )}

      {mode === "review" && pindahList.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" data-testid="pindah-panel">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-900">Pengajuan ganti penanggung jawab ({pindahList.length})</p>
          <ul className="space-y-2">
            {pindahList.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-emerald-950">{t.nama}</p>
                  <p className="text-[11px] text-emerald-800/70">{anggotaMap[t.pengajuan_pindah.dari_id]?.nama || "-"} → <b>{t.pengajuan_pindah.ke_nama}</b> · diajukan {t.pengajuan_pindah.oleh_nama}: “{t.pengajuan_pindah.alasan}”</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => putuskan(t.id, false)} className="h-8 text-xs" data-testid={`pindah-tolak-${t.id}`}>Tolak</Button>
                <Button size="sm" onClick={() => putuskan(t.id, true)} className="h-8 bg-emerald-800 text-xs text-white hover:bg-emerald-700" data-testid={`pindah-setuju-${t.id}`}>Setujui</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main */}
      {view === "board" && isTim && divisiId !== "ALL" ? (
        <KanbanBoard lists={lists} tasks={filtered} labels={labels} anggotaMap={anggotaMap} arsipMode={arsipMode} divisiId={divisiId}
          selectedIds={selectedIds} setSelectedIds={setSelectedIds}
          onEdit={openEdit} onMove={openMove} onArchive={archive} onUnarchive={unarchive} onDelete={remove}
          onDragEndTask={onDragEndTask} onListsChanged={refreshLists} />
      ) : (
        <TableView tasks={filtered} lists={lists} labels={labels} anggotaAll={anggotaAll} divisiList={divisiList} currentDivisiId={divisiId}
          selectedIds={selectedIds} setSelectedIds={setSelectedIds}
          onSaveCell={saveCell} onSetujui={setujui} onEdit={openEdit} onMove={openMove} onArchive={archive} onUnarchive={unarchive} onDelete={remove}
          onReorderLocal={onReorderLocal} arsipMode={arsipMode} isSpv={isSpv} myAnggotaId={myAnggotaId}
          emptyText={{ saya: "Tidak ada tugas untuk Anda. Alhamdulillah.", review: "Tidak ada hasil yang menunggu review Anda.", berikan: "Anda belum memberikan tugas ke orang lain.", diikuti: "Anda belum dijadikan C atau I di tugas mana pun.", tim: "Tidak ada tugas." }[mode]}
          refreshLists={refreshLists} refreshLabels={refreshLabels} refreshAnggota={refreshAnggota} />
      )}

      <TaskDialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen} form={form} setForm={setForm} onSubmit={submit} editing={!!editing}
        lists={lists} labels={labels} anggotaAll={anggotaAll} divisiList={divisiList} currentDivisiId={divisiId}
        isSpv={isSpv} myAnggotaId={myAnggotaId} editingTask={editing} onRevisi={submitRevisi} onKirimReview={kirimReview} onSetujui={setujui} sasaranList={sasaranList}
        canGantiR={!editing || canGantiR(editing)}
        onNeedMoveConfirm={(targetDivisiId, anggotaNama) => {
          if (!editing) return;
          const nama = divisiList.find((d) => d.id === targetDivisiId)?.nama;
          if (window.confirm(`Anggota "${anggotaNama}" ada di tim "${nama}". Pindahkan tugas ke sana?`)) {
            moveTask(editing.id, { divisi_id: targetDivisiId }).then(refresh);
          }
        }} />
      <MoveTaskDialog open={moveOpen} onOpenChange={setMoveOpen} task={moveTaskState} divisiList={divisiList} allListsMap={allListsMap} refreshLists={refreshAllListsMap} onMoved={refresh} anggotaAll={anggotaAll} canGantiR={canGantiR(moveTaskState)} />
      <BulkMoveDialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen} taskIds={selectedIds} divisiList={divisiList} allListsMap={allListsMap} onDone={() => { setSelectedIds([]); refresh(); }} />
      <DivisiManagerDialog open={divisiMgrOpen} onOpenChange={setDivisiMgrOpen} divisiList={divisiList} onChange={refreshDivisi} />
      <AnggotaManagerDialog open={anggotaMgrOpen} onOpenChange={setAnggotaMgrOpen} anggotaList={anggotaAll} divisiList={divisiList} currentDivisiId={divisiId} onChange={refreshAnggota} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => { refreshDivisi(); refresh(); }} />
      <AnalyticsDialog open={analyticsOpen} onOpenChange={setAnalyticsOpen} divisiId={divisiId} divisiName={divisiList.find((d) => d.id === divisiId)?.nama} />
    </div>
  );
}

function MiniSelect({ value, onChange, options, testId }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}
      className="w-full rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-900 focus:border-emerald-400 focus:outline-none">
      {options.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
    </select>
  );
}

function ImportDialog({ open, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef();

  if (!open) return null;
  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await importExcel(file);
      setResult(r);
      toast.success(`Impor selesai: ${r.imported_tasks} tugas, ${r.imported_amaliyah} amaliyah`);
      onDone();
    } catch (e) { toast.error("Gagal impor: " + (e?.response?.data?.detail || e.message)); }
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => onOpenChange(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-emerald-950">Impor dari Excel</h3>
          <button onClick={() => onOpenChange(false)} className="rounded p-1 hover:bg-emerald-50"><X size={16} /></button>
        </div>
        <p className="text-xs text-emerald-800/70 mb-3">Upload file .xlsx workspace tim. Sheet tugas & amaliyah dideteksi otomatis.</p>
        <label onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-8 text-center transition hover:border-emerald-400">
          <FileUp size={28} className="mb-2 text-emerald-700" />
          <p className="text-sm font-medium text-emerald-950">{file ? file.name : "Klik untuk pilih .xlsx"}</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0]); setResult(null); }} className="hidden" data-testid="file-input" />
        </label>
        {result && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <b>Berhasil!</b> {result.imported_tasks} tugas + {result.imported_amaliyah} amaliyah diimpor.
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
          <Button onClick={upload} disabled={!file || uploading} data-testid="upload-button" className="bg-emerald-900 hover:bg-emerald-800">
            {uploading ? "Memproses..." : "Impor Sekarang"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnalyticsDialog({ open, onOpenChange, divisiId, divisiName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    if (!open || !divisiId) return;
    setLoading(true);
    anggotaAnalytics({ divisi_id: divisiId, month }).then(setData).finally(() => setLoading(false));
  }, [open, divisiId, month]);

  if (!open) return null;
  const max = Math.max(1, ...(data?.anggota || []).map((a) => a.total));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => onOpenChange(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-emerald-950">Leaderboard Anggota</h3>
            <p className="text-xs text-emerald-800/60">Tim: <b>{divisiName}</b></p>
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-emerald-200 px-2 py-1 text-xs" data-testid="analytics-month" />
            <button onClick={() => onOpenChange(false)} className="rounded p-1 hover:bg-emerald-50"><X size={16} /></button>
          </div>
        </div>
        {loading ? <p className="p-8 text-center text-sm text-emerald-800/60">Menghitung...</p>
          : (data?.anggota || []).length === 0 ? <p className="p-8 text-center text-sm text-emerald-800/60">Belum ada anggota atau data bulan ini.</p>
          : (
            <div className="space-y-2" data-testid="analytics-list">
              {(data?.anggota || []).map((a, i) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-emerald-100 p-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full font-bold text-white" style={{ background: a.warna }}>{i + 1}</div>
                  <div className="flex-1">
                    <p className="font-semibold text-emerald-950">{a.nama}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(a.total / max) * 100}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><p className="font-display text-lg font-bold text-emerald-900">{a.total}</p><p className="text-[10px] text-emerald-800/60">Total</p></div>
                    <div><p className="font-display text-lg font-bold text-emerald-700">{a.selesai}</p><p className="text-[10px] text-emerald-800/60">Selesai</p></div>
                    <div><p className="font-display text-lg font-bold text-red-600">{a.terkendala}</p><p className="text-[10px] text-emerald-800/60">Kendala</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
