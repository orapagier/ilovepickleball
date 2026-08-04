import { prisma } from "@/lib/prisma";
import { CourtRow } from "@/components/admin/court-row";
import { AddCourtForm } from "@/components/admin/add-court-form";

export default async function AdminCourtsPage() {
  const courts = await prisma.court.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Courts</h1>
      <ul className="flex flex-col gap-3">
        {courts.map((c) => (
          <CourtRow key={c.id} court={c} />
        ))}
      </ul>
      <AddCourtForm />
    </div>
  );
}
