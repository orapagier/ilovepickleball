import { getPriceTiers } from "@/lib/booking-data";
import { PricingForm } from "@/components/admin/pricing-form";

export default async function AdminPricingPage() {
  const tiers = await getPriceTiers();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-bold">Court rates</h1>
      <p className="text-sm text-muted-foreground">
        Time-of-day rate bands, e.g. 8 AM–4 PM at ₱200/hr, 4 PM–10 PM at ₱300/hr. Leave a band on “Every day”, or pin
        it to one weekday when that day prices differently. The flat price in Settings is used for any time not
        covered by a tier.
      </p>
      <PricingForm tiers={tiers} />
    </div>
  );
}
