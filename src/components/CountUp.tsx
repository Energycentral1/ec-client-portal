"use client";

import { useEffect, useState } from "react";

const words = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")} million` : Math.round(n).toLocaleString("en-US"));

/** The headline reach number, counting up once on load so it reads as a running total.
 *  Renders the final figure on the server and for people who prefer reduced motion. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const from = value * 0.6;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1400);
      setShown(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular-nums" aria-label={words(value)}>{words(shown)}</span>;
}
