import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { adminDeleteUser } from "@/lib/actions/admin-actions";
import { deleteUserMessage } from "@/lib/users";

export default async function AdminUsersPage(props: PageProps<"/admin/users">) {
  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";

  const [users, settings, admin] = await Promise.all([
    prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {},
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    getSettings(),
    getSessionUser(),
  ]);

  const joinedFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: settings.timezone,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "user" : "users"}
          {q ? " matching" : ""}
        </p>
      </div>

      {/* A plain GET form, so a search is a normal navigation the admin can
          bookmark, share, and step back out of. */}
      <form action="/admin/users" method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, email, or mobile number"
            aria-label="Search users"
            className="field pl-9 w-full"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          Search
        </button>
        {q && (
          <Link
            href="/admin/users"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Clear
          </Link>
        )}
      </form>

      {users.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-muted-foreground">
          {q ? `No users match "${q}".` : "No registered users yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            /* The row is a plain container rather than one big Link, so the
               delete button isn't nested inside an anchor. */
            <li
              key={u.id}
              className="surface-card flex flex-wrap items-center justify-between gap-3 p-3 transition-colors hover:bg-accent"
            >
              {/* `min-w-48` keeps the row from collapsing on a desktop, but a
                  phone is narrower than that — hence the `max-w-full`. */}
              <Link href={`/admin/users/${u.id}`} className="min-w-48 max-w-full grow">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {u.name || "Unnamed"}
                  {u.role === "admin" && (
                    <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-primary">
                      Admin
                    </span>
                  )}
                  {/* Google sign-in never supplies a mobile number, so an
                      account with no phone has not completed /register and
                      cannot book yet. */}
                  {!u.phone && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                      Profile incomplete
                    </span>
                  )}
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ""} · joined {joinedFormat.format(u.createdAt)}
                </p>
              </Link>
              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium",
                  u._count.bookings > 0 ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {u._count.bookings} {u._count.bookings === 1 ? "booking" : "bookings"}
              </span>
              {/* No self-delete: the action refuses it, so don't offer it. */}
              {admin?.id !== u.id && (
                <ActionButton
                  action={adminDeleteUser.bind(null, u.id)}
                  confirmMessage={deleteUserMessage(u.name || u.email, u.role === "admin", u._count.bookings)}
                  className="btn btn-danger btn-sm shrink-0"
                >
                  Delete
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
