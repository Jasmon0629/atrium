import { useEffect, useMemo, useState } from 'react';

/**
 * Rotate through pages of a list on a timer, so a display never permanently
 * hides items beyond the first screenful. Resets to page 0 when the list
 * length changes.
 */
export function usePager<T>(items: T[], pageSize: number, intervalMs = 8000) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (pages < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % pages), intervalMs);
    return () => clearInterval(t);
  }, [pages, intervalMs]);

  const page = useMemo(() => {
    const safe = Math.min(index, pages - 1);
    return items.slice(safe * pageSize, safe * pageSize + pageSize);
  }, [items, index, pages, pageSize]);

  return { page, index: Math.min(index, pages - 1), pages };
}
