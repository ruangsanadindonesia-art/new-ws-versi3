import { useState } from "react";
import { Check, X, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// R = penerima_tugas_id, A = pemberi_id, C = consulted_ids, I = informed_ids
export const RACI = {
  R: { short: "R", nama: "Responsible", arti: "Mengerjakan tugas (1 orang)", cls: "bg-emerald-700 text-white" },
  A: { short: "A", nama: "Accountable", arti: "Penanggung jawab akhir, menyetujui hasil (1 orang)", cls: "bg-sky-700 text-white" },
  C: { short: "C", nama: "Consulted", arti: "Dimintai masukan; bisa melihat & berkomentar", cls: "bg-amber-500 text-white" },
  I: { short: "I", nama: "Informed", arti: "Diberi kabar perkembangan; hanya melihat", cls: "bg-slate-500 text-white" },
};

export function raciRoles(task, myAnggotaId) {
  const r = [];
  if (!task || !myAnggotaId) return r;
  if (task.penerima_tugas_id === myAnggotaId) r.push("R");
  if (task.pemberi_id === myAnggotaId) r.push("A");
  if ((task.consulted_ids || []).includes(myAnggotaId)) r.push("C");
  if ((task.informed_ids || []).includes(myAnggotaId)) r.push("I");
  return r;
}

export function RoleTag({ role, title }) {
  const m = RACI[role];
  return (
    <span title={title || `${m.nama}: ${m.arti}`}
      className={`inline-grid h-4 min-w-[16px] place-items-center rounded px-1 text-[9px] font-bold ${m.cls}`}>{m.short}</span>
  );
}

export function PersonChip({ a, muted = false }) {
  if (!a) return <span className="text-xs text-emerald-800/35">—</span>;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 text-xs ${muted ? "text-emerald-800/70" : "text-emerald-950"}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: a.warna }} />
      <span className="truncate">{a.nama}</span>
    </span>
  );
}

function grouped(anggotaAll, divisiList, exclude = []) {
  const by = {};
  anggotaAll.forEach((a) => { if (exclude.includes(a.id)) return; (by[a.divisi_id] = by[a.divisi_id] || []).push(a); });
  return divisiList.map((d) => ({ d, items: by[d.id] || [] })).filter((g) => g.items.length);
}

// Pilih satu orang (R atau A)
export function PersonSelect({ value, onChange, anggotaAll, divisiList, disabled, placeholder = "Pilih…", testId, compact = false }) {
  const [open, setOpen] = useState(false);
  const cur = anggotaAll.find((a) => a.id === value);
  const trigger = compact
    ? "w-full rounded px-2 py-1 text-left hover:bg-emerald-50 disabled:cursor-default disabled:hover:bg-transparent"
    : "flex h-9 w-full items-center rounded-md border border-input bg-white px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={trigger} data-testid={testId}>
          {cur ? <PersonChip a={cur} /> : <span className="text-xs text-emerald-800/40">{placeholder}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1" align="start">
        <div className="max-h-64 overflow-auto">
          {grouped(anggotaAll, divisiList).map(({ d, items }) => (
            <div key={d.id}>
              <p className="mt-1 px-2 text-[9px] font-semibold uppercase text-emerald-800/50">{d.nama}</p>
              {items.map((a) => (
                <button type="button" key={a.id} onClick={() => { onChange(a.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-emerald-50">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.warna }} />
                  <span className="flex-1">{a.nama}</span>
                  {value === a.id && <Check size={12} className="text-emerald-700" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Pilih banyak orang (C atau I)
export function PeopleSelect({ value = [], onChange, anggotaAll, divisiList, exclude = [], disabled, placeholder = "Tambah…", testId, compact = false }) {
  const [open, setOpen] = useState(false);
  const map = Object.fromEntries(anggotaAll.map((a) => [a.id, a]));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const chosen = value.map((id) => map[id]).filter(Boolean);
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} data-testid={testId}
          className={compact
            ? "flex min-h-[28px] w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-2 py-1 text-left hover:bg-emerald-50 disabled:cursor-default disabled:hover:bg-transparent"
            : "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-white px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"}>
          {chosen.length === 0 ? <span className="text-xs text-emerald-800/40">{disabled ? "—" : placeholder}</span>
            : chosen.map((a) => <PersonChip key={a.id} a={a} />)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1" align="start">
        {chosen.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs italic text-emerald-700/70 hover:bg-emerald-50"><X size={11} /> Kosongkan</button>
        )}
        <div className="max-h-64 overflow-auto">
          {grouped(anggotaAll, divisiList, exclude).map(({ d, items }) => (
            <div key={d.id}>
              <p className="mt-1 px-2 text-[9px] font-semibold uppercase text-emerald-800/50">{d.nama}</p>
              {items.map((a) => (
                <button type="button" key={a.id} onClick={() => toggle(a.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-emerald-50">
                  <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${value.includes(a.id) ? "border-emerald-700 bg-emerald-700 text-white" : "border-emerald-300"}`}>
                    {value.includes(a.id) && <Check size={10} />}
                  </span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.warna }} />
                  <span className="flex-1">{a.nama}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RaciLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline" data-testid="raci-legend">
          <Info size={12} /> Apa itu RACI?
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-2">
          {Object.entries(RACI).map(([k, m]) => (
            <div key={k} className="flex gap-2 text-xs">
              <RoleTag role={k} />
              <p className="text-emerald-950"><b>{m.nama}</b> — {m.arti}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
