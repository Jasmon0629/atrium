import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'live';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** For 'live' toasts: the teammate who caused the event (renders their avatar). */
  actorId?: number | null;
  action?: { label: string; to?: string; onClick?: () => void };
  /** Toasts with the same key replace each other instead of stacking. */
  dedupeKey?: string;
  ttl: number;
}

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  toasts: Toast[];
  /** Socket connection state; false while reconnecting. */
  online: boolean;
  /** Timestamp of the last socket event (kiosk heartbeat). */
  lastEventAt: number;
  /** Increments on each new notification so the bell can re-run its animation. */
  bellPulse: number;
  confirm: ConfirmRequest | null;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  /** Build id the server is running when it differs from this tab's (see lib/version.ts). */
  updateAvailable: string | null;

  toast: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => number;
  dismiss: (id: number) => void;
  clearToasts: () => void;
  setOnline: (online: boolean) => void;
  touch: () => void;
  ringBell: () => void;
  /** Promise-based confirm; rendered by <ConfirmDialog/>. */
  ask: (opts: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  answer: (ok: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setUpdateAvailable: (build: string | null) => void;
}

let nextToastId = 1;
const MAX_TOASTS = 4;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  online: true,
  lastEventAt: Date.now(),
  bellPulse: 0,
  confirm: null,
  shortcutsOpen: false,
  paletteOpen: false,
  updateAvailable: null,

  toast: (t) => {
    const id = nextToastId++;
    const ttl = t.ttl ?? (t.kind === 'error' ? 7000 : 5000);
    set((s) => {
      const kept = t.dedupeKey ? s.toasts.filter((x) => x.dedupeKey !== t.dedupeKey) : s.toasts;
      const list = [...kept, { ...t, id, ttl }];
      return { toasts: list.slice(-MAX_TOASTS) };
    });
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),

  setOnline: (online) => {
    if (get().online === online) return;
    set({ online });
  },

  touch: () => set({ lastEventAt: Date.now() }),
  ringBell: () => set((s) => ({ bellPulse: s.bellPulse + 1 })),

  ask: (opts) =>
    new Promise<boolean>((resolve) => {
      // Only one confirm at a time; a second request cancels the first.
      get().confirm?.resolve(false);
      set({ confirm: { ...opts, resolve } });
    }),

  answer: (ok) => {
    const req = get().confirm;
    set({ confirm: null });
    req?.resolve(ok);
  },

  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setUpdateAvailable: (build) => {
    if (get().updateAvailable === build) return;
    set({ updateAvailable: build });
  },
}));

/** Convenience for non-React code (stores, socket handlers). */
export function toast(t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) {
  return useUi.getState().toast(t);
}
