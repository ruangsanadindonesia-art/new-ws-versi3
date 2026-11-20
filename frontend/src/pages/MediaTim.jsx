import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Upload, Search, Pin, PinOff, Trash2, ExternalLink, FileText, Image as ImageIcon, FolderOpen, Loader2, Pencil, LayoutGrid, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatApiErr } from "@/lib/AuthContext";
import { mediaList, mediaAddLink, mediaUpload, mediaUpdate, mediaDelete, mediaFileUrl, listDivisi } from "@/lib/api";

const fmtUkuran = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export default function MediaTim() {
  const [d, setD] = useState(null);
  const [divisi, setDivisi] = useState([]);
  const [q, setQ] = useState("");
  const [kat, setKat] = useState("");
  const [timFilter, setTimFilter] = useState("");
  const [dlg, setDlg] = useState(null); // {mode: "link"|"file"|"edit", item?}
  const [tampil, setTampilState] = useState(() => { try { return localStorage.getItem("ws_media_view_v1") || "kartu"; } catch { return "kartu"; } });
  const setTampil = (v) => { setTampilState(v); try { localStorage.setItem("ws_media_view_v1", v); } catch { /* abaikan */ } };

  const load = () => mediaList({ ...(kat ? { kategori: kat } : {}), ...(timFilter ? { divisi_id: timFilter } : {}) })
    .then(setD).catch((e) => toast.error(formatApiErr(e)));
  // eslint-disable-next-line
  useEffect(() => { load(); }, [kat, timFilter]);
  useEffect(() => { listDivisi().then(setDivisi).catch(() => {}); }, []);
  const dNama = useMemo(() => Object.fromEntries(divisi.map((x) => [x.id, x.nama])), [divisi]);

  const items = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return s ? d.items.filter((m) => `${m.judul} ${m.catatan} ${m.nama_file || ""} ${m.url || ""}`.toLowerCase().includes(s)) : d.items;
  }, [d, q]);

  const sematkan = async (m) => { try { await mediaUpdate(m.id, { disematkan: !m.disematkan }); load(); } catch (e) { toast.error(formatApiErr(e)); } };
  const hapus = async (m) => {
    if (!window.confirm(`Hapus "${m.judul}"?${m.tipe === "FILE" ? " File ikut terhapus permanen." : ""}`)) return;
    try { await mediaDelete(m.id); toast.success("Dihapus"); load(); } catch (e) { toast.error(formatApiErr(e)); }
  };

  if (!d) return <p className="p-8 text-center text-sm text-emerald-800/60">Memuat media…</p>;

  return (
    <div className="space-y-4" data-testid="media-page">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white p-3">
        <FolderOpen size={18} className="text-emerald-700" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-emerald-950">Media Tim</p>
          <p className="text-[11px] text-emerald-800/70">Simpan link (Drive, Canva, Figma…) dan file kecil ≤ 10 MB yang sering dipakai tim: SOP, template, aset desain, laporan.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDlg({ mode: "link" })} data-testid="media-add-link"><Link2 size={14} /> Simpan link</Button>
        <Button size="sm" onClick={() => setDlg({ mode: "file" })} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="media-add-file"><Upload size={14} /> Upload file</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700/60" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul, catatan, nama file…" className="h-9 pl-9" data-testid="media-search" />
        </div>
        <select value={kat} onChange={(e) => setKat(e.target.value)} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-sm" data-testid="media-kategori">
          <option value="">Semua kategori</option>
          {d.kategori.map((k) => <option key={k}>{k}</option>)}
        </select>
        <div className="flex rounded-lg border border-emerald-200 bg-white p-1" role="group" aria-label="Tampilan">
          <button onClick={() => setTampil("kartu")} data-testid="media-view-kartu" className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${tampil === "kartu" ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><LayoutGrid size={13} /> Kartu</button>
          <button onClick={() => setTampil("tabel")} data-testid="media-view-tabel" className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${tampil === "tabel" ? "bg-emerald-900 text-white" : "text-emerald-800"}`}><TableIcon size={13} /> Tabel</button>
        </div>
        {d.is_spv && (
          <select value={timFilter} onChange={(e) => setTimFilter(e.target.value)} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-sm">
            <option value="">Semua tim</option>
            <option value="LEMBAGA">Lembaga (semua tim)</option>
            {divisi.map((x) => <option key={x.id} value={x.id}>{x.nama}</option>)}
          </select>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">
          Belum ada media{q || kat ? " yang cocok" : ""}. Mulai dengan menyimpan link folder Drive tim atau SOP yang paling sering dicari.
        </div>
      ) : tampil === "tabel" ? (
        <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white" data-testid="media-tabel">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-emerald-50/60 text-left text-[11px] uppercase tracking-wide text-emerald-800/70">
              <tr><th className="px-3 py-2 font-semibold">Judul</th><th className="px-3 py-2 font-semibold">Kategori</th><th className="px-3 py-2 font-semibold">Tim</th>
                <th className="px-3 py-2 font-semibold">Jenis</th><th className="px-3 py-2 font-semibold">Oleh</th><th className="px-3 py-2 font-semibold">Tanggal</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-emerald-50 align-middle hover:bg-emerald-50/30" data-testid={`media-row-${m.id}`}>
                  <td className="max-w-[320px] px-3 py-2">
                    <a href={m.tipe === "LINK" ? m.url : mediaFileUrl(m.id)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-medium text-emerald-950 hover:text-emerald-700 hover:underline">
                      {m.tipe === "LINK" ? <Link2 size={13} className="shrink-0 text-emerald-600" /> : (m.mime || "").startsWith("image/") ? <ImageIcon size={13} className="shrink-0 text-emerald-600" /> : <FileText size={13} className="shrink-0 text-emerald-600" />}
                      <span className="truncate">{m.judul}</span>
                    </a>
                    {(m.disematkan || m.catatan) && <p className="truncate pl-5 text-[11px] text-emerald-800/60">{m.disematkan && <b className="text-amber-700">Disematkan </b>}{m.catatan}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-900">{m.kategori}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-900">{m.divisi_id ? dNama[m.divisi_id] || "Tim" : "Lembaga"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-800/70">{m.tipe === "LINK" ? domain(m.url) : fmtUkuran(m.ukuran)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-emerald-800/70">{m.dibuat_oleh}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-emerald-800/70">{new Date(m.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {m.bisa_ubah && (
                      <span className="inline-flex gap-0.5">
                        <button onClick={() => sematkan(m)} title={m.disematkan ? "Lepas sematan" : "Sematkan"} className="rounded p-1 text-amber-700 hover:bg-amber-50">{m.disematkan ? <PinOff size={14} /> : <Pin size={14} />}</button>
                        <button onClick={() => setDlg({ mode: "edit", item: m })} title="Ubah" className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Pencil size={14} /></button>
                        <button onClick={() => hapus(m)} title="Hapus" className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {items.map((m) => (
            <li key={m.id} className={`flex gap-3 rounded-xl border bg-white p-3 ${m.disematkan ? "border-amber-300" : "border-emerald-100"}`} data-testid={`media-${m.id}`}>
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                {m.tipe === "LINK" ? <Link2 size={16} /> : (m.mime || "").startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <a href={m.tipe === "LINK" ? m.url : mediaFileUrl(m.id)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 font-medium text-emerald-950 hover:text-emerald-700 hover:underline">
                  <span className="truncate">{m.judul}</span><ExternalLink size={12} className="shrink-0" />
                </a>
                <p className="truncate text-[11px] text-emerald-800/60">
                  {m.disematkan && <span className="mr-1 font-semibold text-amber-700">Disematkan ·</span>}
                  {m.kategori} · {m.divisi_id ? dNama[m.divisi_id] || "Tim" : "Lembaga"} · {m.tipe === "LINK" ? domain(m.url) : `${m.nama_file} (${fmtUkuran(m.ukuran)})`}
                </p>
                {m.catatan && <p className="mt-1 line-clamp-2 text-xs text-emerald-900/80">{m.catatan}</p>}
                <p className="mt-1 text-[10px] text-emerald-800/40">oleh {m.dibuat_oleh} · {new Date(m.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</p>
              </div>
              {m.bisa_ubah && (
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button onClick={() => sematkan(m)} title={m.disematkan ? "Lepas sematan" : "Sematkan di atas"} className="rounded p-1 text-amber-700 hover:bg-amber-50">{m.disematkan ? <PinOff size={14} /> : <Pin size={14} />}</button>
                  <button onClick={() => setDlg({ mode: "edit", item: m })} title="Ubah" className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Pencil size={14} /></button>
                  <button onClick={() => hapus(m)} title="Hapus" className="rounded p-1 text-red-600 hover:bg-red-50" data-testid={`media-hapus-${m.id}`}><Trash2 size={14} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <MediaDialog dlg={dlg} onClose={() => setDlg(null)} kategori={d.kategori} isSpv={d.is_spv} divisi={divisi} onSaved={() => { setDlg(null); load(); }} />
    </div>
  );
}

function MediaDialog({ dlg, onClose, kategori, isSpv, divisi, onSaved }) {
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dlg) return;
    const it = dlg.item || {};
    setF({ judul: it.judul || "", url: it.url || "", kategori: it.kategori || "Lainnya", catatan: it.catatan || "", divisi_id: "" });
    setFile(null);
  }, [dlg]);
  if (!dlg) return null;
  const mode = dlg.mode;
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "link") {
        if (!f.judul.trim() || !f.url.trim()) { toast.error("Isi judul dan link"); setBusy(false); return; }
        await mediaAddLink({ ...f, divisi_id: f.divisi_id || null });
      } else if (mode === "file") {
        if (!file) { toast.error("Pilih file"); setBusy(false); return; }
        if (file.size > 10 * 1024 * 1024) { toast.error("File lebih dari 10 MB. Upload ke Drive lalu simpan link-nya."); setBusy(false); return; }
        const fd = new FormData();
        fd.append("file", file); fd.append("judul", f.judul || file.name); fd.append("kategori", f.kategori); fd.append("catatan", f.catatan);
        if (f.divisi_id) fd.append("divisi_id", f.divisi_id);
        await mediaUpload(fd);
      } else {
        await mediaUpdate(dlg.item.id, { judul: f.judul, kategori: f.kategori, catatan: f.catatan, ...(dlg.item.tipe === "LINK" ? { url: f.url } : {}) });
      }
      toast.success("Tersimpan"); onSaved();
    } catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  const showUrl = mode === "link" || (mode === "edit" && dlg.item.tipe === "LINK");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="media-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{mode === "link" ? "Simpan link" : mode === "file" ? "Upload file" : "Ubah media"}</DialogTitle>
          <DialogDescription className="text-emerald-800/70">{mode === "file" ? "PDF, dokumen Office, gambar, CSV, ZIP, audio — maksimal 10 MB." : "Link Google Drive, Canva, Figma, Notion, YouTube, dll."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {mode === "file" && <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="media-file" className="block w-full text-sm" />}
          {showUrl && <div><label className="text-xs font-medium" htmlFor="md-url">Link</label><Input id="md-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://drive.google.com/…" data-testid="media-url" /></div>}
          <div><label className="text-xs font-medium" htmlFor="md-judul">Judul</label><Input id="md-judul" value={f.judul} onChange={(e) => setF({ ...f, judul: e.target.value })} placeholder={mode === "file" ? "Kosongkan untuk pakai nama file" : "mis. Folder aset desain 2026"} data-testid="media-judul" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs font-medium" htmlFor="md-kat">Kategori</label>
              <select id="md-kat" value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">{kategori.map((k) => <option key={k}>{k}</option>)}</select></div>
            {isSpv && mode !== "edit" && (
              <div><label className="text-xs font-medium" htmlFor="md-tim">Untuk</label>
                <select id="md-tim" value={f.divisi_id} onChange={(e) => setF({ ...f, divisi_id: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
                  <option value="">Lembaga (semua tim)</option>{divisi.map((x) => <option key={x.id} value={x.id}>{x.nama}</option>)}</select></div>
            )}
          </div>
          <div><label className="text-xs font-medium" htmlFor="md-cat">Catatan <span className="text-emerald-700/50">(opsional)</span></label><Textarea id="md-cat" rows={2} value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} placeholder="Kapan dipakai, versi terbaru, siapa yang mengelola…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="media-save">{busy && <Loader2 size={14} className="animate-spin" />} Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
