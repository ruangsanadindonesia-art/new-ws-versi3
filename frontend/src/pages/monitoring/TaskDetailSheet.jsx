import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Calendar } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getTask } from "@/lib/api";
import { ActivityPanel, PrioritasBadge } from "@/pages/tasks/dialogs";
import { RoleTag } from "@/pages/tasks/raci";

const STATUS = { BELUM_MULAI: "Belum mulai", DALAM_PROSES: "Dikerjakan", MENUNGGU_REVIEW: "Menunggu review", REVISI: "Revisi", TERKENDALA: "Terkendala", SELESAI: "Selesai" };

// Panel detail tugas + diskusi (komentar) untuk SPV/kepala tim dari Pusat Kendali.
export default function TaskDetailSheet({ taskId, onOpenChange, anggotaMap = {} }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!taskId) return;
    setT(null); setErr("");
    getTask(taskId).then(setT).catch(() => setErr("Tugas tidak bisa dibuka."));
  }, [taskId]);
  const nama = (id) => anggotaMap[id]?.nama || "—";
  return (
    <Sheet open={!!taskId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="task-detail-sheet">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-lg leading-snug">{t?.nama || "Detail tugas"}</SheetTitle>
          <SheetDescription className="sr-only">Detail tugas dan diskusi</SheetDescription>
        </SheetHeader>
        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        {!t && !err && <div className="grid place-items-center p-10"><Loader2 className="animate-spin text-emerald-800" /></div>}
        {t && (
          <div className="mt-3 space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">{STATUS[t.status] || t.status}</span>
              <PrioritasBadge p={t.prioritas} />
              {t.deadline && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"><Calendar size={11} />
                {new Date(`${t.deadline}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })}{t.deadline_jam ? ` ${t.deadline_jam}` : ""}</span>}
              {t.revisi_count > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">Revisi {t.revisi_count}x</span>}
            </div>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-emerald-100 p-3 text-xs">
              <div><dt className="flex items-center gap-1 text-emerald-800/60"><RoleTag role="R" /> Mengerjakan</dt><dd className="mt-0.5 font-medium text-emerald-950">{nama(t.penerima_tugas_id)}</dd></div>
              <div><dt className="flex items-center gap-1 text-emerald-800/60"><RoleTag role="A" /> Penyetuju</dt><dd className="mt-0.5 font-medium text-emerald-950">{nama(t.pemberi_id)}</dd></div>
              {(t.consulted_ids || []).length > 0 && <div><dt className="flex items-center gap-1 text-emerald-800/60"><RoleTag role="C" /> Konsultasi</dt><dd className="mt-0.5 text-emerald-950">{t.consulted_ids.map(nama).join(", ")}</dd></div>}
              {(t.informed_ids || []).length > 0 && <div><dt className="flex items-center gap-1 text-emerald-800/60"><RoleTag role="I" /> Info</dt><dd className="mt-0.5 text-emerald-950">{t.informed_ids.map(nama).join(", ")}</dd></div>}
            </dl>
            {t.catatan_tim && <div><p className="text-xs font-semibold text-emerald-900">Instruksi</p><p className="mt-1 whitespace-pre-wrap text-emerald-950/90">{t.catatan_tim}</p></div>}
            {t.brief_link && <a href={t.brief_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">Brief / referensi <ExternalLink size={12} /></a>}
            {(t.hasil_link || t.hasil_catatan) && (
              <div className="rounded-lg bg-emerald-50/60 p-3">
                <p className="text-xs font-semibold text-emerald-900">Hasil dari R</p>
                {t.hasil_catatan && <p className="mt-1 whitespace-pre-wrap text-xs text-emerald-950/90">{t.hasil_catatan}</p>}
                {t.hasil_link && <a href={t.hasil_link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">Buka hasil <ExternalLink size={12} /></a>}
              </div>
            )}
            {t.status === "REVISI" && t.revisi_catatan && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800"><b>Catatan revisi:</b> {t.revisi_catatan}</p>}
            <div>
              <p className="mb-1 text-xs text-emerald-800/70">Tanyakan kendala di sini. R, A, dan C mendapat notifikasi; balasan mereka juga masuk ke notifikasi Anda.</p>
              <ActivityPanel taskId={t.id} canComment />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
