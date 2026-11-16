import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Plus, Timer, Play, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatApiErr } from "@/lib/AuthContext";
import {
  rapatList, rapatMulai, rapatDetail, rapatKomitmen, rapatSelesai, isuTambah, isuUbah, updateTask, ritmePengaturan, ritmeSimpanPengaturan,
} from "@/lib/api";
import { PersonSelect } from "@/pages/tasks/raci";
import { StatusPill, InfoTip, JenisTag, OtomatisTag, fmtAngka } from "@/pages/sasaran/parts";

// Agenda tetap. Menit = alokasi waktu; total 37 menit + cadangan.
const LANGKAH = [
  { k: 1, judul: "Papan skor", menit: 5, siapa: "Fasilitator membacakan; PIC tiap angka merah/kuning menjawab 1 kalimat: apa penyebabnya.", aturan: "Jangan membahas solusi di sini. Angka hijau cukup disebut." },
  { k: 2, judul: "Komitmen pekan lalu", menit: 5, siapa: "Setiap orang menjawab: selesai atau tidak. Tanpa cerita panjang.", aturan: "Yang tidak selesai: masuk daftar isu bila menghambat target." },
  { k: 3, judul: "Isu (IDS)", menit: 20, siapa: "Fasilitator memilih maksimal 3 isu terpenting. Identify → Discuss → Solve.", aturan: "Isu ditutup hanya bila ada keputusan + penanggung jawab." },
  { k: 4, judul: "Komitmen baru", menit: 5, siapa: "Setiap PIC menyebut 1–2 tindakan konkret pekan ini. Langsung menjadi tugas.", aturan: "Komitmen harus menggerakkan ukuran proses, bukan pekerjaan rutin." },
  { k: 5, judul: "Penutup", menit: 2, siapa: "Setiap peserta memberi nilai rapat 1–10. Fasilitator menulis catatan.", aturan: "Nilai < 8 = bahas di awal rapat berikutnya: apa yang perlu diperbaiki." },
];
const HARI = ["SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

function useCountdown() {
  const [end, setEnd] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { if (!end) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [end]);
  const sisa = end ? Math.round((end - Date.now()) / 1000) : null;
  return { sisa, start: (m) => setEnd(Date.now() + m * 60000), stop: () => setEnd(null) };
}

function Langkah({ l, aktif, onPilih, children, extra }) {
  return (
    <section className={`rounded-xl border bg-white ${aktif ? "border-emerald-400 shadow-sm" : "border-emerald-100"}`} data-testid={`langkah-${l.k}`}>
      <button type="button" onClick={onPilih} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${aktif ? "bg-emerald-800 text-white" : "bg-emerald-100 text-emerald-800"}`}>{l.k}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-emerald-950">{l.judul} <span className="text-xs font-normal text-emerald-800/60">· {l.menit} menit</span> {extra}</p>
          <p className="text-[11px] text-emerald-800/70"><b>Cara:</b> {l.siapa} <b>Aturan:</b> {l.aturan}</p>
        </div>
      </button>
      {aktif && <div className="border-t border-emerald-50 px-4 py-3">{children}</div>}
    </section>
  );
}

export default function RapatMingguan({ isSpv, anggotaAll, divisiList, sasaranList }) {
  const [list, setList] = useState(null);
  const [rid, setRid] = useState(null);
  const [det, setDet] = useState(null);
  const [aktif, setAktif] = useState(1);
  const [cfg, setCfg] = useState(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cd = useCountdown();

  const loadList = () => rapatList().then((r) => { setList(r); if (!rid && r.rapat[0]) setRid(r.rapat[0].id); }).catch((e) => toast.error(formatApiErr(e)));
  const loadDet = (id = rid) => id && rapatDetail(id).then(setDet).catch((e) => toast.error(formatApiErr(e)));
  // eslint-disable-next-line
  useEffect(() => { loadList(); ritmePengaturan().then(setCfg).catch(() => {}); }, []);
  // eslint-disable-next-line
  useEffect(() => { loadDet(); }, [rid]);

  const mulai = async () => {
    setBusy(true);
    try { const r = await rapatMulai(); toast.success(r.isu_otomatis_baru ? `Rapat dimulai · ${r.isu_otomatis_baru} isu otomatis dari angka merah/kuning` : "Rapat dimulai"); setRid(r.id); await loadList(); loadDet(r.id); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };

  if (!list) return <p className="p-6 text-center text-sm text-emerald-800/60">Memuat rapat…</p>;
  const r = det?.rapat;
  const selesai = r?.status === "SELESAI";
  const ro = !isSpv || selesai;

  return (
    <div className="space-y-3" data-testid="rapat-view">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-3">
        <div className="min-w-0 flex-1 text-sm text-emerald-950">
          <b>Rapat Target Mingguan</b> <InfoTip k="RAPAT" />
          <p className="text-[11px] text-emerald-800/70">
            {cfg ? `Setiap ${cfg.hari_rapat?.toLowerCase()} pukul ${cfg.jam_rapat}, ${cfg.durasi_menit} menit · fasilitator ${cfg.fasilitator_nama || "belum ditetapkan"} · batas check-in ${cfg.batas_checkin}` : ""}
          </p>
        </div>
        {list.rapat.length > 0 && (
          <select value={rid || ""} onChange={(e) => setRid(e.target.value)} className="h-8 rounded-md border border-emerald-200 bg-white px-2 text-xs" data-testid="rapat-select">
            {list.rapat.map((x) => <option key={x.id} value={x.id}>{x.tanggal} · {x.status === "SELESAI" ? `selesai${x.nilai ? `, nilai ${x.nilai}` : ""}` : "berlangsung"}</option>)}
          </select>
        )}
        {isSpv && <Button size="sm" onClick={mulai} disabled={busy} className="h-8 bg-emerald-900 text-xs text-white hover:bg-emerald-800" data-testid="rapat-mulai">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Mulai rapat pekan ini</Button>}
        {isSpv && <Button size="sm" variant="outline" onClick={() => setCfgOpen(!cfgOpen)} className="h-8 text-xs"><Settings2 size={13} /> Jadwal</Button>}
      </div>

      {cfgOpen && cfg && <Pengaturan cfg={cfg} anggotaAll={anggotaAll} divisiList={divisiList} onSaved={(c) => { setCfg(c); setCfgOpen(false); }} />}

      {!r ? (
        <div className="rounded-xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-emerald-800/70">
          Belum ada rapat. {isSpv ? "Klik “Mulai rapat pekan ini” saat rapat dibuka — sistem menyiapkan agenda dan isu dari angka merah/kuning." : "SPV memulai rapat setiap pekan."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800/80">
            <span>Rapat {r.tanggal} ({r.minggu}) · fasilitator <b>{r.fasilitator_nama || "-"}</b> · {selesai ? <b className="text-emerald-700">selesai</b> : <b className="text-amber-700">berlangsung</b>}</span>
            {!selesai && (
              <span className="ml-auto inline-flex items-center gap-1.5">
                <Timer size={13} />
                {cd.sisa !== null
                  ? <b className={`tabular-nums ${cd.sisa < 0 ? "text-red-600" : "text-emerald-900"}`} data-testid="timer">{cd.sisa < 0 ? "-" : ""}{Math.floor(Math.abs(cd.sisa) / 60)}:{String(Math.abs(cd.sisa) % 60).padStart(2, "0")}</b>
                  : <span>pengatur waktu</span>}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => cd.start(LANGKAH[aktif - 1].menit)}>Mulai {LANGKAH[aktif - 1].menit} menit</Button>
              </span>
            )}
          </div>

          <Langkah l={LANGKAH[0]} aktif={aktif === 1} onPilih={() => setAktif(1)} extra={<span className="text-xs font-normal text-red-700">{det.papan_perhatian.length} dari {det.jumlah_kr} ukuran merah/kuning</span>}>
            {det.belum_checkin.length > 0 && (
              <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900" data-testid="belum-checkin">
                <b>{det.belum_checkin.length} ukuran manual belum di-check-in pekan ini</b> (PIC: {[...new Set(det.belum_checkin.map((b) => b.pic || "belum ada PIC"))].join(", ")}). Minta PIC mengisi setelah rapat.
              </p>
            )}
            {det.papan_perhatian.length === 0 ? <p className="text-sm text-emerald-700">Tidak ada angka merah/kuning. Lanjut ke langkah 2.</p> : (
              <ul className="divide-y divide-emerald-50">
                {det.papan_perhatian.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1"><JenisTag jenis={u.jenis} />{u.sumber && <OtomatisTag />}{u.nama}
                      <span className="block text-[11px] text-emerald-800/60">PIC {u.pic?.nama || "belum ada"}{u.catatan_terakhir ? ` · “${u.catatan_terakhir.slice(0, 90)}”` : ""}</span></span>
                    <span className="tabular-nums">{fmtAngka(u.capaian, u.satuan)} / {fmtAngka(u.target, u.satuan)}</span>
                    <StatusPill status={u.status} small />
                  </li>
                ))}
              </ul>
            )}
          </Langkah>

          <Langkah l={LANGKAH[1]} aktif={aktif === 2} onPilih={() => setAktif(2)}
            extra={det.komitmen_lalu.length ? <span className="text-xs font-normal text-emerald-800/70">{det.komitmen_lalu.filter((k) => k.selesai).length}/{det.komitmen_lalu.length} selesai</span> : null}>
            {det.komitmen_lalu.length === 0 ? <p className="text-sm text-emerald-800/70">Tidak ada komitmen dari rapat sebelumnya.</p> : (
              <ul className="space-y-1">
                {det.komitmen_lalu.map((k) => (
                  <li key={k.id} className="flex items-center gap-2 text-sm">
                    {k.selesai ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-amber-500" />}
                    <span className="flex-1"><b>{k.R}</b> — {k.nama}</span>
                    {!k.selesai && isSpv && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => {
                      try { await updateTask(k.id, { status: "SELESAI" }); loadDet(); } catch (e) { toast.error(formatApiErr(e)); }
                    }}>Tandai selesai</Button>}
                  </li>
                ))}
              </ul>
            )}
            {det.disiplin_komitmen.length > 0 && (
              <p className="mt-2 text-[11px] text-emerald-800/70"><b>Disiplin komitmen 4 rapat terakhir:</b> {det.disiplin_komitmen.map((d) => `${d.nama} ${d.pct}%`).join(" · ")}. Sasaran sehat ≥ 80%.</p>
            )}
          </Langkah>

          <Langkah l={LANGKAH[2]} aktif={aktif === 3} onPilih={() => setAktif(3)}
            extra={<span className="text-xs font-normal text-emerald-800/70">{det.isu.filter((i) => i.status === "TERBUKA").length} terbuka <InfoTip k="ISU" /></span>}>
            <IsuList det={det} ro={ro} rid={r.id} anggotaAll={anggotaAll} divisiList={divisiList} reload={() => loadDet()} canAdd={!selesai} />
          </Langkah>

          <Langkah l={LANGKAH[3]} aktif={aktif === 4} onPilih={() => setAktif(4)}
            extra={<span className="text-xs font-normal text-emerald-800/70">{det.komitmen_ini.length} komitmen <InfoTip k="KOMITMEN" /></span>}>
            {det.komitmen_ini.length > 0 && (
              <ul className="mb-2 space-y-1">{det.komitmen_ini.map((k) => <li key={k.id} className="text-sm"><b>{k.R}</b> — {k.nama} <span className="text-[11px] text-emerald-800/60">· tenggat {k.deadline}</span></li>)}</ul>
            )}
            {!ro && <KomitmenForm rid={r.id} anggotaAll={anggotaAll} divisiList={divisiList} sasaranList={sasaranList} onSaved={() => loadDet()} />}
          </Langkah>

          <Langkah l={LANGKAH[4]} aktif={aktif === 5} onPilih={() => setAktif(5)}>
            {selesai ? (
              <p className="text-sm text-emerald-900">Nilai rapat: <b>{r.nilai ?? "-"}</b>{r.catatan ? <> · {r.catatan}</> : null}</p>
            ) : isSpv ? <Penutup rid={r.id} onSaved={() => { loadList(); loadDet(); }} /> : <p className="text-sm text-emerald-800/70">SPV menutup rapat.</p>}
          </Langkah>
        </>
      )}
    </div>
  );
}

function IsuList({ det, ro, rid, anggotaAll, divisiList, reload, canAdd }) {
  const [judul, setJudul] = useState("");
  const [edit, setEdit] = useState({});
  const tambah = async () => {
    if (judul.trim().length < 3) return;
    try { await isuTambah({ judul }); setJudul(""); reload(); } catch (e) { toast.error(formatApiErr(e)); }
  };
  const simpan = async (i, tutup) => {
    const e = { keputusan: i.keputusan, pj_id: i.pj_id, ...(edit[i.id] || {}) };
    if (tutup && !(e.keputusan || "").trim()) return toast.error("Isi keputusan dulu. Isu tidak boleh ditutup tanpa keputusan.");
    if (tutup && !e.pj_id) return toast.error("Pilih penanggung jawab keputusan.");
    try { await isuUbah(i.id, { keputusan: e.keputusan, pj_id: e.pj_id, ...(tutup ? { status: "SELESAI" } : {}) }, rid); toast.success(tutup ? "Isu selesai" : "Tersimpan"); reload(); }
    catch (er) { toast.error(formatApiErr(er)); }
  };
  return (
    <div className="space-y-2">
      {det.isu.length === 0 && <p className="text-sm text-emerald-800/70">Tidak ada isu terbuka.</p>}
      {det.isu.map((i) => {
        const e = { keputusan: i.keputusan, pj_id: i.pj_id, ...(edit[i.id] || {}) };
        const done = i.status === "SELESAI";
        return (
          <div key={i.id} className={`rounded-lg border p-2.5 ${done ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100"}`} data-testid={`isu-${i.id}`}>
            <p className="text-sm text-emerald-950">{done ? "✓ " : ""}{i.judul} <span className="text-[10px] text-emerald-800/50">{i.sumber === "otomatis" ? "· otomatis" : ""}</span></p>
            {ro || done ? (
              (i.keputusan || i.pj_nama) && <p className="mt-1 text-[11px] text-emerald-900"><b>Keputusan:</b> {i.keputusan || "-"} · <b>PJ:</b> {i.pj_nama || "-"}</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_200px_auto]">
                <Textarea rows={1} value={e.keputusan || ""} placeholder="Solve: keputusan / tindakan yang disepakati"
                  onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, keputusan: ev.target.value } })} />
                <PersonSelect value={e.pj_id} onChange={(v) => setEdit({ ...edit, [i.id]: { ...e, pj_id: v } })} anggotaAll={anggotaAll} divisiList={divisiList} placeholder="Penanggung jawab" />
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => simpan(i, false)}>Simpan</Button>
                  <Button size="sm" className="h-9 bg-emerald-900 text-xs text-white hover:bg-emerald-800" onClick={() => simpan(i, true)} data-testid={`isu-tutup-${i.id}`}>Selesai</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {canAdd && (
        <div className="flex gap-2">
          <Input value={judul} onChange={(e) => setJudul(e.target.value)} placeholder="Tambah isu: apa yang menghambat target?" onKeyDown={(e) => e.key === "Enter" && tambah()} data-testid="isu-input" />
          <Button variant="outline" onClick={tambah}><Plus size={14} /> Isu</Button>
        </div>
      )}
    </div>
  );
}

function KomitmenForm({ rid, anggotaAll, divisiList, sasaranList, onSaved }) {
  const [f, setF] = useState({ penerima_id: null, nama: "", sasaran_id: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.penerima_id) return toast.error("Pilih siapa yang berkomitmen");
    if (f.nama.trim().length < 3) return toast.error("Tulis tindakannya");
    setBusy(true);
    try { const r = await rapatKomitmen(rid, { ...f, sasaran_id: f.sasaran_id || null }); toast.success(`Komitmen menjadi tugas · tenggat ${r.deadline}`); setF({ ...f, nama: "" }); onSaved(); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr_200px_auto]" data-testid="komitmen-form">
      <PersonSelect value={f.penerima_id} onChange={(v) => setF({ ...f, penerima_id: v })} anggotaAll={anggotaAll} divisiList={divisiList} placeholder="Siapa" testId="komitmen-r" />
      <Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="Tindakan konkret, mis. Follow-up 40 lead discovery lama" data-testid="komitmen-nama" />
      <select value={f.sasaran_id} onChange={(e) => setF({ ...f, sasaran_id: e.target.value })} className="h-9 rounded-md border border-input bg-white px-2 text-xs">
        <option value="">Mendukung objective…</option>
        {sasaranList.map((s) => <option key={s.id} value={s.id}>{s.judul}</option>)}
      </select>
      <Button onClick={save} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="komitmen-save"><Plus size={14} /> Komitmen</Button>
    </div>
  );
}

function Penutup({ rid, onSaved }) {
  const [nilai, setNilai] = useState(null);
  const [catatan, setCatatan] = useState("");
  const save = async () => {
    try { await rapatSelesai(rid, { nilai, catatan }); toast.success("Rapat ditutup"); onSaved(); } catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-emerald-900">Nilai rapat (rata-rata nilai peserta):</p>
      <div className="flex flex-wrap gap-1">
        {[...Array(10)].map((_, i) => (
          <button key={i} onClick={() => setNilai(i + 1)} className={`h-8 w-8 rounded-md border text-sm ${nilai === i + 1 ? "border-emerald-800 bg-emerald-800 text-white" : "border-emerald-200 hover:bg-emerald-50"}`}>{i + 1}</button>
        ))}
      </div>
      <Textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan rapat: keputusan penting, hal yang perlu diperbaiki" />
      <Button onClick={save} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="rapat-tutup">Tutup rapat</Button>
    </div>
  );
}

function Pengaturan({ cfg, anggotaAll, divisiList, onSaved }) {
  const [f, setF] = useState(cfg);
  const save = async () => {
    try { onSaved(await ritmeSimpanPengaturan({ fasilitator_id: f.fasilitator_id, hari_rapat: f.hari_rapat, jam_rapat: f.jam_rapat, durasi_menit: Number(f.durasi_menit) || 45, batas_checkin: f.batas_checkin })); toast.success("Jadwal disimpan"); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  return (
    <div className="grid gap-2 rounded-xl border border-emerald-100 bg-white p-4 sm:grid-cols-5" data-testid="ritme-setting">
      <div className="sm:col-span-2"><p className="mb-1 text-xs font-medium">Fasilitator</p>
        <PersonSelect value={f.fasilitator_id} onChange={(v) => setF({ ...f, fasilitator_id: v })} anggotaAll={anggotaAll} divisiList={divisiList} placeholder="Pilih fasilitator" /></div>
      <div><p className="mb-1 text-xs font-medium">Hari</p>
        <select value={f.hari_rapat} onChange={(e) => setF({ ...f, hari_rapat: e.target.value })} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm">{HARI.map((h) => <option key={h}>{h}</option>)}</select></div>
      <div><p className="mb-1 text-xs font-medium">Jam</p><Input value={f.jam_rapat} onChange={(e) => setF({ ...f, jam_rapat: e.target.value })} /></div>
      <div><p className="mb-1 text-xs font-medium">Batas check-in</p><Input value={f.batas_checkin} onChange={(e) => setF({ ...f, batas_checkin: e.target.value })} /></div>
      <div className="sm:col-span-5"><Button size="sm" onClick={save} className="bg-emerald-900 text-white hover:bg-emerald-800">Simpan jadwal</Button></div>
    </div>
  );
}
