import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
} from 'react';
import { motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { initials, monogram } from '../lib/format';
import type { Priority, AnnPriority } from '../lib/types';

/** Tiny class joiner so components can compose conditional classes readably. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Initials on a quiet grey disc. `color` (the per-user colour from the API) is
 * accepted for compatibility but no longer painted: the theme keeps colour for
 * meaning, and a person's identity is carried by the letters.
 */
export function Avatar({
  name,
  size = 32,
  online,
  className = '',
}: {
  name: string;
  color?: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cx('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className="flex items-center justify-center rounded-full border border-line bg-paper font-semibold text-ink-700 select-none"
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36) }}
        title={name}
        aria-label={name}
        role="img"
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          className={cx(
            'absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-panel',
            online ? 'bg-emerald-500' : 'bg-ink-200'
          )}
          style={{ width: size * 0.32, height: size * 0.32 }}
          title={online ? 'Online' : 'Offline'}
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  );
}

/**
 * A group's mark: its monogram on a small bordered square. Groups used to carry
 * an emoji each; a letter mark keeps the sidebar and cards scannable without
 * colour or pictures. `dark` is for the always-dark display.
 */
export function GroupMark({ name, size = 28, dark, className = '' }: { name: string; size?: number; dark?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-md border font-semibold uppercase select-none',
        dark ? 'border-night-line bg-night-700 text-night-text' : 'border-line bg-paper text-ink-700',
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.34)), letterSpacing: '0.02em' }}
      aria-hidden
    >
      {monogram(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<Priority, string> = {
  urgent: 'bg-urgent-soft text-urgent',
  high: 'bg-high-soft text-high',
  normal: 'bg-normal-soft text-normal',
  low: 'bg-low-soft text-low',
};

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/** Status pill. Tones are semantic, never decorative: red bad, amber caution, grey neutral. */
export const badgeCls = 'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold';

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={cx(badgeCls, PRIORITY_STYLES[priority])} aria-label={`Priority: ${PRIORITY_LABEL[priority]}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

const ANN_STYLES: Record<AnnPriority, { cls: string; label: string }> = {
  urgent: { cls: 'bg-urgent-soft text-urgent', label: 'Urgent' },
  important: { cls: 'bg-high-soft text-high', label: 'Important' },
  general: { cls: 'bg-normal-soft text-normal', label: 'General' },
};

export function AnnBadge({ priority }: { priority: AnnPriority }) {
  const s = ANN_STYLES[priority];
  return (
    <span className={cx(badgeCls, s.cls)} aria-label={`${s.label} announcement`}>
      {s.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    admin: 'border border-line bg-panel text-ink-900',
    member: 'bg-paper text-ink-700',
    viewer: 'bg-paper text-ink-500',
  };
  return <span className={cx(badgeCls, 'capitalize', styles[role] || 'bg-paper text-ink-500')}>{role}</span>;
}

// ---------------------------------------------------------------------------
// Buttons & fields
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

// Four kinds. `primary` is the only place the accent fills a surface.
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-brand text-white',
  secondary: 'border border-line bg-panel text-ink-900 hover:bg-paper',
  ghost: 'text-ink-500 hover:bg-paper hover:text-ink-900',
  danger: 'border border-urgent/30 bg-panel text-urgent hover:bg-urgent-soft',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** The one input style: white, hairline, and a soft accent halo on focus. */
export const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-300 transition focus:outline-none focus:ring-2 focus:ring-brand/40 focus-visible:outline-none disabled:opacity-60';
export const inputSmCls =
  'w-full rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink-900 placeholder:text-ink-300 transition focus:outline-none focus:ring-2 focus:ring-brand/40 focus-visible:outline-none disabled:opacity-60';
/** Inline small select: sized to its content, never stretching the row. */
export const selectSmCls =
  'rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-ink-900 transition focus:outline-none focus:ring-2 focus:ring-brand/40 focus-visible:outline-none disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(
  function Input({ className = '', small, ...rest }, ref) {
    return <input ref={ref} className={cx(small ? inputSmCls : inputCls, className)} {...rest} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={cx(inputCls, 'resize-y', className)} {...rest} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }>(
  function Select({ className = '', small, ...rest }, ref) {
    return <select ref={ref} className={cx(small ? inputSmCls : inputCls, className)} {...rest} />;
  }
);

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-ink-500">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-urgent">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-paper px-1.5 font-mono text-[10px] font-medium text-ink-500">
      {children}
    </kbd>
  );
}

/** Wrap any element: <Tooltip label="Sign out"><button…/></Tooltip> (CSS-only, delayed). */
export function Tooltip({
  label,
  side,
  children,
  className = '',
}: {
  label: string;
  side?: 'top' | 'bottom' | 'right';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx('tip inline-flex', className)} data-tip={label} data-tip-side={side}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading & empty states
// ---------------------------------------------------------------------------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <div className="text-ink-300">{icon}</div>
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-panel', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabs (animated indicator)
// ---------------------------------------------------------------------------

export interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = 'underline',
  className = '',
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  variant?: 'underline' | 'pills';
  className?: string;
}) {
  // Underline: the active tab carries the accent line (one of the accent's
  // four allowed uses). Pills: the active one is a quiet inset card.
  return (
    <div role="tablist" className={cx('flex gap-1', variant === 'pills' && 'flex-wrap gap-1.5', className)}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cx(
              'relative flex items-center gap-1.5 whitespace-nowrap text-sm transition',
              variant === 'underline'
                ? cx('px-3 py-2', active ? 'font-semibold text-ink-900' : 'font-medium text-ink-500 hover:text-ink-900')
                : cx(
                    'rounded-md border px-3 py-1.5',
                    active ? 'border-line bg-paper font-semibold text-ink-900' : 'border-transparent font-medium text-ink-500 hover:bg-paper hover:text-ink-900'
                  )
            )}
          >
            <span className="flex items-center gap-1.5">
              {t.icon}
              {t.label}
              {t.count !== undefined && <span className="tabular-nums text-ink-400">{t.count}</span>}
            </span>
            {variant === 'underline' && active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small data visuals (hand-rolled, no chart library)
// ---------------------------------------------------------------------------

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  color = 'var(--color-ink-700)',
  track = 'var(--color-line)',
  children,
  className = '',
}: {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.7s var(--ease-soft)' }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

export function Sparkline({
  values,
  width = 160,
  height = 44,
  color = 'var(--color-ink-700)',
  className = '',
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const uid = useId();
  const n = values.length;
  const max = Math.max(1, ...values);
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1);
    const y = height - pad - (v / max) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(pts[pts.length - 1]?.[0] ?? width).toFixed(1)},${height} L${(pts[0]?.[0] ?? 0).toFixed(1)},${height} Z`;
  const gradId = `spark-${uid.replace(/:/g, '')}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cx('block w-full', className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.12} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {n > 1 && <path d={area} fill={`url(#${gradId})`} />}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Modal (accessible: dialog role, focus trap + restore, scroll lock, animated)
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  onClose,
  children,
  wide,
  size,
  labelledBy,
  variant = 'dialog',
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg';
  labelledBy?: string;
  /** `drawer`: a right-hand detail panel, so the page behind keeps its place. */
  variant?: 'dialog' | 'drawer';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (els.length === 0) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          els[els.length - 1].focus();
        } else if (!e.shiftKey && i === els.length - 1) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  const width = wide ? 'max-w-3xl' : size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  const drawer = variant === 'drawer';

  return (
    <motion.div
      className={cx(
        'fixed inset-0 z-50 flex bg-ink-900/30 dark:bg-black/60',
        drawer ? 'justify-end' : 'items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-8'
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          'relative bg-panel outline-none',
          drawer
            ? 'thin-scroll h-full w-[min(760px,94vw)] overflow-y-auto border-l border-line shadow-2xl'
            : cx('w-full rounded-t-lg border border-line shadow-pop sm:rounded-lg', width)
        )}
        initial={drawer ? { opacity: 0, x: 24 } : { opacity: 0, y: 16 }}
        animate={drawer ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
        exit={drawer ? { opacity: 0, x: 16 } : { opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-500 hover:bg-paper hover:text-ink-900"
          aria-label="Close"
        >
          Close <X size={13} aria-hidden />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar with value readout
// ---------------------------------------------------------------------------

/**
 * Music-player-style progress bar: gradient fill with a seek knob, the percent
 * on the left and the (customizable) project value on the right.
 */
export function ValueProgressBar({
  progress,
  value,
  valueUnit,
  dark,
  compact,
  onEditValue,
}: {
  progress: number; // 0..100
  value: number;
  valueUnit: string;
  dark?: boolean;
  compact?: boolean;
  onEditValue?: () => void;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const track = dark ? 'bg-white/10' : 'bg-line';
  const fill = dark ? 'bg-night-text' : 'bg-ink-700';
  const text = dark ? 'text-night-muted' : 'text-ink-400';
  const strong = dark ? 'text-night-text' : 'text-ink-900';
  return (
    <div className="w-full">
      <div className={cx('relative overflow-hidden rounded-full', compact ? 'h-1' : 'h-1.5', track)}>
        <div
          className={cx('absolute inset-y-0 left-0 rounded-full', fill)}
          style={{ width: `${pct}%`, transition: 'width 0.6s var(--ease-soft)' }}
        />
      </div>
      <div className={cx('mt-1.5 flex items-baseline justify-between text-[11px] font-medium', text)}>
        <span>
          <span className={cx('font-mono text-xs font-semibold', strong)}>{pct}%</span> complete
        </span>
        {value > 0 &&
          (onEditValue ? (
            <button
              onClick={onEditValue}
              className={cx('rounded-md px-1 font-semibold tabular-nums underline-offset-2 hover:underline', strong)}
              title="Edit project value"
            >
              {valueUnit} {value.toLocaleString()}
            </button>
          ) : (
            <span className={cx('font-semibold tabular-nums', strong)}>
              {valueUnit} {value.toLocaleString()}
            </span>
          ))}
        {value <= 0 && onEditValue && (
          <button onClick={onEditValue} className="rounded-md px-1 hover:underline" title="Set project value">
            + set value
          </button>
        )}
      </div>
    </div>
  );
}
