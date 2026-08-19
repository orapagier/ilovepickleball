import { requireAdmin } from "@/lib/auth-helpers";
import { AdminNav, AdminHeader } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();

  return (
    <div className="flex flex-1 flex-col">
      <AdminHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 lg:flex-row lg:items-start lg:gap-8">
        <AdminNav />

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
