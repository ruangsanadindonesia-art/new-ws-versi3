import { useEffect, useState } from "react";
import { Bot, Copy, KeyRound, Link2, Loader2, Plus, ShieldAlert, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, formatApiErr } from "@/lib/AuthContext";
import { listApiKeys, createApiKey, revokeApiKey, ubahScopeApiKey, izinHapusApiKey, createLinkCode, listChatLinks, deleteChatLink, agentAudit } from "@/lib/api";

const MCP_URL = "https://workspace.ruangsanad.com/api/mcp";
const fmt = (d) => (d ? new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

async function copy(text, label = "Disalin") {
  try { await navigator.clipboard.writeText(text); toast.success(label); }
  catch { toast.error("Tidak bisa menyalin otomatis — salin manual."); }
}

function Section({ icon: Icon, title, desc, children, testId }) {
  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-5" data-testid={testId}>
      <div className="mb-1 flex items-center gap-2">
        <Icon size={16} className="text-emerald-800" />
        <h3 className="font-display text-base font-semibold text-emerald-950">{title}</h3>
      </div>
      {desc && <p className="mb-4 text-xs leading-relaxed text-emerald-800/70">{desc}</p>}
      {children}
    </section>
  );
}

function hermesSnippet(key, name = "workspace") {
  return `mcp_servers:\n  ${name}:\n    url: "${MCP_URL}"\n    headers:\n      Authorization: "Bearer ${key}"`;
}

function CreatedKey({ created, onClose }) {
  const snippet = hermesSnippet(created.key, created.kind === "gateway" ? "workspace_bersama" : "workspace");
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="api-key-created">
      <p className="text-xs font-semibold text-amber-950">Simpan kunci ini sekarang. Nilainya tidak bisa dilihat lagi setelah ditutup.</p>
      <div className="flex gap-2">
        <Input readOnly value={created.key} className="bg-white font-mono text-xs" data-testid="api-key-value" />
        <Button type="button" size="icon" variant="outline" onClick={() => copy(created.key, "Kunci disalin")} aria-label="Salin kunci"><Copy size={15} /></Button>
      </div>
      <p className="pt-1 text-[11px] font-medium text-amber-950">Tempel di <code>~/.hermes/config.yaml</code> (atau config MCP agent lain), lalu restart Hermes:</p>
      <pre className="overflow-x-auto rounded-md bg-white p-2 text-[11px] text-emerald-950">{snippet}</pre>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => copy(snippet, "Konfigurasi disalin")}><Copy size={13} /> Salin konfigurasi</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Sudah saya simpan</Button>
      </div>
    </div>
  );
}

function KeyRow({ k, onRevoke, showOwner, onScope, onHapus }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 px-3 py-2" data-testid={`api-key-${k.id}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-emerald-950">
          {k.name}
          <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${k.kind === "gateway" ? "bg-sky-100 text-sky-800" : k.scope === "write" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
            {k.kind === "gateway" ? `Gateway · ${k.scope === "write" ? "baca + edit" : "baca"}` : k.scope === "write" ? "Baca + tulis/edit" : "Baca saja"}
          </span>
          {k.boleh_hapus && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">+ hapus/arsip</span>}
        </p>
        <p className="font-mono text-[11px] text-emerald-800/60">
          {k.prefix}… · {showOwner && k.owner_name ? `${k.owner_name} · ` : ""}dipakai {fmt(k.last_used_at)}{k.revoked_at ? " · dicabut" : ""}
        </p>
      </div>
      {!k.revoked_at && onHapus && k.kind === "personal" && k.scope === "write" && (
        <Button type="button" size="sm" variant="outline" onClick={() => onHapus(k)} className="shrink-0 text-xs" data-testid={`hapus-izin-${k.id}`}>
          {k.boleh_hapus ? "Cabut izin hapus" : "Izinkan hapus/arsip"}
        </Button>
      )}
      {!k.revoked_at && onScope && (
        <Button type="button" size="sm" variant="outline" onClick={() => onScope(k)} className="shrink-0 text-xs" data-testid={`scope-${k.id}`}>
          {k.scope === "write" ? "Jadikan baca saja" : "Izinkan edit"}
        </Button>
      )}
      {!k.revoked_at && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onRevoke(k)} className="text-red-700 hover:bg-red-50 hover:text-red-800" data-testid={`revoke-${k.id}`}>
          <Trash2 size={14} /> Cabut
        </Button>
      )}
    </div>
  );
}

export default function IntegrasiAI() {
  const { user } = useAuth();
  const isSpv = user?.role === "spv";
  const [keys, setKeys] = useState([]);
  const [allKeys, setAllKeys] = useState([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [code, setCode] = useState(null);
  const [links, setLinks] = useState([]);
  const [audit, setAudit] = useState([]);
  const [gwName, setGwName] = useState("Hermes bersama");
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const gantiScope = async (k) => {
    const ke = k.scope === "write" ? "read" : "write";
    if (ke === "write" && k.kind === "gateway" && !window.confirm("Izinkan Hermes bersama mengubah data?\n\nAksi akan berjalan atas nama akun yang ditautkan ke chat. Identitas chat ditentukan oleh agent, jadi pastikan Hermes hanya dipakai di grup/chat tepercaya. Semua aksi tercatat di log.")) return;
    try { await ubahScopeApiKey(k.id, ke); toast.success(ke === "write" ? `"${k.name}" sekarang bisa membaca + mengedit` : `"${k.name}" sekarang baca saja`); await load(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  const gantiHapus = async (k) => {
    const boleh = !k.boleh_hapus;
    if (boleh && !window.confirm(`Izinkan kunci "${k.name}" (${k.owner_name || "pemilik"}) mengarsipkan, memulihkan, dan MENGHAPUS PERMANEN tugas lewat AI?\n\nBerlaku untuk tugas di mana pemilik kunci R/A atau tim yang dipimpinnya. Penghapusan tercatat di log beserta salinan datanya.`)) return;
    try { await izinHapusApiKey(k.id, boleh); toast.success(boleh ? "Izin hapus/arsip diberikan" : "Izin hapus/arsip dicabut"); await load(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  const load = async () => {
    try {
      const [k, l, a] = await Promise.all([listApiKeys(), listChatLinks(), agentAudit()]);
      setKeys(k.filter((x) => !x.revoked_at)); setLinks(l); setAudit(a);
      if (isSpv) setAllKeys((await listApiKeys(true)).filter((x) => !x.revoked_at));
    } catch (e) { toast.error(formatApiErr(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isSpv]);

  const create = async (kind = "personal") => {
    const n = kind === "gateway" ? gwName.trim() : name.trim();
    if (!n) return toast.error("Isi nama kunci dulu, mis. \"Hermes di laptop\"");
    setBusy(true);
    try { setCreated(await createApiKey(n, kind === "gateway" ? "read" : scope, kind)); setName(""); await load(); }
    catch (e) { toast.error(formatApiErr(e)); }
    setBusy(false);
  };
  const revoke = async (k) => {
    try { await revokeApiKey(k.id); toast.success(`Kunci "${k.name}" dicabut`); setConfirmRevoke(null); await load(); }
    catch (e) { toast.error(formatApiErr(e)); }
  };
  const makeCode = async () => {
    try { setCode(await createLinkCode()); } catch (e) { toast.error(formatApiErr(e)); }
  };
  const unlink = async (chat_id) => {
    try { await deleteChatLink(chat_id); toast.success("Tautan chat dilepas"); await load(); } catch (e) { toast.error(formatApiErr(e)); }
  };

  return (
    <div className="space-y-4" data-testid="integrasi-ai">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-xs leading-relaxed text-emerald-900">
        <p className="mb-1 flex items-center gap-1.5 font-semibold"><Bot size={14} /> Agent AI (Hermes, Claude, dll.) bisa memakai Workspace lewat MCP</p>
        <p>Agent bertindak <b>sebagai Anda</b>: hanya melihat tugas yang boleh Anda lihat dan mengikuti peran RACI Anda. Agent <b>tidak bisa</b> menghapus, mengarsipkan, menyetujui hasil, atau mengelola pengguna. Setiap aksi tercatat dengan tanda "(via AI)".</p>
        <p className="mt-1">Alamat MCP: <code className="rounded bg-white px-1">{MCP_URL}</code></p>
      </div>

      {confirmRevoke && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" data-testid="confirm-revoke">
          Cabut kunci <b>{confirmRevoke.name}</b>? Agent yang memakainya langsung kehilangan akses.
          <Button size="sm" className="ml-auto bg-red-600 text-white hover:bg-red-700" onClick={() => revoke(confirmRevoke)}>Cabut</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Batal</Button>
        </div>
      )}

      <Section icon={KeyRound} title="Kunci pribadi untuk agent Anda" testId="personal-keys"
        desc="Untuk agent milik Anda sendiri (Hermes di laptop/profil Anda, Claude Desktop, dll.). Pilih “Baca saja” jika agent cukup merangkum; pilih “Baca + tulis” jika agent boleh membuat tugas, mengubah status, mengisi hasil, berkomentar, dan mencentang amaliyah atas nama Anda.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama kunci, mis. Hermes di laptop" maxLength={80} data-testid="key-name" />
          <select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="key-scope"
            className="h-9 rounded-md border border-input bg-white px-2 text-sm text-emerald-950">
            <option value="read">Baca saja</option>
            <option value="write">Baca + tulis</option>
          </select>
          <Button type="button" onClick={() => create("personal")} disabled={busy} className="bg-emerald-900 text-white hover:bg-emerald-800" data-testid="key-create">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Buat kunci
          </Button>
        </div>
        {created && <CreatedKey created={created} onClose={() => setCreated(null)} />}
        <div className="mt-4 space-y-2">
          {keys.filter((k) => k.kind !== "gateway").length === 0 && <p className="text-xs text-emerald-800/60">Belum ada kunci aktif.</p>}
          {keys.filter((k) => k.kind !== "gateway").map((k) => <KeyRow key={k.id} k={k} onRevoke={setConfirmRevoke} onScope={gantiScope} />)}
        </div>
      </Section>

      <Section icon={Link2} title="Hermes bersama (lewat chat)" testId="chat-link"
        desc="Jika tim memakai satu Hermes bersama di WhatsApp/Telegram, tautkan akun chat Anda agar Hermes menjawab sesuai akses Anda. Mode ini HANYA BACA: untuk membuat atau mengubah tugas lewat agent, pakai kunci pribadi.">
        <Button type="button" variant="outline" onClick={makeCode} data-testid="link-code-create"><Link2 size={14} /> Buat kode tautan</Button>
        {code && (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950" data-testid="link-code">
            <p>Kirim pesan ini ke Hermes dari akun chat Anda (berlaku 10 menit, sekali pakai):</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded bg-white px-2 py-1.5 text-sm font-semibold">Tautkan akun Workspace saya dengan kode {code.kode}</code>
              <Button type="button" size="icon" variant="outline" onClick={() => copy(`Tautkan akun Workspace saya dengan kode ${code.kode}`, "Pesan disalin")} aria-label="Salin pesan"><Copy size={14} /></Button>
            </div>
          </div>
        )}
        <div className="mt-4 space-y-2">
          {links.length === 0 && <p className="text-xs text-emerald-800/60">Belum ada akun chat yang tertaut.</p>}
          {links.map((l) => (
            <div key={l.chat_id} className="flex items-center justify-between rounded-lg border border-emerald-100 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-emerald-950">{l.chat_id}</span>
              <Button size="sm" variant="ghost" onClick={() => unlink(l.chat_id)} className="text-red-700 hover:bg-red-50">Lepas</Button>
            </div>
          ))}
        </div>
      </Section>

      {isSpv && (
        <Section icon={ShieldAlert} title="Admin: kunci gateway & semua kunci" testId="spv-keys"
          desc="Kunci gateway dipasang di Hermes bersama dan hanya berlaku untuk chat yang sudah ditautkan pemiliknya; tiap aksi berjalan atas nama akun tertaut (izin RACI tetap berlaku). Default baca saja; SPV bisa mengizinkan edit. Identitas pengirim chat ditentukan oleh agent, jadi pakai hanya di chat tepercaya.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={gwName} onChange={(e) => setGwName(e.target.value)} maxLength={80} data-testid="gw-name" />
            <Button type="button" onClick={() => create("gateway")} disabled={busy} variant="outline" data-testid="gw-create"><Plus size={15} /> Buat kunci gateway</Button>
          </div>
          <div className="mt-4 space-y-2">
            {allKeys.length === 0 && <p className="text-xs text-emerald-800/60">Belum ada kunci aktif di organisasi.</p>}
            {allKeys.map((k) => <KeyRow key={k.id} k={k} onRevoke={setConfirmRevoke} showOwner onScope={gantiScope} onHapus={gantiHapus} />)}
          </div>
        </Section>
      )}

      <Section icon={History} title={isSpv ? "Log aktivitas agent (semua)" : "Log aktivitas agent saya"} testId="agent-audit"
        desc="100 pemanggilan terakhir. Disimpan 180 hari.">
        {audit.length === 0 ? <p className="text-xs text-emerald-800/60">Belum ada aktivitas.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-emerald-800/70"><tr><th className="py-1 pr-2">Waktu</th>{isSpv && <th className="pr-2">Pengguna</th>}<th className="pr-2">Tool</th><th className="pr-2">Lewat</th><th>Hasil</th></tr></thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i} className="border-t border-emerald-50">
                    <td className="py-1 pr-2 tabular-nums">{fmt(a.at)}</td>
                    {isSpv && <td className="pr-2">{a.user_name || "—"}</td>}
                    <td className="pr-2 font-mono">{a.tool}</td>
                    <td className="pr-2">{a.kind === "gateway" ? `Hermes bersama${a.chat_id ? ` · ${a.chat_id}` : ""}` : "kunci pribadi"}</td>
                    <td className={a.ok ? "text-emerald-700" : "text-red-700"}>{a.ok ? "OK" : a.error || "gagal"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
