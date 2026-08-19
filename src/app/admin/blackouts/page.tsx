import { prisma } from "@/lib/prisma";
import { deleteBlackout } from "@/lib/actions/admin-actions";
import { ActionButton } from "@/components/action-button";
import { AddBlackoutForm } from "@/components/admin/add-blackout-form";

export default async function AdminBlackoutsPage() {
  const blackouts = await prisma.blackoutDate.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Days the court is fully closed regardless of the weekly schedule (holidays, maintenance, etc.).
      </p>

      <ul className="flex flex-col gap-2">
        {blackouts.map((b) => {
          const iso = b.date.toISOString().slice(0, 10);
          return (
            <li key={iso} className="surface-card flex items-center justify-between gap-3 p-3">
              <div>
                <p className="font-medium">{iso}</p>
                {b.reason && <p className="text-sm text-muted-foreground">{b.reason}</p>}
              </div>
              <ActionButton
                action={deleteBlackout.bind(null, iso)}
                confirmMessage="Remove this blackout date?"
                className="btn btn-danger btn-sm"
              >
                Remove
              </ActionButton>
            </li>
          );
        })}
        {blackouts.length === 0 && <p className="text-sm text-muted-foreground">No blackout dates set.</p>}
      </ul>

      <AddBlackoutForm />
    </div>
  );
}
