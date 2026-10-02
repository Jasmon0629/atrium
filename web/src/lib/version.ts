import { useUi } from '../stores/ui';

/**
 * Build awareness. The server stamps the HTML shell it serves with a build id
 * (a hash of the built index.html) and announces the same id on every socket
 * connection. A tab whose stamp differs from the server's is running an old
 * deploy: the display reloads itself, app users get a prompt and pick up the
 * new build on their next page change. Under the Vite dev server the stamp is
 * "dev" and none of this applies.
 */
export function currentBuild(): string {
  return document.querySelector('meta[name="atrium-build"]')?.getAttribute('content') || 'dev';
}

const RELOAD_KEY = 'atrium-reload-guard';
const TARGET_KEY = 'atrium-update-target';

/**
 * Reload at most once a minute whatever the reason (missing chunk, render
 * error, new build). A wallpaper display must self-heal for weeks without
 * anyone touching it, but must never spin in a reload loop.
 */
export function guardedReload(reason: string): boolean {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {}
  if (Date.now() - last < 60_000) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {}
  console.info(`Atrium: reloading — ${reason}`);
  window.location.reload();
  return true;
}

/** Remember which build a reload was meant to reach, to detect a cached shell. */
export function markUpdateTarget(build: string) {
  try {
    sessionStorage.setItem(TARGET_KEY, build);
  } catch {}
}

/**
 * True when a reload already happened for this very build and the tab still
 * runs the old one: the HTML is being served from a cache the app cannot
 * clear, so only a hard refresh (Ctrl+F5) helps and reloading again is futile.
 */
export function updateStuckOn(build: string): boolean {
  try {
    return sessionStorage.getItem(TARGET_KEY) === build;
  } catch {
    return false;
  }
}

/** On boot: the reload reached its target, forget it. */
export function settleUpdateTarget() {
  try {
    if (sessionStorage.getItem(TARGET_KEY) === currentBuild()) sessionStorage.removeItem(TARGET_KEY);
  } catch {}
}

/** Called with the server's build id on every socket (re)connect. */
export function noteServerBuild(serverBuild: string | undefined) {
  const mine = currentBuild();
  if (!serverBuild || mine === 'dev' || serverBuild === 'dev' || serverBuild === mine) return;
  useUi.getState().setUpdateAvailable(serverBuild);
}

/** Vite raises this when a lazy chunk's preload fails — typically an old tab after a deploy. */
export function installPreloadErrorHandler() {
  window.addEventListener('vite:preloadError' as keyof WindowEventMap, (e: Event) => {
    if (guardedReload('stale chunk')) e.preventDefault();
  });
}
