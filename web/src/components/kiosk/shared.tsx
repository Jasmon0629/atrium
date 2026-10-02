import { useEffect, useRef, type ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import { formatDate, todayStr } from '../../lib/format';
import { cx } from '../ui';
import type { Task } from '../../lib/types';

/**
 * The display is always dark and viewed from across a room, so it keeps its
 * own (larger) type scale. Colour follows the same discipline as the app:
 * greys for everything, one accent for the active line, and semantic tones
 * only where they carry state — due, priority, done, live.
 */
export const TONE = {
  red: '#f87171',
  amber: '#fbbf24',
  green: '#34d399',
  text: '#e5e7eb',
  muted: '#8b94a0',
} as const;

/** Priority marks: only urgent and high carry a tone; the rest stay grey. */
export const PRIORITY_DOT: Record<string, string> = {
  urgent: TONE.red,
  high: TONE.amber,
  normal: TONE.muted,
  low: '#5b6470',
};

export function sameLocalDay(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function dueLabel(task: Task): { text: string; color: string } {
  const today = todayStr();
  if (task.dueDate! < today) return { text: 'OVERDUE', color: TONE.red };
  if (task.dueDate === today) return { text: 'TODAY', color: TONE.amber };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (task.dueDate === tomorrowStr) return { text: 'TOMORROW', color: TONE.text };
  return { text: formatDate(task.dueDate).toUpperCase(), color: TONE.muted };
}

/** Small due-state tag; tone only when it means something. */
export function DueTag({ task }: { task: Task }) {
  if (!task.dueDate || task.completedAt) return null;
  const d = dueLabel(task);
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide"
      style={{ color: d.color, backgroundColor: d.color + '1f' }}
    >
      {d.text}
    </span>
  );
}

/** Thin progress bar on the dark surface. */
export function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span className={cx('block h-1 overflow-hidden rounded-full bg-white/10', className)}>
      <span className="block h-full rounded-full bg-night-text" style={{ width: `${v}%`, transition: 'width 0.6s var(--ease-soft)' }} />
    </span>
  );
}

export function PageDots({ index, pages }: { index: number; pages: number }) {
  if (pages < 2) return null;
  return (
    <span className="flex items-center gap-1" aria-label={`Page ${index + 1} of ${pages}`}>
      {Array.from({ length: pages }).map((_, i) => (
        <span key={i} className={cx('h-1 rounded-full transition-all duration-500', i === index ? 'w-4 bg-night-text' : 'w-1 bg-white/20')} />
      ))}
    </span>
  );
}

/** Panel title row: label on the left, meta + expand control on the right. */
export function PanelHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-night-muted">
      {children}
      <span className="ml-auto flex items-center gap-2">{right}</span>
    </p>
  );
}

/**
 * The small "expand" control every panel carries. Panels show a digest; this
 * opens the full list in a popup without leaving the display.
 */
export function ExpandButton({ label, onClick, className = '' }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-night-muted/70 transition hover:border-night-line hover:bg-white/5 hover:text-night-text',
        className
      )}
      aria-label={`Expand ${label}`}
      title={`Expand ${label}`}
    >
      <Maximize2 size={12} />
    </button>
  );
}

const IDLE_CLOSE_MS = 90_000;

/**
 * Popup over the display: dark panel, hairline border, scrollable body.
 * Esc, the Close control or the backdrop dismiss it, and it closes itself
 * after 90 s without interaction so an unattended screen always returns to
 * the wallpaper. The auto-tour pauses while one is open (see useKioskTour).
 */
export function KioskPopup({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    let idle = setTimeout(() => onCloseRef.current(), IDLE_CLOSE_MS);
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => onCloseRef.current(), IDLE_CLOSE_MS);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      touch();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', touch);
    window.addEventListener('wheel', touch, { passive: true });
    window.addEventListener('touchstart', touch, { passive: true });
    return () => {
      clearTimeout(idle);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousemove', touch);
      window.removeEventListener('wheel', touch);
      window.removeEventListener('touchstart', touch);
    };
  }, []);

  return (
    <div
      className="fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6 lg:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          'flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-night-line bg-night-800 text-night-text outline-none shadow-2xl',
          wide ? 'max-w-6xl' : 'max-w-4xl'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-night-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-night-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center gap-1 rounded-md border border-night-line px-2.5 py-1 text-xs font-medium text-night-muted hover:bg-white/5 hover:text-night-text"
            aria-label="Close"
          >
            Close <X size={13} aria-hidden />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
