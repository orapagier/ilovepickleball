import { getSettings } from "@/lib/booking-data";
import { SettingsForm } from "@/components/admin/settings-form";

export default async function AdminSettingsPage() {
  const settings = await getSettings();

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  );
}
