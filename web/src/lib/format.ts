export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(task: { dueDate: string | null; completedAt: string | null }): boolean {
  return !!task.dueDate && !task.completedAt && task.dueDate < todayStr();
}

export function isDueToday(task: { dueDate: string | null; completedAt: string | null }): boolean {
  return !!task.dueDate && !task.completedAt && task.dueDate === todayStr();
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Tag chip colours. Tags used to get a hashed hue each; the quiet theme keeps
 * colour for meaning, so every tag is the same grey chip and the text does
 * the work. Kept as a function so call sites stay unchanged.
 */
export function tagColor(_tag: string): { bg: string; fg: string } {
  return { bg: 'var(--color-paper)', fg: 'var(--color-ink-700)' };
}

/** 250000 -> "250,000" (whole numbers), 1234.5 -> "1,234.50" */
export function formatValue(v: number): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Two-letter mark for a group: initials of the first two words ("Project
 * Alpha" → PA), or the first two letters of a single word ("Accounts" → AC,
 * "Administration" → AD) so similar names stay distinguishable.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || '?').slice(0, 2).toUpperCase();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}
