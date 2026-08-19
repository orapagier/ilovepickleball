"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-dusk/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="surface-raised rise relative w-full max-w-sm p-5 shadow-lift sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              destructive ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary",
            )}
          >
            <TriangleAlert className="size-5" />
          </span>
          <div>
            <h2 id="confirm-dialog-title" className="text-base">
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-outline"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              "btn",
              destructive
                ? "bg-destructive text-destructive-foreground shadow-card hover:brightness-95"
                : "btn-primary",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
