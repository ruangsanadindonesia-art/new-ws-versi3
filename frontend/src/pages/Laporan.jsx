import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { PageTabs } from "@/components/PageTabs";
import Dashboard from "@/pages/Dashboard";
import Monitoring from "@/pages/Monitoring";
import Raport from "@/pages/Raport";

export default function Laporan() {
  const { user } = useAuth();
  const isSpv = user?.role === "spv";
  const tabs = [
    { k: "ringkasan", label: "Ringkasan" },
    ...(isSpv || user?.can_monitor ? [{ k: "monitoring", label: isSpv ? "Monitoring" : "Monitoring tim" }] : []),
    ...(isSpv ? [{ k: "raport", label: "Raport" }] : []),
  ];
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((t) => t.k === params.get("tab")) ? params.get("tab") : "ringkasan";
  return (
    <div className="space-y-4">
      {tabs.length > 1 && <PageTabs tabs={tabs} value={tab} onChange={(k) => setParams(k === "ringkasan" ? {} : { tab: k })} />}
      {tab === "ringkasan" && <Dashboard />}
      {tab === "monitoring" && <Monitoring />}
      {tab === "raport" && <Raport />}
    </div>
  );
}
