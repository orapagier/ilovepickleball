"use client";

import { useState, useTransition } from "react";

export function ActionButton({
  action,
  confirmMessage,
  className,
  pendingLabel,
  children,
}: {
  action: () => Promise<{ error?: string; ok?: boolean }>;
  confirmMessage?: string;
  className?: string;
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirmMessage && !confirm(confirmMessage)) return;
          setError(null);
          startTransition(async () => {
            const res = await action();
            if (res?.error) setError(res.error);
          });
        }}
        className={className}
      >
        {pending ? (pendingLabel ?? "Working…") : children}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
