import { Shell } from "@/components/Shell";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [admin, settings] = await Promise.all([requireAdminPage(), getSettings()]);
  return <Shell adminName={admin.name} instituteName={settings.instituteName}>{children}</Shell>;
}
