import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Wand2, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatApiErr } from "@/lib/AuthContext";
import { K, JENIS_URUT, JenisBadge, ymd, tambahHari, seninDari, tglPendek } from "./shared";
import { IsiFields, PlatformPilih, JadwalEditor } from "./Fields";
import { platformLabel } from "./shared";

const HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Ahad"];

function AlurRingkas({ def, meta, iklan = false }) {
  return (
    <div className="rounded-lg bg-emerald-50/60 p-2.5 text-[11px] text-emerald-900">
      <p className="mb-1 font-semibold">Alur & siapa yang memegang</p>
      <div className="flex flex-wrap gap-1">
        {(iklan ? def.alur_iklan : def.alur).map((a) => {
          const nama = a.pelaksana === "PENULIS" ? def.penulis?.nama : meta.peran[a.pelaksana]?.nama;
          return <span key={a.k} className="rounded bg-white px-1.5 py-0.5" title={a.instruksi}>{a.label} <span className="text-emerald-800/50">· {nama || "-"}</span></span>;
        })}
      </div>
    </div>
  );
}

function FormSatu({ meta, jenis, onSaved, onBack }) {
  const def = meta.jenis[jenis];
  const teks = def.grup === "TEKS";
  const besok = new Date(); besok.setDate(besok.getDate() + (teks ? 2 : 7));
  const awal = { tanggal: ymd(besok), jam: def.slot[0]?.[0] || "" };
  const opsiPlat = jenis === "KOL" ? meta.platform_kol : meta.platform;
  const [f, setF] = useState({ judul: "", platforms: def.platform ? ["IG"] : [jenis], status: "", isi: {} });
  const [jadwal, setJadwal] = useState({ [def.platform ? "IG" : jenis]: awal });
  const [busy, setBusy] = useState(false);
  const iklan = f.platforms.length === 1 && f.platforms[0] === "IKLAN";
  const alur = iklan ? def.alur_iklan : def.alur;
  const fields = [...def.field, ...(iklan ? def.field_iklan || [] : [])];
  const setPlat = (v) => {
    const j = {}; v.forEach((p) => { j[p] = jadwal[p] || jadwal[f.platforms[0]] || awal; });
    setF({ ...f, platforms: v, status: "" }); setJadwal(j);
  };
  const simpan = async () => {
    setBusy(true);
    try {
      const k = await K.buat({ jenis, judul: f.judul, platforms: f.platforms, jadwal, status: f.status || null, isi: f.isi });
      toast.success(`${k.kode} dibuat — masuk ke Tugas ${k.pemegang_nama.join(", ")}`); onSaved(k);
    } catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  const lengkap = f.platforms.length && f.platforms.every((p) => jadwal[p]?.tanggal);
  return (
    <div className="space-y-3">
      <div><label className="text-xs font-medium" htmlFor="kb-judul">{jenis === "KOL" ? "Judul kolaborasi" : "Judul / topik"} {(teks || jenis === "KOL") && <span className="font-normal text-emerald-800/50">(boleh kosong — diambil dari {jenis === "KOL" ? "nama kreator" : "hook/isi"})</span>}</label>
        <Input id="kb-judul" value={f.judul} onChange={(e) => setF({ ...f, judul: e.target.value })} placeholder={jenis === "KOL" ? "mis. UGC Nita — testimoni kelas" : "mis. 9 Hukum Idgham"} data-testid="kb-judul" /></div>
      {def.platform && <div><p className="text-xs font-medium">Platform {jenis !== "KOL" && <span className="font-normal text-emerald-800/50">· pilih Iklan untuk konten iklan (terpisah dari organik)</span>}</p>
        <div className="mt-1"><PlatformPilih opsi={opsiPlat} value={f.platforms} onChange={setPlat} /></div></div>}
      <JadwalEditor platforms={f.platforms} jadwal={jadwal} setJadwal={setJadwal} label={(p) => platformLabel(meta, p)} iklan={iklan} teks={teks} />
      <IsiFields fields={fields} isi={f.isi} idp="kb" setIsi={(isi) => setF({ ...f, isi })} />
      <div><label className="text-xs font-medium" htmlFor="kb-status">Mulai dari status</label>
        <select id="kb-status" value={f.status || alur[0].k} onChange={(e) => setF({ ...f, status: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
          {alur.filter((a) => !["POSTED", "LAPORAN", "SELESAI", "IKLAN_AKTIF"].includes(a.k)).map((a) => <option key={a.k} value={a.k}>{a.label}</option>)}
        </select>
        <p className="mt-0.5 text-[10px] text-emerald-800/50">Biasanya dari awal. Pilih status lain bila naskah/materinya sudah ada.</p></div>
      <AlurRingkas def={def} meta={meta} iklan={iklan} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>Kembali</Button>
        <Button onClick={simpan} disabled={busy || !lengkap || (!teks && jenis !== "KOL" && f.judul.trim().length < 3) || (jenis === "KOL" && !f.judul.trim() && !(f.isi.nama_kreator || "").trim())}
          className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="kb-simpan">{busy && <Loader2 size={14} className="animate-spin" />} Buat konten</Button>
      </div>
    </div>
  );
}

// Kanal teks: rencanakan banyak post sekaligus (1 post = 1 konten = 1 tugas).
function PlannerTeks({ meta, jenis, onSaved, onBack }) {
  const def = meta.jenis[jenis];
  const [mulai, setMulai] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return seninDari(ymd(d)); });
  const [posts, setPosts] = useState([]);
  const [buka, setBuka] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const hari = Array.from({ length: 7 }, (_, i) => tambahHari(mulai, i));
  const set = (i, kunci, v) => setPosts(posts.map((p, j) => (j === i ? { ...p, [kunci]: v } : p)));
  const setIsi = (i, isi) => setPosts(posts.map((p, j) => (j === i ? { ...p, isi } : p)));
  const isiSlot = () => {
    const ada = new Set(posts.map((p) => `${p.tanggal}|${p.jam}`));
    const baru = hari.slice(0, 6).flatMap((t) => def.slot.map(([jam, label]) => ({ tanggal: t, jam, isi: label ? { label } : {} }))).filter((p) => !ada.has(`${p.tanggal}|${p.jam}`));
    setPosts([...posts, ...baru].sort((a, b) => `${a.tanggal}${a.jam}`.localeCompare(`${b.tanggal}${b.jam}`)));
  };
  const geser = (v) => { const m = seninDari(v); const d = (new Date(`${m}T00:00:00`) - new Date(`${mulai}T00:00:00`)) / 864e5; setMulai(m); setPosts(posts.map((p) => ({ ...p, tanggal: tambahHari(p.tanggal, d) }))); };
  const toggle = (i) => { const n = new Set(buka); n.has(i) ? n.delete(i) : n.add(i); setBuka(n); };
  const simpan = async () => {
    setBusy(true);
    try {
      const r = await K.banyak(posts.map((p) => ({ jenis, tanggal_tayang: p.tanggal, jam_tayang: p.jam, isi: p.isi })));
      toast.success(`${r.length} post ${def.label} dibuat — masing-masing jadi satu tugas`); onSaved(null);
    } catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div><label className="text-xs font-medium" htmlFor="pt-minggu">Pekan (mulai Senin)</label><Input id="pt-minggu" type="date" value={mulai} onChange={(e) => e.target.value && geser(e.target.value)} className="bg-white" /></div>
        <p className="pb-2 text-[11px] text-emerald-800/70">{tglPendek(mulai)} – {tglPendek(tambahHari(mulai, 6))}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-emerald-950">{posts.length} post</p>
        <span className="text-[11px] text-emerald-800/60">Slot standar: {def.slot.map(([j, l]) => (l ? `${j} ${l}` : j)).join(" · ")}</span>
        <div className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={isiSlot} className="h-7 text-[11px]" data-testid="pt-isi-slot"><Wand2 size={12} /> Isi slot Sen–Sab</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setPosts([...posts, { tanggal: posts.at(-1)?.tanggal || mulai, jam: def.slot[0][0], isi: {} }]); setBuka(new Set([...buka, posts.length])); }} className="h-7 text-[11px]"><Plus size={12} /> Post</Button>
        </div>
      </div>
      {posts.length === 0 && <p className="rounded-lg border border-dashed border-emerald-200 p-4 text-center text-xs text-emerald-800/60">Klik <b>Isi slot Sen–Sab</b> untuk membuat slot sesuai jadwal standar, atau <b>+ Post</b> satu per satu. Copy boleh dilengkapi nanti di kartu masing-masing.</p>}
      <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
        {posts.map((p, i) => (
          <div key={i} className="rounded-lg border border-emerald-100 bg-white" data-testid={`pt-post-${i}`}>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <select value={p.tanggal} onChange={(e) => set(i, "tanggal", e.target.value)} className="h-7 rounded border border-input bg-white px-1 text-[11px]" aria-label="Hari">
                {hari.map((t, j) => <option key={t} value={t}>{HARI[j]} {Number(t.slice(8))}</option>)}
              </select>
              <Input type="time" value={p.jam} onChange={(e) => set(i, "jam", e.target.value)} className="h-7 w-[108px] shrink-0 bg-white px-1 text-[11px]" aria-label="Jam" />
              <button type="button" onClick={() => toggle(i)} className="min-w-0 flex-1 truncate text-left text-[11px] text-emerald-900">
                {p.isi.label && <b className="mr-1">{p.isi.label}</b>}{p.isi.hook || p.isi.topik || p.isi.isi || <span className="text-amber-700">belum diisi</span>}
              </button>
              <button type="button" onClick={() => setPosts([...posts.slice(0, i + 1), { ...p, isi: { ...p.isi } }, ...posts.slice(i + 1)])} className="text-emerald-700" aria-label="Duplikat"><Copy size={13} /></button>
              <button type="button" onClick={() => setPosts(posts.filter((_, j) => j !== i))} className="text-red-600" aria-label="Hapus"><Trash2 size={13} /></button>
              <button type="button" onClick={() => toggle(i)} className="text-emerald-700" aria-label="Buka">{buka.has(i) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
            </div>
            {buka.has(i) && <div className="border-t border-emerald-50 p-2"><IsiFields fields={def.field} isi={p.isi} idp={`pt${i}`} setIsi={(isi) => setIsi(i, isi)} /></div>}
          </div>
        ))}
      </div>
      <AlurRingkas def={def} meta={meta} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>Kembali</Button>
        <Button onClick={simpan} disabled={busy || !posts.length} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="pt-simpan">{busy && <Loader2 size={14} className="animate-spin" />} Buat {posts.length || ""} post</Button>
      </div>
    </div>
  );
}

export default function BaruDialog({ meta, onClose, onSaved }) {
  const [jenis, setJenis] = useState(null);
  const [mode, setMode] = useState("satu");
  const def = jenis && meta.jenis[jenis];
  const teks = def?.grup === "TEKS";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={`max-h-[92vh] overflow-y-auto ${teks && mode === "pekan" ? "max-w-2xl" : "max-w-lg"}`} data-testid="konten-baru-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{jenis ? `Konten baru · ${def.label}` : "Konten baru — pilih tipe"}</DialogTitle>
          <DialogDescription className="text-emerald-800/70">{jenis ? "Satu konten = satu tugas. Statusnya berjalan sesuai alur tipe ini, dan tugasnya berpindah ke orang yang memegang tiap status." : "Tipe konten menentukan isian, alur status, dan siapa yang memegang tugasnya."}</DialogDescription>
        </DialogHeader>
        {!jenis ? (
          <div className="grid gap-2 sm:grid-cols-2" data-testid="kb-pilih-jenis">
            {JENIS_URUT.map((j) => {
              const d = meta.jenis[j];
              return (
                <button key={j} onClick={() => setJenis(j)} className="rounded-xl border border-emerald-200 p-3 text-left hover:border-emerald-500 hover:bg-emerald-50/50" data-testid={`kb-jenis-${j}`}>
                  <JenisBadge j={j} />
                  <p className="mt-1 text-sm font-semibold text-emerald-950">{d.label}</p>
                  <p className="text-[10px] leading-snug text-emerald-800/60">{d.alur.map((a) => a.label).join(" → ")}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {teks && (
              <div className="flex rounded-lg border border-emerald-200 p-1 text-xs">
                {[["satu", "Satu post"], ["pekan", "Rencana sepekan"]].map(([m, l]) => (
                  <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-md px-2 py-1 font-medium ${mode === m ? "bg-emerald-900 text-white" : "text-emerald-800"}`} data-testid={`kb-mode-${m}`}>{l}</button>
                ))}
              </div>
            )}
            {teks && mode === "pekan" ? <PlannerTeks meta={meta} jenis={jenis} onSaved={onSaved} onBack={() => setJenis(null)} />
              : <FormSatu key={jenis} meta={meta} jenis={jenis} onSaved={onSaved} onBack={() => setJenis(null)} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
