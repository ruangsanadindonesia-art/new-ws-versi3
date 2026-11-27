import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const BUCKET = ["", "VALUE", "HUMAN", "SELL"];
const BANTUAN = {
  bucket: "VALUE = edukasi/ilmu, HUMAN = cerita/kedekatan, SELL = ajakan daftar/promo.",
  cta_keyword: "Kata yang diminta dikomentari/di-DM penonton (mis. SANAD). Dipakai melacak leads dari konten ini.",
  naskah_talent_url: "Naskah yang dibaca/diperankan talent saat shooting.",
  naskah_editor_url: "Arahan untuk editor: urutan potongan, teks layar, B-roll, musik.",
  hak_pakai: "Organik + iklan berarti video kreator boleh dipakai untuk iklan berbayar.",
};
export const keUrl = (v) => (!v ? "" : /^https?:\/\//i.test(v) ? v : `https://${v}`);

export function LinkBuka({ href, label = "Buka" }) {
  if (!href) return null;
  return (
    <a href={keUrl(href)} target="_blank" rel="noopener noreferrer" title={`${label} di tab baru`}
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50">
      <ExternalLink size={13} /> {label}
    </a>
  );
}

// Satu isian dinamis. def = [kunci, label, tipe]; tipe: teks | area | url | angka | bucket | pilih:a,b,c
export function Field({ def, v, onChange, disabled, idp = "f" }) {
  const [k, label, tipe] = def;
  const id = `${idp}-${k}`;
  const lbl = <label htmlFor={id} className="text-[11px] font-medium text-emerald-900" title={BANTUAN[k] || ""}>{label}{BANTUAN[k] && <span className="ml-0.5 text-emerald-700/50">ⓘ</span>}</label>;
  const bantu = BANTUAN[k] && <p className="mt-0.5 text-[10px] leading-tight text-emerald-800/50">{BANTUAN[k]}</p>;
  if (tipe === "area") return <div className="col-span-full">{lbl}<Textarea id={id} rows={k === "isi" ? 4 : 2} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="bg-white text-xs" /></div>;
  if (tipe === "url") return (
    <div className="col-span-full">{lbl}
      <div className="flex gap-1.5">
        <Input id={id} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="https://…" className="h-9 bg-white text-xs" data-testid={`f-${k}`} />
        <LinkBuka href={v} />
      </div>{bantu}
    </div>
  );
  const opsi = tipe === "bucket" ? BUCKET : tipe.startsWith("pilih:") ? ["", ...tipe.slice(6).split(",")] : null;
  if (opsi) return (
    <div>{lbl}
      <select id={id} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-input bg-white px-2 text-xs">
        {[...new Set([...opsi, v || ""])].map((x) => <option key={x} value={x}>{x || "—"}</option>)}
      </select>{bantu}
    </div>
  );
  return (
    <div>{lbl}
      <Input id={id} value={tipe === "angka" && v ? Number(v).toLocaleString("id-ID") : v || ""} disabled={disabled} inputMode={tipe === "angka" ? "numeric" : undefined}
        onChange={(e) => onChange(tipe === "angka" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)} className="h-9 bg-white text-xs" />{bantu}
    </div>
  );
}

export function IsiFields({ fields, isi, setIsi, disabled, idp }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {fields.map((d) => <Field key={d[0]} def={d} v={isi[d[0]]} disabled={disabled} idp={idp} onChange={(v) => setIsi({ ...isi, [d[0]]: v })} />)}
    </div>
  );
}

export function PlatformPilih({ opsi, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(opsi).map(([k, l]) => {
        const on = value.includes(k);
        // Iklan eksklusif: memilih Iklan menghapus platform organik, dan sebaliknya.
        const klik = () => onChange(on ? value.filter((x) => x !== k) : k === "IKLAN" ? ["IKLAN"] : [...value.filter((x) => x !== "IKLAN"), k]);
        return (
          <button key={k} type="button" disabled={disabled} onClick={klik} data-testid={`plat-${k}`}
            className={`rounded-full border px-3 py-1 text-xs ${on ? (k === "IKLAN" ? "border-orange-600 bg-orange-500 text-white" : "border-emerald-800 bg-emerald-800 text-white") : k === "IKLAN" ? "border-orange-300 text-orange-800" : "border-emerald-200 text-emerald-900"}`}>{l}</button>
        );
      })}
    </div>
  );
}

// Jadwal per platform: tanggal + jam masing-masing. Iklan: satu tanggal produksi.
export function JadwalEditor({ platforms, jadwal, setJadwal, label, disabled, iklan, teks }) {
  const set = (p, kunci, v) => setJadwal({ ...jadwal, [p]: { ...(jadwal[p] || {}), [kunci]: v } });
  const samakan = () => { const a = jadwal[platforms[0]] || {}; setJadwal(Object.fromEntries(platforms.map((p) => [p, { ...a }]))); };
  if (!platforms.length) return <p className="text-[11px] text-amber-700">Pilih platform dulu.</p>;
  return (
    <div className="space-y-1.5" data-testid="jadwal-editor">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{iklan ? "Jadwal produksi (siap dipakai iklan)" : teks ? "Jadwal tayang" : "Jadwal posting per platform"}</p>
        {!iklan && !teks && platforms.length > 1 && !disabled && <button type="button" onClick={samakan} className="text-[11px] text-emerald-700 hover:underline">Samakan semua dengan {label(platforms[0])}</button>}
      </div>
      {platforms.map((p) => (
        <div key={p} className="grid grid-cols-[84px_1fr_110px] items-center gap-2">
          <span className="truncate text-[11px] text-emerald-900">{iklan ? "Produksi" : label(p)}</span>
          <Input type="date" value={jadwal[p]?.tanggal || ""} disabled={disabled} onChange={(e) => set(p, "tanggal", e.target.value)} className="h-9 bg-white text-xs" data-testid={`jadwal-tgl-${p}`} />
          {iklan ? <span /> : <Input type="time" value={jadwal[p]?.jam || ""} disabled={disabled} onChange={(e) => set(p, "jam", e.target.value)} className="h-9 bg-white px-1 text-xs" data-testid={`jadwal-jam-${p}`} />}
        </div>
      ))}
      {!iklan && !teks && <p className="text-[10px] text-emerald-800/50">Target produksi (editor/desainer) otomatis H-1 dari jadwal posting terdekat.</p>}
      {iklan && <p className="text-[10px] text-emerald-800/50">Konten iklan tidak terikat jadwal posting. Tanggal ini = target konten siap dipakai tim iklan.</p>}
    </div>
  );
}
