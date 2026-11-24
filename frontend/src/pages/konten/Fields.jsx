import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const BUCKET = ["", "VALUE", "HUMAN", "SELL"];
const BANTUAN = {
  bucket: "VALUE = edukasi/ilmu, HUMAN = cerita/kedekatan, SELL = ajakan daftar/promo.",
  cta_keyword: "Kata yang diminta dikomentari/di-DM penonton (mis. SANAD). Dipakai melacak leads dari konten ini.",
};

// Satu isian dinamis. def = [kunci, label, tipe]; tipe: teks | area | bucket | pilih:a,b,c
export function Field({ def, v, onChange, disabled, idp = "f" }) {
  const [k, label, tipe] = def;
  const id = `${idp}-${k}`;
  const lbl = <label htmlFor={id} className="text-[11px] font-medium text-emerald-900" title={BANTUAN[k] || ""}>{label}{BANTUAN[k] && <span className="ml-0.5 text-emerald-700/50">ⓘ</span>}</label>;
  if (tipe === "area") return <div className="col-span-full">{lbl}<Textarea id={id} rows={k === "isi" ? 4 : 2} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="bg-white text-xs" /></div>;
  const opsi = tipe === "bucket" ? BUCKET : tipe.startsWith("pilih:") ? ["", ...tipe.slice(6).split(",")] : null;
  if (opsi) return (
    <div>{lbl}
      <select id={id} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-input bg-white px-2 text-xs">
        {[...new Set([...opsi, v || ""])].map((x) => <option key={x} value={x}>{x || "—"}</option>)}
      </select>
      {BANTUAN[k] && <p className="mt-0.5 text-[10px] leading-tight text-emerald-800/50">{BANTUAN[k]}</p>}
    </div>
  );
  return (
    <div>{lbl}
      <Input id={id} value={v || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 bg-white text-xs" />
      {BANTUAN[k] && <p className="mt-0.5 text-[10px] leading-tight text-emerald-800/50">{BANTUAN[k]}</p>}
    </div>
  );
}

export function IsiFields({ def, isi, setIsi, disabled, idp }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {def.field.map((d) => <Field key={d[0]} def={d} v={isi[d[0]]} disabled={disabled} idp={idp} onChange={(v) => setIsi({ ...isi, [d[0]]: v })} />)}
    </div>
  );
}

export function PlatformPilih({ meta, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(meta.platform).map(([k, l]) => (
        <button key={k} type="button" disabled={disabled} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}
          className={`rounded-full border px-3 py-1 text-xs ${value.includes(k) ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900"}`}>{l}</button>
      ))}
    </div>
  );
}
