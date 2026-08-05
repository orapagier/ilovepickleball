import { getPriceTiers } from "@/lib/booking-data";
import { PricingForm } from "@/components/admin/pricing-form";

export default async function AdminPricingPage() {
  const tiers = await getPriceTiers();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-bold">Court rates</h1>
      <p className="text-sm text-muted-foreground">
        Time-of-day rate bands, e.g. 8 AM–1 PM at ₱200/hr, 1 PM–5 PM at ₱250/hr. The flat price in Settings is used
        for any time not covered by a tier.
      </p>
      <PricingForm tiers={tiers} />
    </div>
  );
}
