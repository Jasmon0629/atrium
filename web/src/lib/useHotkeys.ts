import { useEffect } from 'react';
import { useUi } from '../stores/ui';

export const HOTKEY_EVENT = 'atrium:hotkey';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * App-wide shortcuts:
 *   Ctrl/⌘+K or /  command palette      n  new task (board)      ?  shortcut sheet
 * Single keys are ignored while typing in a field. Shortcuts are broadcast as a
 * DOM event so any mounted page can react.
 */
export function useGlobalHotkeys() {
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(!useUi.getState().paletteOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(!useUi.getState().shortcutsOpen);
      } else if (e.key === 'n' || e.key === 'N') {
        window.dispatchEvent(new CustomEvent(HOTKEY_EVENT, { detail: 'new-task' }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setShortcutsOpen, setPaletteOpen]);
}

/** Subscribe to a broadcast hotkey ('new-task', …). */
export function useHotkey(name: string, handler: () => void) {
  useEffect(() => {
    const onEvt = (e: Event) => {
      if ((e as CustomEvent<string>).detail === name) handler();
    };
    window.addEventListener(HOTKEY_EVENT, onEvt);
    return () => window.removeEventListener(HOTKEY_EVENT, onEvt);
  }, [name, handler]);
}
