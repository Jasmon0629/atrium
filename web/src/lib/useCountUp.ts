import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './theme';

/** Animate a number towards its new value (eased, rAF). Instant under reduced motion. */
export function useCountUp(target: number, duration = 450): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target) return;
    if (prefersReducedMotion() || !Number.isFinite(start) || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
