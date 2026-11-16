import { Link, useSearchParams } from "react-router-dom";
import { Target, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { PageTabs } from "@/components/PageTabs";
import Profile from "@/pages/Profile";
import UsersManagement from "@/pages/UsersManagement";
import IntegrasiAI from "@/pages/IntegrasiAI";

export default function Pengaturan() {
  const { user } = useAuth();
  const isSpv = user?.role === "spv";
  const tabs = [
    { k: "profil", label: "Profil saya" },
    { k: "integrasi", label: "Integrasi AI" },
    ...(isSpv ? [{ k: "pengguna", label: "Pengguna" }, { k: "modul", label: "Modul lanjutan" }] : []),
  ];
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((t) => t.k === params.get("tab")) ? params.get("tab") : "profil";
  return (
    <div className="space-y-4">
      {tabs.length > 1 && <PageTabs tabs={tabs} value={tab} onChange={(k) => setParams(k === "profil" ? {} : { tab: k })} />}
      {tab === "profil" && <Profile />}
      {tab === "integrasi" && <IntegrasiAI />}
      {tab === "pengguna" && <UsersManagement />}
      {tab === "modul" && (
        <div className="space-y-3">
          <p className="text-sm text-emerald-800/70">Modul yang disembunyikan dari menu utama. Datanya tetap tersimpan dan bisa dibuka kapan saja.</p>
          <Link to="/strategy" data-testid="open-strategy"
            className="flex items-center gap-4 rounded-xl border border-emerald-100 bg-white p-4 transition hover:border-emerald-300">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-800"><Target size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-display font-semibold text-emerald-950">Strategi &amp; Eksekusi</span>
              <span className="block text-xs text-emerald-800/70">Visi-misi, BSC, OKR, KPI, Action Plan, Komitmen, Evaluasi</span>
            </span>
            <ArrowRight size={16} className="text-emerald-700" />
          </Link>
        </div>
      )}
    </div>
  );
}
