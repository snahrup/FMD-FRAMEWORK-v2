import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

export function AnimatedCounter({
  value,
  duration = 1200,
  format = (n) => n.toLocaleString(),
  className = "",
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  const raf = useRef<number>(0);

  useEffect(() => {
    const start = prev.current;
    const delta = value - start;
    if (delta === 0) return;
    const t0 = performance.now();

    const tick = (now: number) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + delta * eased);
      setDisplay(current);
      if (progress < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        prev.current = value;
      }
    };

    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
