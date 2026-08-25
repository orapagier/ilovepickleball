import { getPriceTiers } from "@/lib/booking-data";
import { PricingForm } from "@/components/admin/pricing-form";

export default async function AdminPricingPage() {
  const tiers = await getPriceTiers();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Leave a band on “Every day”, or pin it to one weekday when that day prices differently. The flat price in
        Settings is used for any time not covered by a tier.
      </p>
      <PricingForm tiers={tiers} />
    </div>
  );
}
