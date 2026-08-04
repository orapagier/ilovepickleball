import { getBusinessHours } from "@/lib/booking-data";
import { HoursForm } from "@/components/admin/hours-form";

export default async function AdminHoursPage() {
  const hours = await getBusinessHours();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Weekly hours</h1>
      <HoursForm hours={hours} />
    </div>
  );
}
