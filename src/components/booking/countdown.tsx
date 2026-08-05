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
    return <p className="text-sm font-medium text-destructive">This hold has expired.</p>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <p className="text-sm font-medium text-warning">
      Time remaining: {minutes}:{String(seconds).padStart(2, "0")}
    </p>
  );
}
