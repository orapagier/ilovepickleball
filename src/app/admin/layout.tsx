import Link from "next/link";
import { requireAdmin } from "@/lib/auth-helpers";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/queue", label: "Pending actions" },
  { href: "/admin/bookings", label: "All bookings" },
  { href: "/admin/users", label: "Registered users" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/courts", label: "Courts" },
  { href: "/admin/hours", label: "Hours" },
  { href: "/admin/blackouts", label: "Blackout dates" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 lg:flex-row">
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto lg:w-48 lg:flex-col">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
