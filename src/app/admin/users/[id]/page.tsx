import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSettings, getPriceTiers } from "@/lib/booking-data";
import { getSessionUser } from "@/lib/auth-helpers";
import { formatMoney } from "@/lib/format";
import { computeBookingPriceCents } from "@/lib/pricing";
import { PAY_METHOD_LABELS } from "@/lib/pay-method";
import { cn } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { adminDeleteBooking, adminDeleteUser } from "@/lib/actions/admin-actions";
import { SkillRatingControl } from "@/components/admin/skill-rating-control";
import { deleteUserMessage } from "@/lib/users";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  awaiting_confirmation: "Verifying payment",
  awaiting_call: "Awaiting call",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/** Statuses that represent a slot the customer actually holds or held, as
 *  opposed to one that fell through — what "spent" is counted from. */
const HONOURED_STATUSES = ["confirmed"];

export default async function AdminUserDetailPage(props: PageProps<"/admin/users/[id]">) {
  const { id } = await props.params;

  const [user, settings, tiers, admin] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: {
        bookings: {
          include: { court: true, payment: true },
          orderBy: { startUtc: "desc" },
        },
      },
    }),
    getSettings(),
    getPriceTiers(),
    getSessionUser(),
  ]);
  if (!user) notFound();

  const priced = user.bookings.map((b) => ({
    ...b,
    totalCents: computeBookingPriceCents({
      startMs: b.startUtc.getTime(),
      hours: b.hours,
      slotDurationMin: settings.slotDurationMin,
      tz: settings.timezone,
      tiers,
      fallbackCentsPerHour: settings.priceCentsPerHour,
    }),
  }));

  const confirmed = priced.filter((b) => HONOURED_STATUSES.includes(b.status));
  const cancelled = priced.filter((b) => b.status === "cancelled" || b.status === "expired");
  const totalSpentCents = confirmed.reduce((sum, b) => sum + b.totalCents, 0);
  const totalHours = confirmed.reduce((sum, b) => sum + b.hours, 0);

  const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
  });
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: settings.timezone,
  });

  const details: { label: string; value: string }[] = [
    { label: "Email", value: user.email },
    { label: "Mobile number", value: user.phone || "— not provided" },
    { label: "Role", value: user.role === "admin" ? "Admin" : "Customer" },
    { label: "Joined", value: dateFormat.format(user.createdAt) },
    { label: "User ID", value: user.id },
  ];

  const stats: { label: string; value: string }[] = [
    { label: "Total bookings", value: String(user.bookings.length) },
    { label: "Confirmed", value: String(confirmed.length) },
    { label: "Cancelled / expired", value: String(cancelled.length) },
    { label: "Court hours", value: `${totalHours}h` },
    { label: "Spent (confirmed)", value: formatMoney(totalSpentCents, settings.currency) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Registered users
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold">
            {user.name || "Unnamed"}
            {user.role === "admin" && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Admin</span>
            )}
          </h1>
          {/* No self-delete: the action refuses it, so don't offer it. */}
          {admin?.id !== user.id && (
            <ActionButton
              action={adminDeleteUser.bind(null, user.id)}
              confirmMessage={deleteUserMessage(
                user.name || user.email,
                user.role === "admin",
                user.bookings.length,
              )}
              pendingLabel="Deleting…"
              className="rounded-full bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20"
            >
              Delete user
            </ActionButton>
          )}
        </div>
      </div>

      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Details</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {details.map((d) => (
            <div key={d.label}>
              <dt className="text-xs text-muted-foreground">{d.label}</dt>
              <dd className="break-words text-sm font-medium">{d.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">Skill level</dt>
            <dd className="mt-1">
              <SkillRatingControl userId={user.id} rating={user.skillRating} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="surface-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-lg font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Booking records</h2>
        {priced.length === 0 ? (
          <p className="surface-card p-8 text-center text-sm text-muted-foreground">
            This user has not booked a court yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {priced.map((b) => (
              <li key={b.id} className="surface-card flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-48">
                  <p className="font-medium">
                    {b.court.name} — {dateTimeFormat.format(b.startUtc)} ({b.hours}h)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatMoney(b.totalCents, settings.currency)}
                    {b.payMethod ? ` · ${PAY_METHOD_LABELS[b.payMethod] ?? b.payMethod}` : ""}
                    {b.payment?.referenceNumber ? ` · ref ${b.payment.referenceNumber}` : ""}
                  </p>
                  {b.customerNote && <p className="mt-1 text-sm italic text-muted-foreground">“{b.customerNote}”</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      b.status === "cancelled" || b.status === "expired"
                        ? "bg-destructive/10 text-destructive"
                        : b.status === "confirmed"
                          ? "bg-success/10 text-success"
                          : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </span>
                  <ActionButton
                    action={adminDeleteBooking.bind(null, b.id)}
                    confirmMessage="Permanently delete this booking and its payment record? This cannot be undone."
                    className="rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
                  >
                    Delete
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
