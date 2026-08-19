"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function Countdown({ expiresAtMs }: { expiresAtMs: number }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(() => expiresAtMs - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const next = expiresAtMs - Date.now();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAtMs, router]);

  if (remaining <= 0) {
    return (
      <p className="inline-flex w-fit items-center gap-2 rounded-full bg-destructive/12 px-3.5 py-2 text-sm font-bold text-destructive">
        This hold has expired.
      </p>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  /* The one number on the page that is running out, so it is set as data and
     wears the warning tone rather than sitting in a sentence. */
  return (
    <p className="inline-flex w-fit items-center gap-2 rounded-full bg-warning/15 px-3.5 py-2 text-sm font-bold text-warning-strong">
      Time remaining
      <span className="data-value text-base tabular-nums">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
    </p>
  );
}
