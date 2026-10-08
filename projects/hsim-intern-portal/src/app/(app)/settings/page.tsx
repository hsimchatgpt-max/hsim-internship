import type { Metadata } from "next";
import { SettingsForms } from "@/components/SettingsForms";
import { PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [admin, settings] = await Promise.all([requireAdminPage(), getSettings()]);
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsForms settings={settings} admin={{ name: admin.name, email: admin.email }} />
    </>
  );
}
