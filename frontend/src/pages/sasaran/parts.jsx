import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2, Pencil, Plus, Trash2, HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatApiErr } from "@/lib/AuthContext";
import { ukuranCheckin, ukuranCheckins, ukuranCreate, ukuranUpdate, ukuranDelete, sasaranCreate, sasaranUpdate, sasaranDelete } from "@/lib/api";
import { PersonSelect, PeopleSelect } from "@/pages/tasks/raci";

export const STATUS = {
  SESUAI: { label: "On track", arti: "Sesuai jalur: realisasi sejalan dengan waktu yang sudah berjalan.", cls: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-600" },
  PERHATIAN: { label: "At risk", arti: "Perlu perhatian: realisasi 70–90% dari yang seharusnya.", cls: "bg-amber-100 text-amber-800", bar: "bg-amber-500" },
  TERTINGGAL: { label: "Off track", arti: "Tertinggal: realisasi di bawah 70% dari yang seharusnya.", cls: "bg-red-100 text-red-700", bar: "bg-red-500" },
  BELUM_ADA_DATA: { label: "No data", arti: "Belum ada check-in realisasi.", cls: "bg-slate-100 text-slate-600", bar: "bg-slate-300" },
};
export const ARAH = { NAIK: "Naik ↑", TURUN: "Turun ↓", JAGA: "Jaga =" };
export const PERSPEKTIF = { KEUANGAN: "Financial", SANTRI: "Customer", OPERASIONAL: "Internal Process", SDM: "Learning & Growth" };
export const PERSPEKTIF_ARTI = {
  KEUANGAN: "Keuangan: pendapatan, laba, tagihan terbayar.",
  SANTRI: "Pelanggan/santri: jumlah santri, retensi, kepuasan.",
  OPERASIONAL: "Proses internal: kelas sesuai jadwal, konversi lead, kualitas layanan.",
  SDM: "Pembelajaran & pertumbuhan: kompetensi guru dan tim, kemandirian organisasi.",
};

// Glosarium istilah manajemen — dipakai tooltip di seluruh modul Target Bersama.
export const ISTILAH = {
  BSC: { judul: "BSC — Balanced Scorecard", isi: "Cara melihat kinerja lembaga dari 4 perspektif seimbang: Financial, Customer, Internal Process, dan Learning & Growth. Tujuannya agar target tidak hanya soal uang, tetapi juga santri, proses kerja, dan kemampuan tim." },
  OKR: { judul: "OKR — Objectives & Key Results", isi: "Objective = tujuan yang ingin dicapai dalam satu periode (kalimat, bukan angka). Key Results = 2–4 angka terukur yang membuktikan objective tercapai. Contoh: Objective “Santri tumbuh dan bertahan”, KR “Santri aktif 880”." },
  KPI: { judul: "KPI — Key Performance Indicator", isi: "Angka kinerja yang dipegang satu orang (PIC) dan dipantau rutin lewat check-in. Di sini setiap Key Result yang punya PIC otomatis menjadi KPI orang tersebut — tidak perlu diisi dua kali." },
  OBJECTIVE: { judul: "Objective", isi: "Tujuan yang ingin dicapai periode ini. Level Lembaga untuk seluruh Ruang Sanad, level Tim untuk satu tim. Objective tim bisa menjadi turunan objective lembaga." },
  KR: { judul: "Key Result (KR)", isi: "Angka yang membuktikan objective tercapai: punya baseline (opsional), target, satuan, polaritas, dan PIC yang melakukan check-in." },
  BASELINE: { judul: "Baseline", isi: "Angka awal saat periode dimulai. Jika diisi, progres dihitung dari baseline ke target dan dibandingkan dengan waktu yang sudah berjalan. Jika kosong, realisasi dibandingkan langsung dengan target." },
  REALISASI: { judul: "Realisasi", isi: "Angka terbaru hasil check-in." },
  POLARITAS: { judul: "Polaritas", isi: "Naik ↑ = makin tinggi makin baik (mis. jumlah santri). Turun ↓ = makin rendah makin baik (mis. biaya per lead). Jaga = harus tetap di atas target sepanjang periode (mis. kelas sesuai jadwal ≥ 95%)." },
  CHECKIN: { judul: "Check-in", isi: "Update rutin (idealnya tiap pekan) oleh PIC: realisasi terbaru, tingkat keyakinan, dan catatan singkat. Riwayatnya menjadi bahan evaluasi." },
  OWNER: { judul: "Owner", isi: "Penanggung jawab objective. Owner dan PIC boleh check-in; SPV dan kepala tim mengelola objective." },
  PIC: { judul: "PIC", isi: "Person in charge: orang yang memegang KR/KPI dan melakukan check-in." },
  STATUS: { judul: "Status", isi: Object.values({ a: "On track = sesuai jalur", b: "At risk = perlu perhatian (70–90%)", c: "Off track = tertinggal (< 70%)", d: "No data = belum ada check-in" }).join(" · ") },
};

export function InfoTip({ k, className = "" }) {
  const t = ISTILAH[k];
  if (!t) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Apa itu ${t.judul}?`} title={`${t.judul}: ${t.isi}`} onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center align-middle text-emerald-600/70 hover:text-emerald-800 ${className}`} data-testid={`tip-${k}`}>
          <HelpCircle size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 text-xs leading-relaxed" align="start">
        <p className="mb-1 font-semibold text-emerald-950">{t.judul}</p>
        <p className="text-emerald-900/80">{t.isi}</p>
      </PopoverContent>
    </Popover>
  );
}
const YAKIN = { YAKIN: "Yakin tercapai", RAGU: "Ragu", BERISIKO: "Berisiko" };

export function StatusPill({ status, small = false }) {
  const m = STATUS[status] || STATUS.BELUM_ADA_DATA;
  return <span title={m.arti} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold ${small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-[11px]"} ${m.cls}`}>{m.label}</span>;
}

export function fmtAngka(v, satuan = "") {
  if (v === null || v === undefined || v === "") return "–";
  const n = Number(v);
  if (satuan === "Rp") {
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
    return `Rp ${n.toLocaleString("id-ID")}`;
  }
  const s = n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return satuan === "%" ? `${s}%` : satuan ? `${s} ${satuan}` : s;
}

export function ProgressBar({ pct, status }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-100" role="progressbar" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${(STATUS[status] || STATUS.BELUM_ADA_DATA).bar}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function sinceText(iso) {
  if (!iso) return "belum pernah";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "hari ini" : d === 1 ? "kemarin" : `${d} hari lalu`;
}

export function UkuranRow({ u, canCheckin, canEdit, onCheckin, onEdit, compact = false }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-100 bg-white px-3 py-2.5" data-testid={`ukuran-${u.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-emerald-950">{u.nama}</p>
          <p className="mt-0.5 text-[11px] text-emerald-800/65">
            {ARAH[u.arah] || "Naik ↑"} · PIC {u.pic?.nama || "–"}
            {u.mode === "progres" ? ` · baseline ${fmtAngka(u.awal, u.satuan)}` : ""}
            {" · "}<span className={u.perlu_update ? "font-semibold text-amber-700" : ""}><Clock size={10} className="mb-0.5 inline" /> check-in {sinceText(u.last_checkin_at)}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-emerald-950">{fmtAngka(u.capaian, u.satuan)} <span className="font-normal text-emerald-800/60">/ {fmtAngka(u.target, u.satuan)}</span></p>
          <StatusPill status={u.status} small />
        </div>
      </div>
      {!compact && <ProgressBar pct={u.pct} status={u.status} />}
      {(canCheckin || canEdit) && (
        <div className="flex flex-wrap gap-1.5">
          {canCheckin && <Button size="sm" variant={u.perlu_update ? "default" : "outline"} onClick={() => onCheckin(u)} data-testid={`checkin-${u.id}`}
            className={`h-7 px-2.5 text-xs ${u.perlu_update ? "bg-emerald-800 text-white hover:bg-emerald-700" : ""}`}>Check-in</Button>}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => onEdit(u)} className="h-7 px-2 text-xs text-emerald-800"><Pencil size={12} /> Ubah</Button>}
        </div>
      )}
    </div>
  );
}

export function CheckinDialog({ ukuran, open, onOpenChange, onSaved }) {
  const [nilai, setNilai] = useState("");
  const [yakin, setYakin] = useState("YAKIN");
  const [catatan, setCatatan] = useState("");
  const [riwayat, setRiwayat] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !ukuran) return;
    setNilai(ukuran.capaian ?? ""); setYakin(ukuran.confidence || "YAKIN"); setCatatan("");
    ukuranCheckins(ukuran.id).then(setRiwayat).catch(() => setRiwayat([]));
  }, [open, ukuran]);
  if (!ukuran) return null;
  const save = async () => {
    if (nilai === "" || isNaN(Number(String(nilai).replace(",", ".")))) return toast.error("Isi realisasi berupa angka");
    setBusy(true);
    try {
      const u = await ukuranCheckin(ukuran.id, { nilai: Number(String(nilai).replace(",", ".")), confidence: yakin, catatan });
      toast.success(`Check-in tersimpan · ${STATUS[u.status]?.label || ""}`); onOpenChange(false); onSaved?.(u);
    } catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="checkin-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Check-in realisasi <InfoTip k="CHECKIN" /></DialogTitle>
          <DialogDescription className="text-emerald-800/70">{ukuran.nama}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-emerald-800/70">Target: <b>{fmtAngka(ukuran.target, ukuran.satuan)}</b> · polaritas {ARAH[ukuran.arah]} · realisasi terakhir: {fmtAngka(ukuran.capaian, ukuran.satuan)}</p>
          <div>
            <label className="text-xs font-medium text-emerald-900" htmlFor="ck-nilai">Realisasi saat ini {ukuran.satuan ? `(${ukuran.satuan === "Rp" ? "rupiah, angka penuh" : ukuran.satuan})` : ""}</label>
            <Input id="ck-nilai" inputMode="decimal" value={nilai} onChange={(e) => setNilai(e.target.value)} data-testid="ck-nilai" />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-emerald-900">Seberapa yakin target tercapai?</p>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(YAKIN).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setYakin(k)} data-testid={`ck-${k}`}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium ${yakin === k ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900 hover:bg-emerald-50"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-emerald-900" htmlFor="ck-catatan">Catatan singkat <span className="text-emerald-700/50">(opsional)</span></label>
            <Textarea id="ck-catatan" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Apa yang berubah pekan ini? Ada kendala?" maxLength={500} />
          </div>
          {riwayat.length > 0 && (
            <div className="rounded-md bg-emerald-50/60 p-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-800/70">Riwayat</p>
              <ul className="max-h-28 space-y-0.5 overflow-auto text-[11px] text-emerald-900">
                {[...riwayat].reverse().map((c) => (
                  <li key={c.id} className="flex gap-2"><span className="w-20 shrink-0 tabular-nums text-emerald-800/60">{new Date(c.at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</span>
                    <b className="tabular-nums">{fmtAngka(c.nilai, ukuran.satuan)}</b><span className="truncate text-emerald-800/70">{c.catatan}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="ck-save">{busy ? <Loader2 size={14} className="animate-spin" /> : null} Simpan check-in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SATUAN = ["%", "santri", "Rp", "kelas", "orang", "lead", ""];

export function UkuranDialog({ open, onOpenChange, sasaran, ukuran, anggotaAll, divisiList, onSaved }) {
  const edit = !!ukuran;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(ukuran ? { nama: ukuran.nama, pic_id: ukuran.pic_id, arah: ukuran.arah || "NAIK", satuan: ukuran.satuan || "", awal: ukuran.awal ?? "", target: ukuran.target ?? "" }
      : { nama: "", pic_id: sasaran?.pj_id || null, arah: "NAIK", satuan: "%", awal: "", target: "" });
  }, [open, ukuran, sasaran]);
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));
  const save = async () => {
    if (!f.nama?.trim()) return toast.error("Isi Key Result");
    if (num(f.target) === null || isNaN(num(f.target))) return toast.error("Target harus angka");
    if (f.awal !== "" && isNaN(num(f.awal))) return toast.error("Baseline harus angka");
    const p = { nama: f.nama.trim(), pic_id: f.pic_id, arah: f.arah, satuan: f.satuan, awal: num(f.awal), target: num(f.target) };
    setBusy(true);
    try { edit ? await ukuranUpdate(ukuran.id, p) : await ukuranCreate(sasaran.id, p); toast.success("Key Result disimpan"); onOpenChange(false); onSaved?.(); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  const remove = async () => {
    try { await ukuranDelete(ukuran.id); toast.success("Key Result dihapus"); onOpenChange(false); onSaved?.(); } catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="ukuran-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{edit ? "Ubah Key Result" : "Tambah Key Result"} <InfoTip k="KR" /></DialogTitle>
          <DialogDescription className="text-emerald-800/70">Angka apa yang membuktikan objective “{sasaran?.judul}” tercapai?</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs font-medium text-emerald-900" htmlFor="uk-nama">Key Result</label>
            <Input id="uk-nama" value={f.nama || ""} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="mis. Jumlah santri aktif" /></div>
          <p className="-mb-1 text-xs font-medium text-emerald-900">Polaritas <InfoTip k="POLARITAS" /></p>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(ARAH).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF({ ...f, arah: k })} data-testid={`arah-${k}`}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${f.arah === k ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900 hover:bg-emerald-50"}`}>{l}</button>
            ))}
          </div>
          <p className="-mt-1 text-[11px] text-emerald-800/60">{f.arah === "TURUN" ? "Makin rendah makin baik (mis. biaya per lead)." : f.arah === "JAGA" ? "Harus tetap di atas target sepanjang periode (mis. kelas sesuai jadwal ≥ 95%)." : "Makin tinggi makin baik (mis. jumlah santri)."}</p>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs font-medium text-emerald-900" htmlFor="uk-awal">Baseline <InfoTip k="BASELINE" /></label>
              <Input id="uk-awal" inputMode="decimal" value={f.awal ?? ""} onChange={(e) => setF({ ...f, awal: e.target.value })} placeholder="opsional" /></div>
            <div><label className="text-xs font-medium text-emerald-900" htmlFor="uk-target">Target</label>
              <Input id="uk-target" inputMode="decimal" value={f.target ?? ""} onChange={(e) => setF({ ...f, target: e.target.value })} /></div>
            <div><label className="text-xs font-medium text-emerald-900" htmlFor="uk-satuan">Satuan</label>
              <select id="uk-satuan" value={f.satuan ?? ""} onChange={(e) => setF({ ...f, satuan: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
                {[...new Set([...SATUAN, f.satuan || ""])].map((s) => <option key={s} value={s}>{s || "(tanpa)"}</option>)}
              </select></div>
          </div>
          <p className="-mt-1 text-[11px] text-emerald-800/60">Isi baseline agar progres diukur dari titik awal terhadap waktu periode. Tanpa baseline, realisasi dibanding langsung dengan target.</p>
          <div><p className="mb-1 text-xs font-medium text-emerald-900">PIC <InfoTip k="PIC" /> <span className="font-normal text-emerald-800/60">— KR ini menjadi KPI orang tersebut</span></p>
            <PersonSelect value={f.pic_id} onChange={(v) => setF({ ...f, pic_id: v })} anggotaAll={anggotaAll} divisiList={divisiList} placeholder="Pilih PIC" testId="uk-pic" /></div>
        </div>
        <DialogFooter className="gap-2">
          {edit && <Button variant="ghost" onClick={remove} className="mr-auto text-red-700 hover:bg-red-50"><Trash2 size={14} /> Hapus</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="uk-save">Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SasaranSheet({ open, onOpenChange, sasaran, periodId, ov, anggotaAll, divisiList, onSaved }) {
  const edit = !!sasaran;
  const [f, setF] = useState({});
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const isSpv = ov?.is_spv;
  useEffect(() => {
    if (!open) return;
    setConfirmDel(false);
    setF(sasaran ? { judul: sasaran.judul, level: sasaran.level, divisi_id: sasaran.divisi_id, pj_id: sasaran.pj_id, tim_ids: sasaran.tim_ids || [], perspektif: sasaran.perspektif || "", parent_id: sasaran.parent_id || "" }
      : { judul: "", level: isSpv ? "LEMBAGA" : "TIM", divisi_id: isSpv ? null : ov?.head_divisi_id, pj_id: null, tim_ids: [], perspektif: "", parent_id: "" });
  }, [open, sasaran, isSpv, ov]);
  const lembaga = (ov?.sasaran || []).filter((s) => s.level === "LEMBAGA" && s.id !== sasaran?.id);
  const save = async () => {
    if ((f.judul || "").trim().length < 3) return toast.error("Tulis objective minimal 3 huruf");
    if (f.level === "TIM" && !f.divisi_id) return toast.error("Pilih tim");
    const p = { judul: f.judul.trim(), level: f.level, divisi_id: f.level === "TIM" ? f.divisi_id : null, pj_id: f.pj_id, tim_ids: f.tim_ids,
      perspektif: f.perspektif || null, parent_id: f.level === "TIM" ? (f.parent_id || null) : null };
    setBusy(true);
    try { edit ? await sasaranUpdate(sasaran.id, p) : await sasaranCreate({ ...p, period_id: periodId }); toast.success("Objective disimpan"); onOpenChange(false); onSaved?.(); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  const remove = async () => {
    try { await sasaranDelete(sasaran.id); toast.success("Objective dihapus"); onOpenChange(false); onSaved?.(); } catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="sasaran-sheet">
        <SheetHeader>
          <SheetTitle className="font-display">{edit ? "Ubah Objective" : "Objective baru"} <InfoTip k="OBJECTIVE" /></SheetTitle>
          <SheetDescription>Apa yang ingin dicapai periode ini? Tulis singkat dan jelas, mis. “Santri aktif tumbuh dan bertahan”. Angkanya dimasukkan sebagai Key Result.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div><label className="text-xs font-medium text-emerald-900" htmlFor="ss-judul">Objective</label>
            <Textarea id="ss-judul" rows={2} value={f.judul || ""} onChange={(e) => setF({ ...f, judul: e.target.value })} data-testid="ss-judul" /></div>
          <div>
            <p className="mb-1 text-xs font-medium text-emerald-900">Level</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[["LEMBAGA", "Lembaga"], ["TIM", "Tim"]].map(([k, l]) => (
                <button key={k} type="button" disabled={!isSpv} onClick={() => setF({ ...f, level: k })}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium disabled:opacity-60 ${f.level === k ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900 hover:bg-emerald-50"}`}>{l}</button>
              ))}
            </div>
          </div>
          {f.level === "TIM" && (
            <div><label className="text-xs font-medium text-emerald-900" htmlFor="ss-tim">Tim</label>
              <select id="ss-tim" disabled={!isSpv} value={f.divisi_id || ""} onChange={(e) => setF({ ...f, divisi_id: e.target.value || null })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm disabled:opacity-60">
                <option value="">Pilih tim…</option>
                {divisiList.map((d) => <option key={d.id} value={d.id}>{d.nama}</option>)}
              </select></div>
          )}
          <div><p className="mb-1 text-xs font-medium text-emerald-900">Owner <InfoTip k="OWNER" /></p>
            <PersonSelect value={f.pj_id} onChange={(v) => setF({ ...f, pj_id: v })} anggotaAll={anggotaAll} divisiList={divisiList} placeholder="Pilih owner" testId="ss-pj" /></div>
          <div><p className="mb-1 text-xs font-medium text-emerald-900">Tim pendukung <span className="font-normal text-emerald-800/50">(opsional)</span></p>
            <PeopleSelect value={f.tim_ids || []} onChange={(v) => setF({ ...f, tim_ids: v })} anggotaAll={anggotaAll} divisiList={divisiList} exclude={[f.pj_id].filter(Boolean)} testId="ss-tim-ids" /></div>
          <div><label className="text-xs font-medium text-emerald-900" htmlFor="ss-persp">Perspektif BSC <InfoTip k="BSC" /> <span className="font-normal text-emerald-800/50">(opsional)</span></label>
            <select id="ss-persp" value={f.perspektif || ""} onChange={(e) => setF({ ...f, perspektif: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
              <option value="">Tanpa perspektif</option>
              {Object.entries(PERSPEKTIF).map(([k, l]) => <option key={k} value={k}>{l} — {PERSPEKTIF_ARTI[k].split(":")[0]}</option>)}
            </select></div>
          {f.level === "TIM" && lembaga.length > 0 && (
            <div><label className="text-xs font-medium text-emerald-900" htmlFor="ss-parent">Turunan dari Objective lembaga <span className="font-normal text-emerald-800/50">(opsional)</span></label>
              <select id="ss-parent" value={f.parent_id || ""} onChange={(e) => setF({ ...f, parent_id: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
                <option value="">—</option>
                {lembaga.map((s) => <option key={s.id} value={s.id}>{s.judul}</option>)}
              </select></div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={save} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="ss-save"><Plus size={14} /> Simpan</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
            {edit && !confirmDel && <Button variant="ghost" onClick={() => setConfirmDel(true)} className="ml-auto text-red-700 hover:bg-red-50"><Trash2 size={14} /> Hapus</Button>}
          </div>
          {confirmDel && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              Hapus objective ini beserta semua Key Result dan riwayat check-in-nya? Tugas yang tertaut tidak ikut terhapus.
              <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" onClick={remove}>Ya, hapus</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>Batal</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
