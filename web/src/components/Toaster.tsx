import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, Radio, X } from 'lucide-react';
import { useUi, type Toast } from '../stores/ui';
import { useData } from '../stores/data';
import { Avatar, cx } from './ui';

// Marks are monochrome; only real state gets a tone.
const KIND_STYLE: Record<Toast['kind'], { icon: JSX.Element; accent: string }> = {
  info: { icon: <Info size={16} />, accent: 'text-ink-500' },
  success: { icon: <CheckCircle2 size={16} />, accent: 'text-success' },
  error: { icon: <AlertCircle size={16} />, accent: 'text-urgent' },
  live: { icon: <Radio size={16} />, accent: 'text-ink-500' },
};

/**
 * Stacked, auto-dismissing toasts. Bottom-right on desktop, top-centre on
 * phones. Hovering pauses the timer. Mounted once in the app Shell (never on
 * kiosk screens).
 */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const navigate = useNavigate();
  const users = useData((s) => s.users);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.ttl);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(600, remaining.current - (Date.now() - startedAt.current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const actor = toast.actorId ? users[toast.actorId] : undefined;
  const style = KIND_STYLE[toast.kind];

  function act() {
    if (toast.action?.to) navigate(toast.action.to);
    toast.action?.onClick?.();
    onDismiss();
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.96, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-panel p-3 pr-2 shadow-pop"
    >
      {actor ? (
        <Avatar name={actor.name} size={28} />
      ) : (
        <span className={cx('mt-0.5 shrink-0', style.accent)}>{style.icon}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-ink-900">{toast.title}</p>
        {toast.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{toast.body}</p>}
        {toast.action && (
          <button onClick={act} className="mt-1.5 text-xs font-semibold text-ink-900 underline underline-offset-2 hover:text-ink-700">
            {toast.action.label} →
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="rounded-md p-1 text-ink-400 hover:bg-paper hover:text-ink-700"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
