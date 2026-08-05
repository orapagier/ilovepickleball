"use client";

import { useActionState } from "react";
import { updateSettings, type ActionState } from "@/lib/actions/admin-actions";

type Settings = {
  businessName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  priceCentsPerHour: number;
  currency: string;
  timezone: string;
  gcashName: string;
  gcashNumber: string;
  holdMinutes: number;
  leadMinutes: number;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

const inputClass = "rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal";

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateSettings, {});

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <section className="surface-card p-6">
        <h2 className="text-lg font-semibold">Court details</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Business name">
            <input name="businessName" defaultValue={settings.businessName} required className={inputClass} />
          </Field>
          <Field label="Address">
            <input name="address" defaultValue={settings.address} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Price per hour">
              <input
                name="price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={(settings.priceCentsPerHour / 100).toFixed(2)}
                required
                className={inputClass}
              />
            </Field>
            <Field label="Currency">
              <input name="currency" defaultValue={settings.currency} required className={inputClass} />
            </Field>
            <Field label="Timezone (IANA)">
              <input name="timezone" defaultValue={settings.timezone} required className={inputClass} />
            </Field>
          </div>
        </div>
      </section>

      <section className="surface-card p-6">
        <h2 className="text-lg font-semibold">Contact person</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Contact person">
            <input name="contactPerson" defaultValue={settings.contactPerson} className={inputClass} />
          </Field>
          <Field label="Contact phone">
            <input name="contactPhone" defaultValue={settings.contactPhone} className={inputClass} />
          </Field>
          <Field label="Contact email">
            <input name="contactEmail" type="email" defaultValue={settings.contactEmail} className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="surface-card p-6">
        <h2 className="text-lg font-semibold">Payment &amp; hold policy</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="GCash account name">
            <input name="gcashName" defaultValue={settings.gcashName} className={inputClass} />
          </Field>
          <Field label="GCash number">
            <input name="gcashNumber" defaultValue={settings.gcashNumber} className={inputClass} />
          </Field>
          <Field label="Hold time before auto-cancel (minutes)">
            <input
              name="holdMinutes"
              type="number"
              min="1"
              defaultValue={settings.holdMinutes}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Minimum advance notice (minutes)">
            <input
              name="leadMinutes"
              type="number"
              min="0"
              defaultValue={settings.leadMinutes}
              required
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-6 py-2 font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
