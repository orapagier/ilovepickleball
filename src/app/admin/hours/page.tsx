import { getBusinessHours, getRestWindows } from "@/lib/booking-data";
import { HoursForm } from "@/components/admin/hours-form";
import { RestWindowsForm } from "@/components/admin/rest-windows-form";

export default async function AdminHoursPage() {
  const [hours, restWindows] = await Promise.all([getBusinessHours(), getRestWindows()]);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <HoursForm hours={hours} />

      {/* Under the weekly grid because it is the same kind of fact — what the
          week looks like — and because a rest is read against the hours it
          closes rather than on its own. */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">Weekly rest</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Time the courts close every week for rest or worship, whatever your club keeps. Leave it empty if you
            don&rsquo;t close for one.
          </p>
        </div>
        <RestWindowsForm windows={restWindows} />
      </section>
    </div>
  );
}
