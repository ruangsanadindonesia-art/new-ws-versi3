import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Check, ExternalLink, ChevronDown, ChevronUp, Copy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { formatApiErr, useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";

// Paket mingguan untuk kanal teks (Threads, IG Story, WA Channel): 1 paket = 1 kanal × 1 pekan, 3 tahap.
export const P = {
  buat: (p) => api.post("/konten/paket", p).then((r) => r.data),
  posts: (id, posts) => api.put(`/konten/${id}/posts`, { posts }).then((r) => r.data),
  posting: (id, pid, p) => api.post(`/konten/${id}/posts/${pid}/posting`, p).then((r) => r.data),
  performa: (id, pid, p) => api.put(`/konten/${id}/posts/${pid}/performa`, p).then((r) => r.data),
  selesai: (id, tahap, catatan = "") => api.post(`/konten/${id}/tahap/${tahap}/selesai`, { catatan }).then((r) => r.data),
  revisi: (id, catatan) => api.post(`/konten/${id}/revisi`, { catatan }).then((r) => r.data),
  batal: (id) => api.post(`/konten/${id}/batal`).then((r) => r.data),
};

export const KANAL_WARNA = {
  VIDEO: "bg-emerald-100 text-emerald-900",
  THREADS: "bg-slate-900 text-white",
  STORY: "bg-fuchsia-100 text-fuchsia-900",
  WA: "bg-green-100 text-green-900",
};
const BUCKET = ["", "VALUE", "HUMAN", "SELL"];
const HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Ahad"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tambahHari = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
export const seninDari = (s) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const tglHari = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
const kosong = (tanggal, jam = "", label = "") => ({ tanggal, jam, label, hook: "", isi: "", cta: "", bucket: "", pilar: "", stiker: "", format: "", topik: "", lampiran_url: "", terkait_kode: "" });

function Field({ def, v, onChange }) {
  const [k, label, tipe] = def;
  const id = `pf-${k}-${Math.random().toString(36).slice(2, 7)}`;
  if (tipe === "area") return <div><label htmlFor={id} className="text-[11px] font-medium text-emerald-900">{label}</label><Textarea id={id} rows={k === "isi" ? 4 : 2} value={v || ""} onChange={(e) => onChange(e.target.value)} className="bg-white text-xs" /></div>;
  const opsi = tipe === "bucket" ? BUCKET : tipe.startsWith("pilih:") ? ["", ...tipe.slice(6).split(",")] : null;
  if (opsi) return (
    <div><label htmlFor={id} className="text-[11px] font-medium text-emerald-900">{label}</label>
      <select id={id} value={v || ""} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border border-input bg-white px-2 text-xs">
        {[...new Set([...opsi, v || ""])].map((x) => <option key={x} value={x}>{x || "—"}</option>)}
      </select></div>
  );
  return <div><label htmlFor={id} className="text-[11px] font-medium text-emerald-900">{label}</label><Input id={id} value={v || ""} onChange={(e) => onChange(k === "terkait_kode" ? e.target.value.toUpperCase() : e.target.value)} className="h-8 bg-white text-xs" /></div>;
}

// Editor daftar post paket. Field mengikuti kanal (dari /konten/meta → kanal_teks).
export function PaketEditor({ def, mulai, posts, setPosts }) {
  const [buka, setBuka] = useState(() => new Set(posts.length <= 3 ? posts.map((_, i) => i) : []));
  const hari = Array.from({ length: 7 }, (_, i) => tambahHari(mulai, i));
  const pendek = def.field.filter(([, , t]) => t !== "area");
  const panjang = def.field.filter(([, , t]) => t === "area");
  const set = (i, kunci, v) => setPosts(posts.map((p, j) => (j === i ? { ...p, [kunci]: v } : p)));
  const isiSlot = () => {
    const ada = new Set(posts.map((p) => `${p.tanggal}|${p.jam}`));
    const baru = hari.slice(0, 6).flatMap((t) => def.slot.map(([jam, label]) => kosong(t, jam, label))).filter((p) => !ada.has(`${p.tanggal}|${p.jam}`));
    setPosts([...posts, ...baru].sort((a, b) => `${a.tanggal}${a.jam}`.localeCompare(`${b.tanggal}${b.jam}`)));
    toast.success(`${baru.length} slot ditambahkan (Sen–Sab)`);
  };
  const tambah = () => {
    const akhir = posts[posts.length - 1];
    setPosts([...posts, kosong(akhir ? akhir.tanggal : mulai, def.slot[0][0], def.slot[0][1])]);
    setBuka(new Set([...buka, posts.length]));
  };
  const duplikat = (i) => { const { id: _id, diposting: _d, link: _l, performa: _p, ...rest } = posts[i]; setPosts([...posts.slice(0, i + 1), { ...rest }, ...posts.slice(i + 1)]); };
  const toggle = (i) => { const n = new Set(buka); n.has(i) ? n.delete(i) : n.add(i); setBuka(n); };
  return (
    <div className="space-y-2" data-testid="paket-editor">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-emerald-950">{posts.length} post</p>
        <span className="text-[11px] text-emerald-800/60">Slot standar: {def.slot.map(([j, l]) => (l ? `${j} ${l}` : j)).join(" · ")}</span>
        <div className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={isiSlot} className="h-7 text-[11px]" data-testid="paket-isi-slot"><Wand2 size={12} /> Isi slot Sen–Sab</Button>
          <Button type="button" size="sm" variant="outline" onClick={tambah} className="h-7 text-[11px]" data-testid="paket-tambah"><Plus size={12} /> Post</Button>
        </div>
      </div>
      {posts.length === 0 && <p className="rounded-lg border border-dashed border-emerald-200 p-4 text-center text-xs text-emerald-800/60">Belum ada post. Klik <b>Isi slot Sen–Sab</b> untuk membuat slot sesuai jadwal standar, lalu tulis copy-nya.</p>}
      {posts.map((p, i) => {
        const terbuka = buka.has(i);
        const ringkas = p.hook || p.isi || p.topik || "";
        return (
          <div key={p.id || `n${i}`} className={`rounded-lg border ${p.diposting ? "border-emerald-200 bg-emerald-50/40" : "border-emerald-100 bg-white"}`} data-testid={`paket-post-${i}`}>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <select value={p.tanggal} onChange={(e) => set(i, "tanggal", e.target.value)} className="h-7 rounded border border-input bg-white px-1 text-[11px]" aria-label="Hari">
                {hari.map((t, j) => <option key={t} value={t}>{HARI[j]} {Number(t.slice(8))}</option>)}
              </select>
              <Input type="time" value={p.jam} onChange={(e) => set(i, "jam", e.target.value)} className="h-7 w-[108px] shrink-0 bg-white px-1 text-[11px]" aria-label="Jam" />
              <button type="button" onClick={() => toggle(i)} className="min-w-0 flex-1 truncate text-left text-[11px] text-emerald-900">
                {p.label && <b className="mr-1">{p.label}</b>}{ringkas ? ringkas.slice(0, 80) : <span className="text-amber-700">belum diisi</span>}
              </button>
              {p.diposting && <Check size={13} className="text-emerald-600" />}
              <button type="button" onClick={() => toggle(i)} className="text-emerald-700" aria-label="Buka">{terbuka ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
            </div>
            {terbuka && (
              <div className="space-y-2 border-t border-emerald-50 p-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{pendek.map((d) => <Field key={d[0]} def={d} v={p[d[0]]} onChange={(v) => set(i, d[0], v)} />)}</div>
                {panjang.map((d) => <Field key={d[0]} def={d} v={p[d[0]]} onChange={(v) => set(i, d[0], v)} />)}
                <div className="flex justify-end gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => duplikat(i)} className="h-7 text-[11px]"><Copy size={12} /> Duplikat</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={p.diposting} onClick={() => setPosts(posts.filter((_, j) => j !== i))} className="h-7 text-[11px] text-red-600 hover:bg-red-50"><Trash2 size={12} /> Hapus</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Form "Konten baru" untuk kanal teks.
export function PaketBaru({ meta, kanal, onSaved, onBack }) {
  const def = meta.kanal_teks[kanal];
  const [mulai, setMulai] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return seninDari(ymd(d)); });
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState(false);
  const geserPekan = (v) => { const m = seninDari(v); const delta = (new Date(`${m}T00:00:00`) - new Date(`${mulai}T00:00:00`)) / 864e5; setMulai(m); setPosts(posts.map((p) => ({ ...p, tanggal: tambahHari(p.tanggal, delta) }))); };
  const simpan = async () => {
    setBusy(true);
    try { const k = await P.buat({ kanal, minggu_mulai: mulai, posts }); toast.success(`${k.kode} dibuat — 3 tugas otomatis (tulis, review, posting)`); onSaved(k); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div><label className="text-xs font-medium" htmlFor="pk-minggu">Pekan (mulai Senin)</label>
          <Input id="pk-minggu" type="date" value={mulai} onChange={(e) => e.target.value && geserPekan(e.target.value)} className="bg-white" data-testid="pk-minggu" /></div>
        <p className="pb-2 text-[11px] text-emerald-800/70">{tglHari(mulai)} – {tglHari(tambahHari(mulai, 6))}</p>
      </div>
      <PaketEditor def={def} mulai={mulai} posts={posts} setPosts={setPosts} />
      <div className="rounded-lg bg-emerald-50/60 p-2.5 text-[11px] text-emerald-900">
        <p><b>Tulis copy</b> — {def.pic.COPY.nama || "PIC belum diatur"} · tenggat {tglHari(tambahHari(mulai, -3))}</p>
        <p><b>Review isi</b> — {def.pic.REVIEW.nama || "PIC belum diatur"} · tenggat {tglHari(tambahHari(mulai, -2))}</p>
        <p><b>Posting harian</b> — {def.pic.POSTING.nama || "PIC belum diatur"} · sampai post terakhir</p>
        <p className="mt-1 text-emerald-800/60">Copy boleh dilengkapi nanti di kartu paket sebelum dikirim ke review.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onBack}>Kembali</Button>
        <Button onClick={simpan} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="pk-simpan">{busy && <Loader2 size={14} className="animate-spin" />} Buat paket</Button>
      </div>
    </div>
  );
}

function PerformaPost({ k, p, def, leads, onSaved }) {
  const [v, setV] = useState(() => Object.fromEntries([...def.metrik, ...leads].map(([f]) => [f, p.performa?.[f] ?? ""])));
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    const body = {};
    Object.entries(v).forEach(([f, x]) => { if (x !== "" && x != null) body[f] = Math.max(0, parseInt(x, 10) || 0); });
    setBusy(true);
    try { onSaved(await P.performa(k.id, p.id, body)); toast.success("Performa tersimpan"); } catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <div className="mt-2 space-y-2 rounded-md bg-white p-2">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {[...def.metrik, ...leads].map(([f, l]) => (
          <label key={f} className="text-[10px] text-emerald-800/70">{l}
            <Input inputMode="numeric" value={v[f] ?? ""} onChange={(e) => setV({ ...v, [f]: e.target.value.replace(/[^0-9]/g, "") })} className="h-7 bg-white text-[11px]" />
          </label>
        ))}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={simpan} className="h-7 text-[11px]">Simpan performa</Button>
    </div>
  );
}

const AKSI_TEKS = {
  COPY: { judul: "Tulis copy", cara: "Lengkapi copy semua post pekan ini (klik Ubah post). Setelah lengkap, kirim ke review.", tombol: "Copy lengkap → kirim ke review" },
  REVIEW: { judul: "Review isi", cara: "Baca seluruh paket: akurasi tajwid/sanad, adab bahasa, CTA. Setujui sekali untuk seluruh paket, atau minta revisi ke penulis." },
  POSTING: { judul: "Posting harian", cara: "Posting tiap post sesuai jadwal, lalu centang dan tempel link-nya. Semua post tercentang = tahap selesai otomatis." },
};

// Detail paket mingguan (Sheet).
export function DetailPaket({ k, meta, onClose, onSaved }) {
  const { user } = useAuth();
  const def = meta.kanal_teks[k.kanal];
  const [edit, setEdit] = useState(false);
  const [posts, setPosts] = useState(k.posts || []);
  const [links, setLinks] = useState({});
  const [perf, setPerf] = useState(null);
  const [catatan, setCatatan] = useState("");
  const [modeRevisi, setModeRevisi] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPosts(k.posts || []); setLinks(Object.fromEntries((k.posts || []).map((p) => [p.id, p.link || ""]))); setEdit(false); }, [k]);
  const aktif = k.status === "AKTIF";
  const cur = k.tahapan.find((t) => t.tahap === k.tahap);
  const saya = user?.anggota_id;
  const bolehTahap = (t) => meta.bisa_kelola || (saya && k.tahapan.find((x) => x.tahap === t)?.pic_id === saya);
  const bolehEdit = meta.bisa_kelola || (saya && def.pic.COPY.id === saya);
  const reviewBeres = k.tahapan.filter((t) => t.tahap !== "POSTING").every((t) => t.selesai);
  const jalan = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast.success(ok); onSaved(r?.id ? r : null); return r; } catch (e) { toast.error(formatApiErr(e)); } finally { setBusy(false); } return null; };
  const perHari = useMemo(() => {
    const g = {};
    (k.posts || []).forEach((p) => { (g[p.tanggal] = g[p.tanggal] || []).push(p); });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [k.posts]);
  const kiniWib = new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 16);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="paket-detail">
        <SheetHeader className="text-left">
          <p className="flex items-center gap-2 font-mono text-xs text-emerald-800/60"><span className={`rounded px-1.5 py-px font-sans text-[10px] font-semibold ${KANAL_WARNA[k.kanal]}`}>{def.label}</span>{k.kode} · {k.tahap_label}</p>
          <SheetTitle className="font-display text-lg leading-snug">{k.judul}</SheetTitle>
          <SheetDescription className="text-xs text-emerald-800/70">{k.post_diposting}/{k.post_jumlah} post diposting{k.post_telat ? ` · ${k.post_telat} lewat jam tayang` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-4 text-sm">
          {k.tahapan.length > 0 && (
            <ol className="grid grid-cols-3 gap-1.5">
              {k.tahapan.map((t) => (
                <li key={t.tahap} className={`rounded-lg border px-2 py-1.5 text-[11px] ${t.selesai ? "border-emerald-200 bg-emerald-50" : t.telat ? "border-red-200 bg-red-50" : t.tahap === k.tahap ? "border-emerald-400 bg-white" : "border-emerald-100 bg-white"}`}>
                  <p className="flex items-center gap-1 font-semibold text-emerald-950">{t.selesai && <Check size={11} className="text-emerald-600" />}{t.label}</p>
                  <p className="truncate text-emerald-800/70">{t.pic_nama || "-"}</p>
                  <p className={t.telat ? "font-semibold text-red-600" : "text-emerald-800/50"}>{t.deadline ? tglHari(t.deadline) : "—"}</p>
                </li>
              ))}
            </ol>
          )}

          {aktif && cur && AKSI_TEKS[cur.tahap] && (
            <section className={`rounded-lg border p-3 ${cur.telat ? "border-red-200 bg-red-50/40" : "border-emerald-200 bg-emerald-50/50"}`} data-testid="pk-aksi">
              <p className="text-xs font-semibold text-emerald-950">Sekarang: {AKSI_TEKS[cur.tahap].judul} <span className="font-normal text-emerald-800/70">· PIC {cur.pic_nama || "-"}</span></p>
              <p className="mt-1 text-[11px] text-emerald-900/80">{AKSI_TEKS[cur.tahap].cara}</p>
              {cur.revisi_catatan && <p className="mt-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-800"><b>Revisi dari review:</b> {cur.revisi_catatan}</p>}
              {!bolehTahap(cur.tahap) ? <p className="mt-2 text-[11px] font-medium text-amber-800">Menunggu {cur.pic_nama || "PIC"}.</p>
                : cur.tahap === "COPY" ? (
                  <Button size="sm" disabled={busy || !k.post_jumlah} onClick={() => jalan(() => P.selesai(k.id, "COPY"), "Dikirim ke review")} className="mt-2 bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="pk-kirim-review">{AKSI_TEKS.COPY.tombol}</Button>
                ) : cur.tahap === "REVIEW" ? (modeRevisi ? (
                  <div className="mt-2 space-y-2">
                    <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Post mana & apa yang perlu diperbaiki? (wajib)" className="bg-white text-xs" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || catatan.trim().length < 3} onClick={() => jalan(() => P.revisi(k.id, catatan), "Dikembalikan ke penulis").then(() => { setModeRevisi(false); setCatatan(""); })} className="bg-red-600 text-xs text-white hover:bg-red-700">Kirim revisi</Button>
                      <Button size="sm" variant="ghost" onClick={() => setModeRevisi(false)} className="text-xs">Batal</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => jalan(() => P.selesai(k.id, "REVIEW"), "Paket disetujui — siap diposting")} className="bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="pk-setujui">Setujui paket</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setModeRevisi(true)} className="border-red-200 text-xs text-red-700 hover:bg-red-50">Minta revisi</Button>
                  </div>
                )) : null}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-emerald-900">Post pekan ini</p>
              {aktif && bolehEdit && !edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)} className="ml-auto h-7 text-[11px]" data-testid="pk-ubah">Ubah post</Button>}
            </div>
            {edit ? (
              <>
                <PaketEditor def={def} mulai={k.minggu_mulai} posts={posts} setPosts={setPosts} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => jalan(() => P.posts(k.id, posts), "Post disimpan").then((r) => r && setEdit(false))} className="bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="pk-simpan-post">Simpan post</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPosts(k.posts || []); setEdit(false); }} className="text-xs">Batal</Button>
                </div>
              </>
            ) : perHari.length === 0 ? <p className="text-xs text-emerald-800/60">Belum ada post.</p> : perHari.map(([tgl, list]) => (
              <div key={tgl} className="rounded-lg border border-emerald-100">
                <p className="border-b border-emerald-50 bg-emerald-50/50 px-3 py-1 text-[11px] font-semibold text-emerald-900">{tglHari(tgl)}</p>
                <ul className="divide-y divide-emerald-50">
                  {list.map((p) => {
                    const lewat = !p.diposting && aktif && `${p.tanggal}T${p.jam || "23:59"}` < kiniWib;
                    const bolehPosting = aktif && reviewBeres && bolehTahap("POSTING");
                    return (
                      <li key={p.id} className="px-3 py-2" data-testid={`pk-post-${p.id}`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-0.5 w-11 shrink-0 text-[11px] tabular-nums ${lewat ? "font-semibold text-red-600" : "text-emerald-800/70"}`}>{p.jam || "—"}</span>
                          <div className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">
                            <p className="text-[10px] text-emerald-800/60">{[p.label, p.format, p.topik, p.bucket, p.pilar, p.stiker].filter(Boolean).join(" · ")}</p>
                            {p.hook && <p className="font-semibold text-emerald-950">{p.hook}</p>}
                            {p.isi && <p className="line-clamp-4 whitespace-pre-line text-emerald-900/90">{p.isi}</p>}
                            {p.cta && <p className="mt-0.5 text-emerald-800"><b>CTA:</b> {p.cta}</p>}
                            {p.lampiran_url && <a href={p.lampiran_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-700 underline">lampiran</a>}
                            {p.terkait_kode && <span className="ml-1 rounded bg-emerald-100 px-1 font-mono text-[10px]">{p.terkait_kode}</span>}
                          </div>
                          {p.diposting ? <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-emerald-700"><Check size={12} /> tayang</span>
                            : lewat ? <span className="shrink-0 text-[10px] font-semibold text-red-600">lewat jam</span> : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[52px]">
                          {bolehPosting && (
                            <>
                              <Input value={links[p.id] || ""} onChange={(e) => setLinks({ ...links, [p.id]: e.target.value })} placeholder="Link post (opsional)" className="h-7 min-w-0 flex-1 basis-40 bg-white text-[11px] sm:max-w-[220px]" />
                              <Button size="sm" variant={p.diposting ? "outline" : "default"} disabled={busy} onClick={() => jalan(() => P.posting(k.id, p.id, { diposting: !p.diposting, link: links[p.id] || "" }), p.diposting ? "Tanda posting dibatalkan" : "Ditandai sudah diposting")}
                                className={`h-7 text-[11px] ${p.diposting ? "" : "bg-emerald-900 text-white hover:bg-emerald-800"}`} data-testid={`pk-posting-${p.id}`}>{p.diposting ? "Batalkan" : "Sudah diposting"}</Button>
                            </>
                          )}
                          {!bolehPosting && p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[11px] text-emerald-700"><ExternalLink size={11} /> buka post</a>}
                          {p.diposting && <button onClick={() => setPerf(perf === p.id ? null : p.id)} className="text-[11px] font-medium text-emerald-700 underline">{p.performa ? `Performa: ${p.performa.views ?? "—"} views` : "Isi performa"}</button>}
                        </div>
                        {perf === p.id && <div className="pl-[52px]"><PerformaPost k={k} p={p} def={def} leads={meta.leads} onSaved={(r) => { onSaved(r); setPerf(null); }} /></div>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {aktif && !reviewBeres && <p className="text-[10px] text-emerald-800/50">Tombol posting muncul setelah paket disetujui di tahap Review.</p>}
          </section>

          {meta.bisa_kelola && aktif && (
            <div className="border-t border-emerald-50 pt-3">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Batalkan paket ini? Tugas yang belum selesai diarsipkan.") && jalan(() => P.batal(k.id), "Paket dibatalkan").then(onClose)} className="text-red-600 hover:bg-red-50">Batalkan paket</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
