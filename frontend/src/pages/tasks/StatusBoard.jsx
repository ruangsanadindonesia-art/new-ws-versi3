import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, User } from "lucide-react";
import { PrioritasBadge } from "./dialogs";
import { KontenStatus } from "./shared";

// Kanban berdasarkan STATUS — dipakai di tab lintas tim (Untuk saya, Review, Saya berikan, Diikuti, Semua tim).
export const KOLOM = [
  { k: "BELUM", label: "Belum mulai", status: ["BELUM_MULAI"], cls: "bg-slate-400" },
  { k: "PROSES", label: "Dikerjakan", status: ["DALAM_PROSES", "REVISI", "TERKENDALA"], cls: "bg-sky-500" },
  { k: "REVIEW", label: "Menunggu review", status: ["MENUNGGU_REVIEW"], cls: "bg-violet-500" },
  { k: "SELESAI", label: "Selesai", status: ["SELESAI"], cls: "bg-emerald-500" },
];
const kolomOf = (t) => KOLOM.find((c) => c.status.includes(t.status))?.k || "BELUM";
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function Kartu({ t, anggotaMap, onEdit, onPindah, dragDisabled }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, disabled: dragDisabled || !!t.konten_id });
  const r = anggotaMap[t.penerima_tugas_id];
  const telat = t.deadline && t.status !== "SELESAI" && t.deadline < todayStr();
  const k = kolomOf(t);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }} {...attributes} {...listeners}
      className="rounded-lg border border-emerald-100 bg-white p-2.5 shadow-sm" data-testid={`sb-card-${t.id}`}>
      <button type="button" onClick={() => onEdit(t)} onPointerDown={(e) => e.stopPropagation()} className="block w-full text-left">
        <p className="text-sm font-medium leading-snug text-emerald-950">{t.nama}</p>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {t.konten_id && <KontenStatus t={t} />}
        <PrioritasBadge p={t.prioritas} />
        {t.status === "REVISI" && <span className="rounded bg-red-600 px-1.5 py-px text-[10px] font-bold text-white">REVISI</span>}
        {t.status === "TERKENDALA" && <span className="rounded bg-orange-100 px-1.5 py-px text-[10px] font-semibold text-orange-800">Terkendala</span>}
        {t.deadline && (
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-medium ${telat ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
            <Calendar size={9} />{new Date(`${t.deadline}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}{t.deadline_jam ? ` ${t.deadline_jam}` : ""}{telat ? " · telat" : ""}
          </span>
        )}
        {r && <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-800/70"><User size={9} />{r.nama}</span>}
      </div>
      <select value={k} onChange={(e) => onPindah(t, e.target.value)} onPointerDown={(e) => e.stopPropagation()} aria-label="Pindah ke kolom"
        className="mt-2 w-full rounded-md border border-emerald-100 bg-emerald-50/50 px-1.5 py-1 text-[11px] text-emerald-900 md:hidden" data-testid={`sb-pindah-${t.id}`}>
        {KOLOM.map((c) => <option key={c.k} value={c.k}>{c.k === k ? `Status: ${c.label}` : `Pindah ke ${c.label}`}</option>)}
      </select>
    </div>
  );
}

function Kolom({ c, list, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: c.k });
  return (
    <section ref={setNodeRef} data-testid={`sb-col-${c.k}`}
      className={`flex w-[82vw] shrink-0 snap-start flex-col rounded-xl border bg-emerald-50/40 sm:w-72 md:w-auto md:min-w-0 md:shrink ${isOver ? "border-emerald-400 bg-emerald-50" : "border-emerald-100"}`}>
      <header className="flex items-center gap-2 px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${c.cls}`} />
        <p className="text-sm font-semibold text-emerald-950">{c.label}</p>
        <span className="ml-auto rounded-full bg-white px-2 text-xs tabular-nums text-emerald-800">{list.length}</span>
      </header>
      <div className="flex max-h-[65vh] min-h-[80px] flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

export default function StatusBoard({ tasks, anggotaMap, onEdit, onPindah, arsipMode }) {
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }));
  const onDragEnd = ({ active, over }) => {
    if (!over) return;
    const t = tasks.find((x) => x.id === active.id);
    if (t && kolomOf(t) !== over.id) onPindah(t, over.id);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 md:grid md:grid-cols-4 md:overflow-visible" data-testid="status-board">
        {KOLOM.map((c) => {
          const list = tasks.filter((t) => kolomOf(t) === c.k);
          return (
            <Kolom key={c.k} c={c} list={list}>
              {list.length === 0 ? <p className="px-1 py-3 text-center text-[11px] text-emerald-800/40">Kosong</p>
                : list.map((t) => <Kartu key={t.id} t={t} anggotaMap={anggotaMap} onEdit={onEdit} onPindah={onPindah} dragDisabled={arsipMode} />)}
            </Kolom>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-emerald-800/50 md:hidden">Geser ke samping untuk melihat kolom lain. Ketuk nama tugas untuk membuka.</p>
    </DndContext>
  );
}
