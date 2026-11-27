import { api } from "@/lib/api";

export const K = {
  meta: () => api.get("/konten/meta").then((r) => r.data),
  list: (p) => api.get("/konten", { params: p }).then((r) => r.data),
  detail: (id) => api.get(`/konten/${id}`).then((r) => r.data),
  buat: (p) => api.post("/konten", p).then((r) => r.data),
  banyak: (items) => api.post("/konten/banyak", { items }).then((r) => r.data),
  ubah: (id, p) => api.put(`/konten/${id}`, p).then((r) => r.data),
  aksi: (id, p) => api.post(`/konten/${id}/aksi`, p).then((r) => r.data),
  mintaDeadline: (id, tanggal, alasan) => api.post(`/konten/${id}/minta-deadline`, { tanggal, alasan }).then((r) => r.data),
  putusDeadline: (id, setuju, catatan = "") => api.post(`/konten/${id}/putus-deadline`, { setuju, catatan }).then((r) => r.data),
  salinIklan: (id) => api.post(`/konten/${id}/salin-iklan`).then((r) => r.data),
  setStatus: (id, status, catatan = "") => api.post(`/konten/${id}/status`, { status, catatan }).then((r) => r.data),
  performa: (id, p) => api.put(`/konten/${id}/performa`, p).then((r) => r.data),
  rekap: (p) => api.get("/konten/rekap/performa", { params: p }).then((r) => r.data),
  batal: (id) => api.post(`/konten/${id}/batal`).then((r) => r.data),
  peran: (p) => api.put("/konten/pengaturan/peran", p).then((r) => r.data),
};

export const JENIS_URUT = ["REELS", "CAROUSEL", "SINGLE", "THREADS", "STORY", "WA", "KOL"];
export const JENIS_WARNA = {
  REELS: "bg-emerald-700 text-white",
  CAROUSEL: "bg-amber-500 text-white",
  SINGLE: "bg-orange-400 text-white",
  THREADS: "bg-slate-900 text-white",
  STORY: "bg-fuchsia-600 text-white",
  WA: "bg-green-600 text-white",
  KOL: "bg-sky-600 text-white",
};
export const JENIS_PENDEK = { REELS: "Reels", CAROUSEL: "Carousel", SINGLE: "Single", THREADS: "Threads", STORY: "Story", WA: "WA", KOL: "KOL/UGC" };
export const PERAN_LABEL = { LEAD: "Lead konten", PRODUKSI: "Produksi (editor/desain)", PUBLISHER: "Publisher (SMM)", IKLAN: "Tim iklan (ads)", PENULIS: "Penulis copy" };

// Fase dipakai pipeline saat beberapa tipe ditampilkan bersama.
export const FASE = [
  { k: "NASKAH", label: "Ide, naskah & outreach" },
  { k: "PRODUKSI", label: "Produksi" },
  { k: "REVIEW", label: "Review & revisi" },
  { k: "SIAP", label: "Siap posting" },
  { k: "IKLAN", label: "Tim iklan" },
  { k: "POSTED", label: "Tayang (72 jam)" },
  { k: "LAPORAN", label: "Laporan" },
  { k: "SELESAI", label: "Selesai" },
];
export const faseOf = (k) => {
  const s = k.status_konten;
  if (["IDE", "SCRIPTING", "SHORTLIST", "OUTREACH", "DEAL", "BRIEF"].includes(s)) return "NASKAH";
  if (["EDITED", "DESIGNED", "IKLAN_AKTIF"].includes(s)) return "IKLAN";
  if (s === "DRAFT") return "PRODUKSI";
  if (s === "SCRIPTED") return k.grup === "TEKS" ? "SIAP" : "NASKAH";
  if (["SHOOTING", "SHOOTED", "EDITING", "DESIGN"].includes(s)) return "PRODUKSI";
  if (["REVIEW", "REVISI"].includes(s)) return "REVIEW";
  if (s === "POSTING") return "SIAP";
  return s; // POSTED | LAPORAN | SELESAI
};

// Review = kuning terang supaya lead langsung melihat konten yang perlu direview.
export const statusWarna = (s) => (s === "SELESAI" ? "bg-emerald-600 text-white" : s === "REVISI" ? "bg-red-600 text-white"
  : s === "REVIEW" ? "bg-yellow-300 text-yellow-950 ring-1 ring-yellow-500" : ["EDITED", "DESIGNED", "IKLAN_AKTIF"].includes(s) ? "bg-orange-100 text-orange-900"
    : ["POSTED", "LAPORAN"].includes(s) ? "bg-sky-100 text-sky-900" : ["IDE", "SHORTLIST"].includes(s) ? "bg-slate-100 text-slate-700" : "bg-violet-100 text-violet-900");
export const URUT_STATUS = ["SHORTLIST", "OUTREACH", "DEAL", "BRIEF", "IDE", "SCRIPTING", "SCRIPTED", "SHOOTING", "SHOOTED", "EDITING", "DESIGN", "DRAFT",
  "REVIEW", "REVISI", "EDITED", "DESIGNED", "IKLAN_AKTIF", "POSTING", "POSTED", "LAPORAN", "SELESAI"];
export const platformLabel = (meta, p) => meta.platform[p] || meta.platform_kol?.[p] || meta.jenis[p]?.label || p;

export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const tglPendek = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" }) : "—");
export const tambahHari = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
export const seninDari = (s) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
export const fmt = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}jt` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}rb` : String(n));

export function JenisBadge({ j, pendek = true, iklan = false }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold ${JENIS_WARNA[j] || "bg-slate-200"}`}>{pendek ? JENIS_PENDEK[j] : j}</span>
      {iklan && <span className="inline-block whitespace-nowrap rounded bg-orange-500 px-1.5 py-px text-[10px] font-semibold text-white">Iklan</span>}
    </span>
  );
}
export function StatusBadge({ k }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusWarna(k.status_konten)}`}>{k.status_label}</span>;
}
