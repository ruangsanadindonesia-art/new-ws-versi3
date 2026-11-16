import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, History, Send } from "lucide-react";
import { formatApiErr } from "@/lib/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createDivisi, updateDivisi, deleteDivisi,
  createTaskList, updateTaskList, deleteTaskList,
  createTaskLabel, updateTaskLabel, deleteTaskLabel,
  createKategori, updateKategori, deleteKategori,
  createAnggota, updateAnggota, deleteAnggota,
  moveTask, bulkMoveTasks, taskActivity, taskAddComment,
} from "@/lib/api";
import { ColorPicker, KATEGORI_LABEL, TIPES } from "./shared";
import { RACI, RoleTag, raciRoles, PersonSelect, PeopleSelect, RaciLegend } from "./raci";

const STATUS_LABELS = { BELUM_MULAI: "Belum Mulai", DALAM_PROSES: "Dalam Proses", MENUNGGU_REVIEW: "Menunggu review", REVISI: "Revisi", TERKENDALA: "Terkendala", SELESAI: "Selesai" };

// ============ TASK DIALOG ============
export function TaskDialog({ open, onOpenChange, form, setForm, onSubmit, editing, lists, labels, anggotaAll, divisiList, isSpv = true, myAnggotaId = null, editingTask = null, onRevisi = null, onKirimReview = null, onSetujui = null, sasaranList = [] }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const [revisiNote, setRevisiNote] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const toggleLabel = (id) => {
    const has = (form.label_ids || []).includes(id);
    setForm({ ...form, label_ids: has ? form.label_ids.filter((x) => x !== id) : [...(form.label_ids || []), id] });
  };
  const isRutin = form.kategori !== "PROJECT";

  // Hak per peran RACI. A (atau SPV) mengatur definisi tugas & RACI; R mengerjakan (status, kolom, hasil).
  const myRoles = editing ? raciRoles(editingTask, myAnggotaId) : ["R", "A"];
  const isA = myRoles.includes("A"), isR = myRoles.includes("R");
  const canDef = !editing || isSpv || isA;
  const canWork = !editing || isSpv || isR;
  const isMonitorOnly = editing && !canDef && !canWork; // Consulted / Informed
  const canFillHasil = editing && canWork;
  const pemberiAnggota = editingTask?.pemberi_id ? anggotaAll.find((a) => a.id === editingTask.pemberi_id) : null;
  const status = editingTask?.status;
  const needsReview = !!(editingTask?.pemberi_id && editingTask.pemberi_id !== editingTask.penerima_tugas_id);
  const canApprove = editing && (isSpv || isA) && status === "MENUNGGU_REVIEW";
  const canRevisi = editing && onRevisi && (isSpv || isA) && status !== "SELESAI";
  const canSubmitReview = editing && (isSpv || isR) && needsReview && !["MENUNGGU_REVIEW", "SELESAI"].includes(status) && !isA;
  const raciExclude = [form.penerima_tugas_id, form.pemberi_id].filter(Boolean);
  // R pada tugas yang wajib review tidak memilih "Selesai" sendiri — pakai tombol Kirim untuk review.
  const statusOptions = Object.entries(STATUS_LABELS).filter(([v]) =>
    v === form.status || isSpv || (v !== "MENUNGGU_REVIEW" && !(v === "SELESAI" && needsReview && !isA)));
  const detailCount = [form.tanggal_mulai, (form.label_ids || []).length, form.catatan_spv, isRutin, form.sasaran_id].filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setShowDetail(false); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="task-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editing ? "Ubah Tugas" : "Tugas Baru"}
            {editing && myRoles.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-emerald-800/70">
                Peran Anda: {myRoles.map((r) => <RoleTag key={r} role={r} />)}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">Formulir membuat atau mengubah tugas, termasuk peran RACI, brief, dan hasil.</DialogDescription>
        </DialogHeader>
        {isMonitorOnly && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            Anda <b>{myRoles.includes("C") ? "Consulted (C)" : "Informed (I)"}</b> di tugas ini: bisa melihat perkembangan{myRoles.includes("C") ? " dan memberi masukan lewat komentar" : ""}. Perubahan dilakukan oleh R (mengerjakan) atau A (penanggung jawab).
          </div>
        )}
        {editing && status === "MENUNGGU_REVIEW" && (
          <div className="rounded-md border border-violet-300 bg-violet-50 p-2.5 text-xs text-violet-900" data-testid="review-banner">
            {canApprove ? <>Hasil sudah dikirim R. Periksa hasil di bawah, lalu <b>Setujui</b> atau <b>Minta revisi</b>.</>
              : <>Menunggu review dari <b>{pemberiAnggota?.nama || "A"}</b>.</>}
          </div>
        )}
        <fieldset disabled={isMonitorOnly} className={isMonitorOnly ? "opacity-90" : ""}>
        <div className="space-y-3">
          {editing && !isMonitorOnly && status === "REVISI" && editingTask?.revisi_catatan && (
            <div data-testid="revisi-banner" className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              <p className="font-semibold">Revisi{pemberiAnggota ? ` dari ${pemberiAnggota.nama}` : ""}{editingTask.revisi_count > 1 ? ` (ke-${editingTask.revisi_count})` : ""}:</p>
              <p className="mt-1">{editingTask.revisi_catatan}</p>
              <p className="mt-1 text-[10px] text-red-700/70">Perbaiki hasil, lalu kirim lagi untuk review.</p>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-emerald-900">Nama Tugas *</label>
            <Input data-testid="input-nama" value={form.nama} onChange={set("nama")} placeholder="contoh: Rekap konten pekan ini" disabled={!canDef} />
          </div>

          <div className="rounded-lg border border-emerald-200 p-3" data-testid="raci-section">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Peran (RACI)</p>
              <RaciLegend />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-900"><RoleTag role="R" /> {RACI.R.nama} <span className="font-normal text-emerald-800/50">· mengerjakan</span></label>
                <PersonSelect value={form.penerima_tugas_id} onChange={(v) => setForm({ ...form, penerima_tugas_id: v, consulted_ids: (form.consulted_ids || []).filter((x) => x !== v), informed_ids: (form.informed_ids || []).filter((x) => x !== v) })}
                  anggotaAll={anggotaAll} divisiList={divisiList} disabled={!canDef} placeholder="Pilih yang mengerjakan" testId="select-raci-r" />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-900"><RoleTag role="A" /> {RACI.A.nama} <span className="font-normal text-emerald-800/50">· menyetujui</span></label>
                <PersonSelect value={form.pemberi_id} onChange={(v) => setForm({ ...form, pemberi_id: v, consulted_ids: (form.consulted_ids || []).filter((x) => x !== v), informed_ids: (form.informed_ids || []).filter((x) => x !== v) })}
                  anggotaAll={anggotaAll} divisiList={divisiList} disabled={!canDef} placeholder="Pilih penanggung jawab" testId="select-raci-a" />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-900"><RoleTag role="C" /> {RACI.C.nama} <span className="font-normal text-emerald-800/50">· opsional</span></label>
                <PeopleSelect value={form.consulted_ids || []} onChange={(v) => setForm({ ...form, consulted_ids: v, informed_ids: (form.informed_ids || []).filter((x) => !v.includes(x)) })}
                  anggotaAll={anggotaAll} divisiList={divisiList} exclude={raciExclude} disabled={!canDef} testId="select-raci-c" />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-900"><RoleTag role="I" /> {RACI.I.nama} <span className="font-normal text-emerald-800/50">· opsional</span></label>
                <PeopleSelect value={form.informed_ids || []} onChange={(v) => setForm({ ...form, informed_ids: v, consulted_ids: (form.consulted_ids || []).filter((x) => !v.includes(x)) })}
                  anggotaAll={anggotaAll} divisiList={divisiList} exclude={[...raciExclude, ...(form.consulted_ids || [])]} disabled={!canDef} testId="select-raci-i" />
              </div>
            </div>
            {!editing && <p className="mt-2 text-[10px] text-emerald-700/70">R dan A otomatis Anda sendiri. Ganti R untuk langsung menugaskan orang lain. Jika R berbeda dari A, hasil harus disetujui A sebelum Selesai.</p>}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!isRutin && (
              <div>
                <label className="text-xs font-medium text-emerald-900">Deadline</label>
                <Input type="date" value={form.deadline || ""} onChange={set("deadline")} data-testid="input-deadline" disabled={!canDef} />
              </div>
            )}
            {editing && (
              <div>
                <label className="text-xs font-medium text-emerald-900">Status</label>
                <Select value={form.status} onValueChange={set("status")} disabled={!canWork}>
                  <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-emerald-900">Instruksi <span className="text-emerald-700/50">(dari A)</span></label>
            <Textarea rows={2} value={form.catatan_tim || ""} onChange={set("catatan_tim")} placeholder="Apa yang perlu dikerjakan, standar hasil, catatan penting…" disabled={!canDef} data-testid="input-instruksi" />
          </div>
          <div>
            <label className="text-xs font-medium text-emerald-900">Brief / Link Referensi <span className="text-emerald-700/50">(opsional)</span></label>
            <Input value={form.brief_link || ""} onChange={set("brief_link")} placeholder="https://docs.google.com/..." data-testid="input-brief-link" disabled={!canDef} />
          </div>
          {editing && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Hasil Tugas {canFillHasil ? <span className="text-[10px] font-normal normal-case text-emerald-700/70">(diisi oleh R)</span> : <span className="text-[10px] font-normal normal-case text-amber-700">(hanya R yang bisa mengisi)</span>}
              </p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium text-emerald-900">Link Hasil</label>
                  <Input value={form.hasil_link || ""} onChange={set("hasil_link")} placeholder="https://drive.google.com/..." disabled={!canFillHasil} data-testid="input-hasil-link" />
                </div>
                <div>
                  <label className="text-xs font-medium text-emerald-900">Catatan Hasil</label>
                  <Textarea rows={2} value={form.hasil_catatan || ""} onChange={set("hasil_catatan")} placeholder="Ringkasan hasil, kendala, hal yang perlu diperhatikan A…" disabled={!canFillHasil} data-testid="input-hasil-catatan" />
                </div>
              </div>
            </div>
          )}

          <button type="button" onClick={() => setShowDetail((v) => !v)} data-testid="toggle-detail"
            className="flex w-full items-center justify-between rounded-md border border-dashed border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50">
            <span>Detail lainnya{detailCount ? ` (${detailCount} terisi)` : ""} — objective (OKR), tipe, kolom, tanggal mulai, label{isSpv && editing ? ", catatan SPV" : ""}</span>
            <span>{showDetail ? "Tutup" : "Buka"}</span>
          </button>
          {showDetail && (
            <div className="space-y-3 rounded-lg bg-emerald-50/40 p-3" data-testid="detail-section">
              <div>
                <label className="text-xs font-medium text-emerald-900" htmlFor="tk-sasaran">Mendukung objective (OKR) <span className="text-emerald-700/50">(opsional)</span></label>
                <select id="tk-sasaran" value={form.sasaran_id || ""} onChange={(e) => setForm({ ...form, sasaran_id: e.target.value })} disabled={!canDef}
                  data-testid="select-sasaran" className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm disabled:opacity-60">
                  <option value="">— Tidak terkait objective —</option>
                  {sasaranList.map((s) => <option key={s.id} value={s.id}>{s.tim} · {s.judul}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-emerald-900">Tipe Tugas</label>
                <Select value={form.kategori} onValueChange={set("kategori")} disabled={!canDef}>
                  <SelectTrigger data-testid="select-tipe"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPES.map((k) => <SelectItem key={k} value={k}>{KATEGORI_LABEL[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isRutin && <p className="mt-1 text-[10px] text-emerald-700/70">Tugas rutin muncul di <b>Harian Saya › Tugas rutin</b>.</p>}
              </div>
              {!isRutin && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-emerald-900">Kolom Kanban</label>
                    <Select value={form.list_id || "none"} onValueChange={(v) => setForm({ ...form, list_id: v === "none" ? null : v })} disabled={!canWork}>
                      <SelectTrigger data-testid="select-list"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Tanpa kolom</SelectItem>
                        {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.nama}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-emerald-900">Tanggal Mulai</label>
                    <Input type="date" value={form.tanggal_mulai || ""} onChange={set("tanggal_mulai")} data-testid="input-mulai" disabled={!canWork && !canDef} />
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-emerald-900">Label</label>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-emerald-100 bg-white p-2">
                  {labels.length === 0 && <span className="text-xs text-emerald-700/60">Belum ada label.</span>}
                  {labels.map((l) => {
                    const active = (form.label_ids || []).includes(l.id);
                    return (
                      <button key={l.id} type="button" onClick={() => toggleLabel(l.id)} data-testid={`label-toggle-${l.id}`}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white transition ${active ? "ring-2 ring-offset-1 ring-emerald-900" : "opacity-60 hover:opacity-100"}`}
                        style={{ background: l.warna }}>{l.nama}</button>
                    );
                  })}
                </div>
              </div>
              {editing && isSpv && (
                <div>
                  <label className="text-xs font-medium text-emerald-900">Catatan SPV</label>
                  <Textarea rows={2} value={form.catatan_spv || ""} onChange={set("catatan_spv")} data-testid="input-catatan-spv" />
                </div>
              )}
            </div>
          )}
        </div>
        </fieldset>
        {editing && editingTask?.id && <ActivityPanel taskId={editingTask.id} canComment={isSpv || myRoles.some((r) => r !== "I") || myRoles.length === 0} />}

        {canRevisi && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 p-3" data-testid="revisi-box">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-800">Minta Revisi</p>
            {editingTask?.revisi_catatan && (
              <p className="mb-2 text-[10px] text-red-700/70">
                Revisi terakhir{editingTask.revisi_count ? ` (total ${editingTask.revisi_count}x)` : ""}: {editingTask.revisi_catatan}
              </p>
            )}
            <Textarea rows={2} value={revisiNote} onChange={(e) => setRevisiNote(e.target.value)}
              placeholder="Tulis apa yang perlu diperbaiki R…" data-testid="input-revisi-catatan" />
            <Button onClick={() => { onRevisi(editingTask.id, revisiNote); setRevisiNote(""); }} disabled={!revisiNote.trim()}
              data-testid="submit-revisi" className="mt-2 bg-red-600 text-white hover:bg-red-700">
              Kirim permintaan revisi
            </Button>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isMonitorOnly ? "Tutup" : "Batal"}</Button>
          {canSubmitReview && onKirimReview && (
            <Button variant="outline" onClick={async () => { try { await onSubmit({ keepOpen: true }); } catch { return; } onKirimReview(editingTask.id); }} data-testid="submit-review"
              className="border-violet-300 text-violet-800 hover:bg-violet-50">Simpan &amp; kirim untuk review</Button>
          )}
          {canApprove && onSetujui && (
            <Button onClick={() => onSetujui(editingTask.id)} data-testid="approve-task" className="bg-emerald-700 text-white hover:bg-emerald-800">Setujui hasil</Button>
          )}
          {!isMonitorOnly && (
            <Button onClick={() => onSubmit().catch(() => {})} data-testid="submit-task" className="bg-emerald-900 hover:bg-emerald-800">
              {editing ? "Simpan" : "Tambah Tugas"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND_META = {
  create: { label: "membuat tugas", cls: "text-emerald-700" },
  status: { label: "mengubah status", cls: "text-sky-700" },
  revisi: { label: "meminta revisi", cls: "text-red-700" },
  move: { label: "memindahkan tugas", cls: "text-amber-700" },
  review: { label: "mengirim untuk review", cls: "text-violet-700" },
  approve: { label: "menyetujui hasil", cls: "text-emerald-700" },
  comment: { label: "berkomentar", cls: "text-emerald-900" },
  raci: { label: "mengatur peran RACI", cls: "text-sky-700" },
  hasil: { label: "memperbarui hasil", cls: "text-emerald-700" },
};

function ActivityPanel({ taskId, canComment = true }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const load = () => { taskActivity(taskId).then((r) => { setItems(r); setErr(""); }).catch((e) => setErr(formatApiErr(e))).finally(() => setLoading(false)); };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [taskId]);
  const send = async () => {
    if (!text.trim()) return;
    try { await taskAddComment(taskId, text.trim()); setText(""); load(); }
    catch (e) { toast.error(formatApiErr(e) || "Gagal mengirim komentar"); }
  };
  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-3" data-testid="task-activity">
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-800"><History size={13} /> Komentar &amp; Riwayat Aktivitas</p>
      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {loading ? <p className="text-xs text-emerald-800/50">Memuat…</p> :
          err ? <p className="text-xs italic text-red-600">{err}</p> :
          items.length === 0 ? <p className="text-xs italic text-emerald-800/50">Belum ada aktivitas.</p> :
          items.map((it) => {
            const m = KIND_META[it.kind] || KIND_META.comment;
            return (
              <div key={it.id} className="flex gap-2 text-xs" data-testid="activity-item">
                <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${it.kind === "comment" ? "bg-emerald-500" : "bg-slate-300"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-emerald-950"><b>{it.actor_name}</b> <span className={m.cls}>{m.label}</span></p>
                  {it.kind === "comment" && it.text && <p className="mt-0.5 rounded bg-emerald-50 px-2 py-1 text-emerald-900">{it.text}</p>}
                  {it.kind !== "comment" && it.text && <p className="text-emerald-800/70">{it.text}</p>}
                  <p className="mt-0.5 text-[10px] text-emerald-800/40">{new Date(it.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </div>
            );
          })}
      </div>
      {canComment ? <div className="mt-2 flex items-center gap-1">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Tulis komentar…" className="h-8 text-xs" data-testid="comment-input" />
        <Button size="sm" onClick={send} className="h-8 shrink-0 bg-emerald-900 px-2.5 text-white hover:bg-emerald-800" data-testid="comment-send"><Send size={13} /></Button>
      </div> : <p className="mt-2 text-[10px] italic text-emerald-800/50">Peran Informed hanya bisa melihat.</p>}
    </div>
  );
}

// ============ MOVE TASK DIALOG (single) ============
export function MoveTaskDialog({ open, onOpenChange, task, divisiList, allListsMap, refreshLists, onMoved, anggotaAll = [] }) {
  const [targetDivisi, setTargetDivisi] = useState("");
  const [targetList, setTargetList] = useState("");
  const [targetPenerima, setTargetPenerima] = useState("keep");
  const [posisi, setPosisi] = useState(1);
  const [newListName, setNewListName] = useState("");
  const [showNewList, setShowNewList] = useState(false);

  useEffect(() => {
    if (task) {
      setTargetDivisi(task.divisi_id || "");
      setTargetList("");
      setTargetPenerima("keep");
      setPosisi(1);
      setShowNewList(false);
    }
  }, [task]);

  const targetLists = allListsMap[targetDivisi] || [];

  const buatListBaru = async () => {
    if (!newListName.trim() || !targetDivisi) return toast.error("Nama list wajib");
    const l = await createTaskList({ nama: newListName.trim(), divisi_id: targetDivisi });
    setTargetList(l.id);
    setNewListName("");
    setShowNewList(false);
    await refreshLists();
    toast.success("List baru dibuat");
  };

  const pindahkan = async () => {
    if (!task) return;
    if (!targetDivisi) return toast.error("Pilih tim tujuan");
    try {
      const payload = {
        divisi_id: targetDivisi,
        list_id: targetList || null,
        urutan: Math.max(1, parseInt(posisi, 10) || 1),
      };
      if (targetPenerima && targetPenerima !== "keep") payload.penerima_tugas_id = targetPenerima;
      await moveTask(task.id, payload);
      const penerimaBaru = targetPenerima !== "keep" ? anggotaAll.find((a) => a.id === targetPenerima) : null;
      toast.success(penerimaBaru
        ? `Tugas dipindahkan ke ${penerimaBaru.nama}`
        : `Tugas dipindahkan ke ${divisiList.find((d) => d.id === targetDivisi)?.nama}`);
      onOpenChange(false);
      onMoved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Gagal memindahkan"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="move-dialog">
        <DialogHeader><DialogTitle className="font-display text-lg">Pindahkan Tugas</DialogTitle></DialogHeader>
        <p className="text-sm text-emerald-800/80"><b>{task?.nama}</b></p>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-emerald-800/70">PILIH TIM</label>
            <Select value={targetDivisi} onValueChange={(v) => { setTargetDivisi(v); setTargetList(""); }}>
              <SelectTrigger data-testid="move-select-divisi"><SelectValue placeholder="Pilih tim..." /></SelectTrigger>
              <SelectContent>
                {divisiList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: d.warna }} />{d.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-emerald-800/70">PENERIMA BARU (OPSIONAL)</label>
            <Select value={targetPenerima} onValueChange={setTargetPenerima}>
              <SelectTrigger data-testid="move-select-penerima"><SelectValue placeholder="Tetap" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="keep">— Tetap (tidak berubah) —</SelectItem>
                {divisiList.map((d) => {
                  const arr = anggotaAll.filter((a) => a.divisi_id === d.id);
                  if (arr.length === 0) return null;
                  return (
                    <SelectGroup key={d.id}>
                      <SelectLabel className="text-[10px] uppercase text-emerald-800/60">{d.nama}</SelectLabel>
                      {arr.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: a.warna }} />{a.nama}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-emerald-700/60">
              Bisa pindah ke <b>perorangan lintas divisi</b> — tugas tetap tampil di workspace Anda sebagai monitor.
            </p>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-emerald-800/70">PILIH LIST TUJUAN</label>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div>
                <p className="text-[10px] uppercase text-emerald-700/60">List</p>
                <Select value={targetList || "none"} onValueChange={(v) => setTargetList(v === "none" ? "" : v)} disabled={!targetDivisi}>
                  <SelectTrigger data-testid="move-select-list"><SelectValue placeholder="Pilih list..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa list</SelectItem>
                    {targetLists.map((l) => <SelectItem key={l.id} value={l.id}>{l.nama}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[10px] uppercase text-emerald-700/60">Posisi</p>
                <Input type="number" min={1} value={posisi} onChange={(e) => setPosisi(e.target.value)} data-testid="move-posisi" />
              </div>
            </div>
          </div>
          {showNewList && (
            <div className="rounded-md border border-dashed border-emerald-300 bg-emerald-50/50 p-2">
              <div className="flex gap-2">
                <Input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Nama list baru" data-testid="move-newlist-name" />
                <Button size="sm" onClick={buatListBaru} className="bg-emerald-700 hover:bg-emerald-800">Simpan</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewList(false)}><X size={14} /></Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button onClick={pindahkan} data-testid="move-submit" className="bg-emerald-600 text-white hover:bg-emerald-700">Pindahkan</Button>
          <Button variant="outline" onClick={() => setShowNewList(true)} data-testid="move-newlist-btn" className="border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100">Buat List</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ BULK MOVE DIALOG ============
export function BulkMoveDialog({ open, onOpenChange, taskIds, divisiList, allListsMap, onDone }) {
  const [targetDivisi, setTargetDivisi] = useState("");
  const [targetList, setTargetList] = useState("");
  const targetLists = allListsMap[targetDivisi] || [];

  const submit = async () => {
    if (!targetDivisi) return toast.error("Pilih tim tujuan");
    try {
      await bulkMoveTasks({ ids: taskIds, divisi_id: targetDivisi, list_id: targetList || null });
      toast.success(`${taskIds.length} tugas dipindahkan`);
      onOpenChange(false);
      onDone();
    } catch { toast.error("Gagal"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-lg">Pindahkan {taskIds.length} Tugas</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-emerald-800/70">PILIH TIM</label>
            <Select value={targetDivisi} onValueChange={(v) => { setTargetDivisi(v); setTargetList(""); }}>
              <SelectTrigger data-testid="bulk-move-divisi"><SelectValue placeholder="Pilih tim..." /></SelectTrigger>
              <SelectContent>
                {divisiList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-emerald-800/70">PILIH LIST TUJUAN</label>
            <Select value={targetList || "none"} onValueChange={(v) => setTargetList(v === "none" ? "" : v)} disabled={!targetDivisi}>
              <SelectTrigger data-testid="bulk-move-list"><SelectValue placeholder="Pilih list..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa list</SelectItem>
                {targetLists.map((l) => <SelectItem key={l.id} value={l.id}>{l.nama}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} data-testid="bulk-move-submit" className="bg-emerald-700 hover:bg-emerald-800">Pindahkan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ GENERIC ENTITY MANAGER ============
function GenericManager({ open, onOpenChange, title, items, onCreate, onUpdate, onDelete, colorful = true, extraCreateFields = null, hint = null }) {
  const [nama, setNama] = useState("");
  const [warna, setWarna] = useState("#10b981");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 rounded border border-emerald-100 p-2">
              {colorful && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="h-6 w-6 rounded" style={{ background: it.warna }} />
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2">
                    <ColorPicker value={it.warna} onChange={(c) => onUpdate(it, { warna: c })} />
                  </PopoverContent>
                </Popover>
              )}
              <Input className="flex-1" defaultValue={it.nama}
                onBlur={(e) => e.target.value !== it.nama && onUpdate(it, { nama: e.target.value })} />
              <button onClick={() => onDelete(it.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
            </div>
          ))}
          {items.length === 0 && <p className="text-center text-xs text-emerald-800/60 py-4">Belum ada. Tambahkan di bawah.</p>}
          <div className="rounded-lg border border-dashed border-emerald-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {colorful && (
                <Popover>
                  <PopoverTrigger asChild><button className="h-8 w-8 rounded" style={{ background: warna }} /></PopoverTrigger>
                  <PopoverContent className="w-64 p-2"><ColorPicker value={warna} onChange={setWarna} /></PopoverContent>
                </Popover>
              )}
              <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama..." className="flex-1" />
              {extraCreateFields}
              <Button size="sm" onClick={() => { if (nama.trim()) { onCreate({ nama, warna }); setNama(""); } }} className="bg-emerald-900 hover:bg-emerald-800">
                <Plus size={13} /> Tambah
              </Button>
            </div>
            {hint && <p className="mt-2 text-[10px] text-emerald-700/70">{hint}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ KATEGORI MANAGER ============
export function KategoriManagerDialog({ open, onOpenChange, kategoriList, onChange }) {
  const create = async ({ nama, warna }) => { await createKategori({ nama: nama.trim(), warna }); onChange(); toast.success("Kategori ditambahkan"); };
  const update = async (it, patch) => { await updateKategori(it.id, { nama: patch.nama ?? it.nama, warna: patch.warna ?? it.warna }); onChange(); };
  const remove = async (id) => { if (!window.confirm("Hapus kategori dari semua tugas?")) return; await deleteKategori(id); onChange(); toast.success("Dihapus"); };
  return <GenericManager open={open} onOpenChange={onOpenChange} title="Kelola Kategori Tugas" items={kategoriList} onCreate={create} onUpdate={update} onDelete={remove} hint="Kategori bebas — misalnya Konten, Design, Meeting, Operasional." />;
}

// ============ DIVISI MANAGER ============
export function DivisiManagerDialog({ open, onOpenChange, divisiList, onChange }) {
  const create = async ({ nama, warna }) => { await createDivisi({ nama: nama.trim(), warna }); onChange(); toast.success("Tim ditambahkan"); };
  const update = async (it, patch) => { await updateDivisi(it.id, { nama: patch.nama ?? it.nama, warna: patch.warna ?? it.warna }); onChange(); };
  const remove = async (id) => {
    if (!window.confirm("Hapus tim ini? Tugas & list akan pindah ke tim pertama.")) return;
    try { await deleteDivisi(id); onChange(); toast.success("Tim dihapus"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Gagal"); }
  };
  return <GenericManager open={open} onOpenChange={onOpenChange} title="Kelola Tim / Divisi" items={divisiList} onCreate={create} onUpdate={update} onDelete={remove} hint="Tim baru otomatis dapat 3 list default: Backlog, Dikerjakan, Selesai." />;
}

// ============ ANGGOTA MANAGER ============
export function AnggotaManagerDialog({ open, onOpenChange, anggotaList, divisiList, currentDivisiId, onChange }) {
  const [nama, setNama] = useState("");
  const [warna, setWarna] = useState("#0ea5e9");
  const [divisiId, setDivisiId] = useState(currentDivisiId);

  useEffect(() => { if (currentDivisiId) setDivisiId(currentDivisiId); }, [currentDivisiId]);

  const create = async () => {
    if (!nama.trim() || !divisiId) return toast.error("Nama & tim wajib");
    await createAnggota({ nama: nama.trim(), warna, divisi_id: divisiId });
    setNama(""); onChange(); toast.success("Anggota ditambahkan");
  };
  const update = async (id, patch) => { await updateAnggota(id, patch); onChange(); };
  const remove = async (id) => { if (!window.confirm("Hapus anggota ini?")) return; await deleteAnggota(id); onChange(); toast.success("Dihapus"); };

  const grouped = {};
  anggotaList.forEach((a) => { const k = a.divisi_id; if (!grouped[k]) grouped[k] = []; grouped[k].push(a); });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Kelola Anggota Tim</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {divisiList.map((d) => {
            const members = grouped[d.id] || [];
            return (
              <div key={d.id} className="rounded-lg border border-emerald-100 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.warna }} />
                  <span className="font-display text-sm font-semibold text-emerald-950">{d.nama}</span>
                  <span className="text-xs text-emerald-700/60">({members.length})</span>
                </div>
                <div className="space-y-1.5">
                  {members.map((a) => (
                    <div key={a.id} className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild><button className="h-5 w-5 rounded" style={{ background: a.warna }} /></PopoverTrigger>
                        <PopoverContent className="w-64 p-2"><ColorPicker value={a.warna} onChange={(c) => update(a.id, { nama: a.nama, warna: c, divisi_id: a.divisi_id })} /></PopoverContent>
                      </Popover>
                      <Input className="flex-1 h-8" defaultValue={a.nama}
                        onBlur={(e) => e.target.value !== a.nama && update(a.id, { nama: e.target.value, warna: a.warna, divisi_id: a.divisi_id })} />
                      <button onClick={() => remove(a.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {members.length === 0 && <p className="text-[11px] text-emerald-800/50">Belum ada anggota</p>}
                </div>
              </div>
            );
          })}
          <div className="rounded-lg border border-dashed border-emerald-200 p-3">
            <p className="mb-2 text-xs font-semibold text-emerald-900">Tambah Anggota Baru</p>
            <div className="grid gap-2">
              <Select value={divisiId} onValueChange={setDivisiId}>
                <SelectTrigger data-testid="anggota-divisi-select"><SelectValue placeholder="Pilih tim..." /></SelectTrigger>
                <SelectContent>
                  {divisiList.map((d) => <SelectItem key={d.id} value={d.id}>{d.nama}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild><button className="h-8 w-8 rounded" style={{ background: warna }} /></PopoverTrigger>
                  <PopoverContent className="w-64 p-2"><ColorPicker value={warna} onChange={setWarna} /></PopoverContent>
                </Popover>
                <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama anggota" className="flex-1" data-testid="input-anggota-nama" />
                <Button size="sm" onClick={create} data-testid="add-anggota-btn" className="bg-emerald-900 hover:bg-emerald-800"><Plus size={13} /> Tambah</Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ LIST MANAGER ============
export function ListManagerDialog({ open, onOpenChange, lists, divisiId, onChange }) {
  const [nama, setNama] = useState("");
  const [warna, setWarna] = useState("#10b981");
  const [isDone, setIsDone] = useState(false);

  const create = async () => {
    if (!nama.trim()) return toast.error("Nama list wajib");
    await createTaskList({ nama, warna, is_done: isDone, divisi_id: divisiId });
    setNama(""); onChange(); toast.success("List ditambahkan");
  };
  const update = async (id, patch) => { await updateTaskList(id, patch); onChange(); };
  const remove = async (id) => { if (!window.confirm("Hapus list ini? Tugas di dalamnya tidak terhapus.")) return; await deleteTaskList(id); onChange(); toast.success("Dihapus"); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Kelola List (Kolom Kanban)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {lists.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded border border-emerald-100 p-2">
              <Popover>
                <PopoverTrigger asChild><button className="h-6 w-6 rounded" style={{ background: l.warna }} /></PopoverTrigger>
                <PopoverContent className="w-64 p-2"><ColorPicker value={l.warna} onChange={(c) => update(l.id, { nama: l.nama, warna: c, is_done: l.is_done, divisi_id: l.divisi_id })} /></PopoverContent>
              </Popover>
              <Input className="flex-1" defaultValue={l.nama}
                onBlur={(e) => e.target.value !== l.nama && update(l.id, { nama: e.target.value, warna: l.warna, is_done: l.is_done, divisi_id: l.divisi_id })} />
              <label className="flex items-center gap-1 text-[10px] text-emerald-800">
                <input type="checkbox" checked={l.is_done || false}
                  onChange={(e) => update(l.id, { nama: l.nama, warna: l.warna, is_done: e.target.checked, divisi_id: l.divisi_id })} /> Selesai
              </label>
              <button onClick={() => remove(l.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-emerald-200 p-3">
            <p className="mb-2 text-xs font-semibold text-emerald-900">Tambah List Baru</p>
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild><button className="h-8 w-8 rounded" style={{ background: warna }} /></PopoverTrigger>
                <PopoverContent className="w-64 p-2"><ColorPicker value={warna} onChange={setWarna} /></PopoverContent>
              </Popover>
              <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama list" className="flex-1" data-testid="input-list-nama" />
              <label className="flex items-center gap-1 text-xs text-emerald-800">
                <input type="checkbox" checked={isDone} onChange={(e) => setIsDone(e.target.checked)} /> Selesai
              </label>
              <Button size="sm" onClick={create} data-testid="add-list-btn" className="bg-emerald-900 hover:bg-emerald-800">Tambah</Button>
            </div>
            <p className="mt-2 text-[10px] text-emerald-700/70">
              List "Selesai" otomatis mengubah status tugas menjadi SELESAI saat card di-drag ke sana.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ LABEL MANAGER ============
export function LabelManagerDialog({ open, onOpenChange, labels, onChange }) {
  const create = async ({ nama, warna }) => { await createTaskLabel({ nama: nama.trim(), warna }); onChange(); toast.success("Label ditambahkan"); };
  const update = async (it, patch) => { await updateTaskLabel(it.id, { nama: patch.nama ?? it.nama, warna: patch.warna ?? it.warna }); onChange(); };
  const remove = async (id) => { if (!window.confirm("Hapus label dari semua tugas?")) return; await deleteTaskLabel(id); onChange(); toast.success("Dihapus"); };
  return <GenericManager open={open} onOpenChange={onOpenChange} title="Kelola Label" items={labels} onCreate={create} onUpdate={update} onDelete={remove} />;
}
