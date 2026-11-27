import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, AlertTriangle, History, CalendarClock, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { formatApiErr } from "@/lib/AuthContext";
import { K, JenisBadge, StatusBadge, tglPendek, PERAN_LABEL, platformLabel } from "./shared";
import { IsiFields, JadwalEditor, LinkBuka, Field } from "./Fields";

const SESUDAH_TAYANG = ["POSTED", "LAPORAN", "SELESAI"];
const PRODUKSI = ["SHOOTING", "SHOOTED", "EDITING", "SCRIPTED", "DESIGN", "REVIEW", "REVISI", "DRAFT"];

function Alur({ k }) {
  const idx = k.alur.findIndex((a) => a.k === k.status_konten);
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Alur status">
      {k.alur.map((a, i) => (
        <li key={a.k} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${i < idx ? "bg-emerald-100 text-emerald-800" : i === idx ? "bg-emerald-900 text-white" : "bg-slate-100 text-slate-500"}`}>
          {i < idx && <Check size={9} className="mb-px mr-0.5 inline" />}{a.label}
        </li>
      ))}
    </ol>
  );
}

function PanelAksi({ k, meta, jalan, busy }) {
  const [hasil, setHasil] = useState(k.hasil_url || "");
  const [catatan, setCatatan] = useState("");
  const [links, setLinks] = useState(k.links || {});
  const [ekstra, setEkstra] = useState({});
  const [revisi, setRevisi] = useState(false);
  useEffect(() => { setHasil(k.hasil_url || ""); setLinks(k.links || {}); setCatatan(""); setRevisi(false); setEkstra({}); }, [k]);
  const def = meta.jenis[k.jenis];
  const alur = k.iklan ? def.alur_iklan : def.alur;
  const st = alur.find((a) => a.k === k.status_konten);
  const boleh = (a) => meta.bisa_kelola || (meta.anggota_id && a.oleh_id === meta.anggota_id);
  const butuh = (w) => k.aksi.some((a) => a.wajib === w && boleh(a));
  const plats = k.platforms || [];
  const fieldIklan = def.field_iklan || [];
  const fieldBrief = def.field.filter((x) => x[0] === "brief_url");
  return (
    <section className={`rounded-lg border p-3 ${k.status_konten === "REVIEW" ? "border-yellow-400 bg-yellow-50" : k.terlambat ? "border-red-200 bg-red-50/40" : "border-emerald-200 bg-emerald-50/50"}`} data-testid="kt-aksi">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-xs font-semibold text-emerald-950">Sekarang: {k.status_label}</p>
        <span className="text-[11px] text-emerald-800/70">dikerjakan {k.pelaksana_nama || "-"}{k.deadline && <> · target {tglPendek(k.deadline)}{k.deadline_jam ? ` ${k.deadline_jam}` : ""}</>}
          {k.terlambat && <b className="text-red-600"> · terlambat</b>}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/80">{st?.instruksi}</p>
      <p className="mt-1 text-[10px] text-emerald-800/60">Muncul di Tugas: {k.pemegang_nama.join(", ") || "—"}</p>
      {k.status_konten === "REVISI" && k.revisi_catatan && <p className="mt-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-800"><b>Catatan revisi:</b> {k.revisi_catatan}</p>}
      {k.status_konten === "POSTED" && <p className="mt-2 text-[11px] text-sky-800">Otomatis menjadi <b>Laporan</b> 72 jam setelah tayang{k.posted_at ? ` (${new Date(new Date(k.posted_at).getTime() + 72 * 36e5).toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.</p>}
      {k.status_konten === "LAPORAN" && <p className="mt-2 text-[11px] text-sky-800">Isi {k.iklan ? "laporan iklan" : "performa"} di bawah. Setelah terisi → otomatis <b>Selesai</b>.</p>}

      {k.aksi.length > 0 && (
        <div className="mt-2 space-y-2">
          {butuh("hasil") && <div className="flex gap-1.5"><Input value={hasil} onChange={(e) => setHasil(e.target.value)} placeholder={k.jenis === "KOL" ? "Link draft dari kreator — wajib" : "Link hasil (Drive / Canva) — wajib"} className="h-9 bg-white text-xs" data-testid="kt-hasil" /><LinkBuka href={hasil} /></div>}
          {butuh("iklan") && <div className="grid gap-2 sm:grid-cols-2">{fieldIklan.map((d) => <Field key={d[0]} def={d} v={ekstra[d[0]] ?? k[d[0]]} idp="ka" onChange={(v) => setEkstra({ ...ekstra, [d[0]]: v })} />)}</div>}
          {butuh("brief") && fieldBrief.map((d) => <Field key={d[0]} def={d} v={ekstra[d[0]] ?? k[d[0]]} idp="ka" onChange={(v) => setEkstra({ ...ekstra, [d[0]]: v })} />)}
          {(butuh("link") || (k.grup === "TEKS" && k.aksi.some((a) => a.k === "tayang" && boleh(a)))) && (
            <div className="space-y-1">
              {plats.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-emerald-800/70">{platformLabel(meta, p)}<br /><span className="text-[10px] text-emerald-800/50">{tglPendek(k.jadwal?.[p]?.tanggal)} {k.jadwal?.[p]?.jam}</span></span>
                  <Input value={links[p] || ""} onChange={(e) => setLinks({ ...links, [p]: e.target.value })} placeholder={k.grup === "TEKS" ? "Link post (opsional)" : "https://… (wajib)"} className="h-8 bg-white text-xs" data-testid={`kt-link-${p}`} />
                </div>
              ))}
            </div>
          )}
          {revisi && <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Apa yang perlu diperbaiki? (wajib)" className="bg-white text-xs" data-testid="kt-revisi-catatan" />}
          <div className="flex flex-wrap gap-2">
            {k.aksi.map((a) => {
              const izin = boleh(a);
              if (a.wajib === "catatan") {
                return revisi ? (
                  <span key={a.k} className="flex gap-2">
                    <Button size="sm" disabled={busy || !izin || catatan.trim().length < 3} onClick={() => jalan(() => K.aksi(k.id, { aksi: a.k, catatan }), "Dikembalikan untuk revisi")} className="bg-red-600 text-xs text-white hover:bg-red-700" data-testid="kt-revisi-kirim">Kirim revisi</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRevisi(false)} className="text-xs">Batal</Button>
                  </span>
                ) : <Button key={a.k} size="sm" variant="outline" disabled={busy || !izin} onClick={() => setRevisi(true)} className="border-red-200 text-xs text-red-700 hover:bg-red-50" data-testid="kt-aksi-revisi">{a.label}</Button>;
              }
              if (revisi) return null;
              return (
                <Button key={a.k} size="sm" disabled={busy || !izin} title={izin ? "" : `Dikerjakan ${PERAN_LABEL[a.peran] || a.peran}`}
                  onClick={() => jalan(() => K.aksi(k.id, { aksi: a.k, hasil_url: hasil, links, isi: Object.keys(ekstra).length ? ekstra : null }), `Status: ${k.alur.find((x) => x.k === a.ke)?.label}`)}
                  className="bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid={`kt-aksi-${a.k}`}>{a.label}</Button>
              );
            })}
          </div>
          {!k.aksi.some(boleh) && <p className="text-[11px] font-medium text-amber-800">Menunggu {k.pelaksana_nama || "PIC"} menyelesaikan langkah ini.</p>}
        </div>
      )}
    </section>
  );
}

function DeadlineProduksi({ k, meta, jalan, busy }) {
  const [buka, setBuka] = useState(false);
  const [tgl, setTgl] = useState("");
  const [alasan, setAlasan] = useState("");
  const req = k.permintaan_deadline;
  const menunggu = req?.status === "MENUNGGU";
  const saya = meta.anggota_id && (k.pemegang_ids || []).includes(meta.anggota_id);
  const bisaMinta = !meta.bisa_kelola && saya && PRODUKSI.includes(k.status_konten) && !menunggu;
  if (!k.target_produksi) return null;
  return (
    <section className="rounded-lg border border-emerald-100 p-3 text-xs" data-testid="kt-deadline">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={13} className="text-emerald-700" />
        <span className="text-emerald-900">{k.iklan ? "Target produksi iklan" : "Target produksi (editor/desainer)"}: <b>{tglPendek(k.target_produksi)}</b></span>
        {k.deadline_produksi && <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-800">hasil permintaan disetujui</span>}
        {bisaMinta && !buka && <Button size="sm" variant="outline" onClick={() => setBuka(true)} className="ml-auto h-7 text-[11px]" data-testid="kt-minta-dl">Minta perpanjangan</Button>}
      </div>
      {buka && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2"><Input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} className="h-8 w-40 bg-white text-xs" aria-label="Tanggal diminta" />
            <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan (wajib)" className="h-8 bg-white text-xs" /></div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !tgl || alasan.trim().length < 3} onClick={() => jalan(() => K.mintaDeadline(k.id, tgl, alasan), "Permintaan dikirim ke lead").then(() => setBuka(false))} className="h-7 bg-emerald-900 text-[11px] text-white">Kirim permintaan</Button>
            <Button size="sm" variant="ghost" onClick={() => setBuka(false)} className="h-7 text-[11px]">Batal</Button>
          </div>
        </div>
      )}
      {menunggu && (
        <div className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-amber-900">
          <b>{req.oleh}</b> minta deadline {tglPendek(req.deadline_lama)} → <b>{tglPendek(req.tanggal)}</b>: {req.alasan}
          {meta.bisa_kelola && (
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => jalan(() => K.putusDeadline(k.id, true), "Deadline produksi diperpanjang")} className="h-7 bg-emerald-900 text-[11px] text-white" data-testid="kt-setujui-dl">Setujui</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => jalan(() => K.putusDeadline(k.id, false), "Permintaan ditolak")} className="h-7 text-[11px]">Tolak</Button>
            </div>
          )}
          {!meta.bisa_kelola && <p className="mt-0.5 text-amber-800/70">Menunggu keputusan lead.</p>}
        </div>
      )}
      {req && !menunggu && <p className="mt-1 text-[10px] text-emerald-800/60">Permintaan terakhir ({tglPendek(req.tanggal)}) {req.status === "DISETUJUI" ? "disetujui" : "ditolak"} oleh {req.diputus_oleh}.</p>}
    </section>
  );
}

function PerformaForm({ k, meta, onSaved }) {
  const def = meta.jenis[k.jenis];
  const plats = k.platforms || [];
  const [p, setP] = useState(plats[0]);
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  const metrik = k.iklan ? def.metrik_iklan : [...def.metrik, ...meta.leads];
  useEffect(() => { setV(Object.fromEntries(metrik.map(([f]) => [f, k.performa?.[p]?.[f] ?? ""]))); }, [p, k]); // eslint-disable-line react-hooks/exhaustive-deps
  const simpan = async () => {
    const body = { platform: p };
    metrik.forEach(([f]) => { if (v[f] !== "" && v[f] != null) body[f] = Math.max(0, parseInt(v[f], 10) || 0); });
    setBusy(true);
    try { const r = await K.performa(k.id, body); toast.success(r.status_konten === "SELESAI" ? "Laporan tersimpan — konten Selesai" : "Tersimpan"); onSaved(r); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <section className="space-y-2 border-t border-emerald-50 pt-3" data-testid="kt-performa">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-emerald-900">{k.iklan ? "Laporan iklan" : "Performa 72 jam"}</p>
        {k.performa?.IKLAN?.cpl != null && <span className="text-[11px] text-emerald-800">CPL Rp {k.performa.IKLAN.cpl.toLocaleString("id-ID")}</span>}
        {plats.length > 1 && <div className="ml-auto flex gap-1">{plats.map((x) => (
          <button key={x} onClick={() => setP(x)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${p === x ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 text-emerald-900"}`}>{platformLabel(meta, x)}{k.performa?.[x] ? " ✓" : ""}</button>
        ))}</div>}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {metrik.map(([f, l]) => (
          <label key={f} className="text-[10px] text-emerald-800/70">{l}
            <Input inputMode="numeric" value={v[f] ?? ""} onChange={(e) => setV({ ...v, [f]: e.target.value.replace(/[^0-9]/g, "") })} className="h-8 bg-white text-xs" data-testid={`kt-perf-${f}`} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={simpan} className="h-8 text-xs" data-testid="kt-perf-simpan">Simpan{plats.length > 1 ? ` ${platformLabel(meta, p)}` : ""}</Button>
        {k.performa?.[p]?.diisi_at && <span className="text-[10px] text-emerald-800/50">diisi {k.performa[p].oleh} · {new Date(k.performa[p].diisi_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>}
      </div>
    </section>
  );
}

export default function DetailKonten({ k, meta, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [jadwal, setJadwal] = useState({});
  const [links, setLinks] = useState({});
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const def = k ? meta.jenis[k.jenis] : null;
  const fields = def ? [...def.field, ...(k.iklan ? def.field_iklan || [] : [])] : [];
  useEffect(() => {
    if (!k) return;
    setF({ judul: k.judul, isi: Object.fromEntries(fields.map(([x]) => [x, k[x] || ""])) });
    setJadwal(k.jadwal || {}); setLinks(k.links || {}); setManual("");
  }, [k, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!k || !f) return null;
  const aktif = k.status === "AKTIF";
  const bolehUbah = aktif && (meta.bisa_kelola || (meta.anggota_id && (k.pemegang_ids || []).includes(meta.anggota_id)));
  const jalan = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(ok); onSaved(r?.id ? r : null); return r; } catch (e) { toast.error(formatApiErr(e)); } finally { setBusy(false); }
    return null;
  };
  const jadwalBerubah = JSON.stringify(jadwal) !== JSON.stringify(k.jadwal || {});
  const tampilLink = !k.iklan && k.grup !== "TEKS" && SESUDAH_TAYANG.includes(k.status_konten);
  const naskah = fields.filter(([, , t]) => t === "url").filter(([x]) => k[x]);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="konten-detail">
        <SheetHeader className="text-left">
          <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-emerald-800/60"><JenisBadge j={k.jenis} iklan={k.iklan} /> {k.kode} <StatusBadge k={k} />{k.status !== "AKTIF" && <span className="font-sans text-red-600">({k.status.toLowerCase()})</span>}</p>
          <SheetTitle className="font-display text-lg leading-snug">{k.judul}</SheetTitle>
          <SheetDescription className="text-xs text-emerald-800/70">{k.jenis_label}{k.sumber_kode ? ` · dari ${k.sumber_kode}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-4 text-sm">
          <Alur k={k} />
          {naskah.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{naskah.map(([x, l]) => <LinkBuka key={x} href={k[x]} label={l} />)}{k.hasil_url && <LinkBuka href={k.hasil_url} label={k.jenis === "KOL" ? "Draft kreator" : "Hasil"} />}</div>
          )}
          {aktif && <PanelAksi k={k} meta={meta} jalan={jalan} busy={busy} />}
          {aktif && <DeadlineProduksi k={k} meta={meta} jalan={jalan} busy={busy} />}

          <section className="space-y-2">
            <JadwalEditor platforms={k.platforms || []} jadwal={jadwal} setJadwal={setJadwal} label={(p) => platformLabel(meta, p)}
              iklan={k.iklan} teks={k.grup === "TEKS"} disabled={!aktif || !meta.bisa_kelola} />
            {!meta.bisa_kelola && aktif && <p className="text-[10px] text-emerald-800/50">Jadwal hanya bisa diubah lead konten. Butuh waktu tambahan? Pakai “Minta perpanjangan”.</p>}
            {meta.bisa_kelola && jadwalBerubah && <Button size="sm" disabled={busy} onClick={() => jalan(() => K.ubah(k.id, { jadwal }), "Jadwal disimpan — target tugas ikut digeser")} className="h-8 bg-emerald-900 text-xs text-white" data-testid="kt-simpan-jadwal">Simpan jadwal</Button>}
          </section>

          {tampilLink && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-emerald-900">Link tayang per platform</p>
              {(k.platforms || []).map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-emerald-800/70">{platformLabel(meta, p)}</span>
                  <Input value={links[p] || ""} disabled={!bolehUbah} onChange={(e) => setLinks({ ...links, [p]: e.target.value })} placeholder="https://…" className="h-8 bg-white text-xs" />
                  <LinkBuka href={links[p]} />
                </div>
              ))}
              {bolehUbah && <Button size="sm" variant="outline" disabled={busy} onClick={() => jalan(() => K.ubah(k.id, { links }), "Link disimpan")} className="h-8 text-xs">Simpan link</Button>}
            </section>
          )}
          {k.status_konten === "POSTING" && Object.keys(k.links || {}).length > 0 && (
            <p className="text-[11px] text-emerald-800/70">Sudah tayang: {Object.keys(k.links).map((p) => platformLabel(meta, p)).join(", ")}</p>
          )}

          {(SESUDAH_TAYANG.includes(k.status_konten) || k.status_konten === "IKLAN_AKTIF") && <PerformaForm k={k} meta={meta} onSaved={onSaved} />}

          <section className="space-y-2 border-t border-emerald-50 pt-3">
            <p className="text-xs font-semibold text-emerald-900">Isi konten {!bolehUbah && <span className="font-normal text-emerald-800/50">(hanya baca — sedang dipegang {k.pemegang_nama.join(", ") || "orang lain"})</span>}</p>
            <div><label className="text-[11px] font-medium text-emerald-900" htmlFor="kd-judul">Judul</label><Input id="kd-judul" value={f.judul} disabled={!bolehUbah} onChange={(e) => setF({ ...f, judul: e.target.value })} className="h-9 bg-white text-sm" /></div>
            <IsiFields fields={fields} isi={f.isi} disabled={!bolehUbah} idp="kd" setIsi={(isi) => setF({ ...f, isi })} />
            {bolehUbah && <Button size="sm" disabled={busy} onClick={() => jalan(() => K.ubah(k.id, { judul: f.judul, isi: f.isi }), "Konten disimpan")} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="kt-simpan-detail">{busy && <Loader2 size={13} className="animate-spin" />} Simpan</Button>}
          </section>

          {meta.bisa_kelola && aktif && (
            <section className="space-y-2 rounded-lg border border-dashed border-emerald-200 p-3">
              <p className="flex items-center gap-1 text-xs font-semibold text-emerald-900"><AlertTriangle size={12} /> Lead / SPV</p>
              <div className="flex gap-2">
                <select value={manual} onChange={(e) => setManual(e.target.value)} className="h-8 flex-1 rounded-md border border-input bg-white px-2 text-xs" aria-label="Status manual">
                  <option value="">— koreksi status —</option>{k.alur.map((a) => <option key={a.k} value={a.k} disabled={a.k === k.status_konten}>{a.label}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={!manual || busy} onClick={() => jalan(() => K.setStatus(k.id, manual), "Status dikoreksi")} className="h-8 text-xs">Pindahkan</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {["REELS", "CAROUSEL", "SINGLE"].includes(k.jenis) && !k.iklan && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => jalan(() => K.salinIklan(k.id), "Kartu iklan dibuat")} className="h-7 text-xs" data-testid="kt-salin-iklan"><Copy size={12} /> Salin jadi konten iklan</Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Batalkan konten ini? Tugasnya diarsipkan.") && jalan(() => K.batal(k.id), "Konten dibatalkan").then(onClose)} className="h-7 text-xs text-red-600 hover:bg-red-50">Batalkan konten</Button>
              </div>
            </section>
          )}

          {(k.riwayat || []).length > 0 && (
            <section className="border-t border-emerald-50 pt-3">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-emerald-900"><History size={12} /> Riwayat</p>
              <ul className="space-y-1">
                {[...k.riwayat].reverse().map((r, i) => (
                  <li key={i} className="text-[11px] text-emerald-900/80">
                    <span className="text-emerald-800/50">{new Date(r.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{" "}
                    {r.dari ? <>{meta.status_label[r.dari]} → <b>{meta.status_label[r.ke]}</b></> : <>dibuat · <b>{meta.status_label[r.ke]}</b></>} · {r.oleh}{r.catatan && r.catatan !== "dibuat" ? ` — ${r.catatan}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
