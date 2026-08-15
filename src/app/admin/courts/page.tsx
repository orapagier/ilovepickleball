import { prisma } from "@/lib/prisma";
import { isCalendarSyncConfigured } from "@/lib/google-calendar";
import { CourtRow } from "@/components/admin/court-row";
import { AddCourtForm } from "@/components/admin/add-court-form";

export default async function AdminCourtsPage() {
  const courts = await prisma.court.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { bookings: true } } },
  });
  const calendarSyncConfigured = isCalendarSyncConfigured();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-bold">Courts</h1>
      {calendarSyncConfigured && (
        <p className="text-sm text-muted-foreground">
          Bookings are mirrored into Google Calendar. Share each calendar with the service account as{" "}
          <em>Make changes to events</em>, then paste its ID below.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {courts.map((c) => (
          <CourtRow
            key={c.id}
            court={{ ...c, bookingCount: c._count.bookings }}
            calendarSyncConfigured={calendarSyncConfigured}
          />
        ))}
      </ul>
      <AddCourtForm />
    </div>
  );
}
