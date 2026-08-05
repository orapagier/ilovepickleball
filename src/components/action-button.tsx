"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const [confirming, setConfirming] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirmMessage ? setConfirming(true) : run())}
        className={className}
      >
        {pending ? (pendingLabel ?? "Working…") : children}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {confirmMessage && (
        <ConfirmDialog
          open={confirming}
          message={confirmMessage}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            run();
          }}
        />
      )}
    </div>
  );
}
