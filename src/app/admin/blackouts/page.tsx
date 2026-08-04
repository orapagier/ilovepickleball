import { prisma } from "@/lib/prisma";
import { deleteBlackout } from "@/lib/actions/admin-actions";
import { ActionButton } from "@/components/action-button";
import { AddBlackoutForm } from "@/components/admin/add-blackout-form";

export default async function AdminBlackoutsPage() {
  const blackouts = await prisma.blackoutDate.findMany({ orderBy: { date: "asc" } });

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Blackout dates</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Days the court is fully closed regardless of the weekly schedule (holidays, maintenance, etc.).
      </p>

      <ul className="flex flex-col gap-2">
        {blackouts.map((b) => {
          const iso = b.date.toISOString().slice(0, 10);
          return (
            <li
              key={iso}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{iso}</p>
                {b.reason && <p className="text-sm text-zinc-600 dark:text-zinc-300">{b.reason}</p>}
              </div>
              <ActionButton
                action={() => deleteBlackout(iso)}
                confirmMessage="Remove this blackout date?"
                className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                Remove
              </ActionButton>
            </li>
          );
        })}
        {blackouts.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No blackout dates set.</p>}
      </ul>

      <AddBlackoutForm />
    </div>
  );
}
