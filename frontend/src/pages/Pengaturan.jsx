import { useSearchParams } from "react-router-dom";
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
    ...(isSpv ? [{ k: "pengguna", label: "Pengguna" }] : []),
  ];
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((t) => t.k === params.get("tab")) ? params.get("tab") : "profil";
  return (
    <div className="space-y-4">
      {tabs.length > 1 && <PageTabs tabs={tabs} value={tab} onChange={(k) => setParams(k === "profil" ? {} : { tab: k })} />}
      {tab === "profil" && <Profile />}
      {tab === "integrasi" && <IntegrasiAI />}
      {tab === "pengguna" && <UsersManagement />}
    </div>
  );
}
