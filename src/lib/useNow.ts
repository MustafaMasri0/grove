import { useEffect, useState } from "react";

/** The current time in unix seconds, updated every `ms` milliseconds (for "3 minutes ago"). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
