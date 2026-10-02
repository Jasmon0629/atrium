import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { useAuth } from './stores/auth';
import { useData } from './stores/data';
import { toast, useUi } from './stores/ui';
import { connectSocket, disconnectSocket } from './lib/socket';
import { setUnauthorizedHandler } from './lib/api';
import { useGlobalHotkeys } from './lib/useHotkeys';
import { guardedReload, installPreloadErrorHandler, markUpdateTarget, settleUpdateTarget, updateStuckOn } from './lib/version';

// On a 401 (expired/revoked token) the whole session must be torn down —
// otherwise the old socket keeps its rooms and a later login reuses them.
setUnauthorizedHandler(() => {
  disconnectSocket();
  useData.getState().reset();
  useAuth.getState().logout();
});
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { TaskModal } from './components/board/TaskModal';
import { Toaster } from './components/Toaster';
import { ConfirmDialog } from './components/ConfirmDialog';
import { CommandPalette } from './components/CommandPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Kbd, Modal, Skeleton } from './components/ui';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { DashboardPage } from './pages/Dashboard';
import { MyTasksPage } from './pages/MyTasks';
import { GroupPage } from './pages/Group';
import { AnnouncementsPage } from './pages/Announcements';
import { NotificationsPage } from './pages/Notifications';
import { ActivityPage } from './pages/Activity';

// Heavier, less-visited screens load on demand so the first paint stays quick.
// After a deploy the fingerprinted chunk a stale tab asks for no longer exists;
// reload once to pick up the new build instead of showing a broken screen.
function lazyRetry<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      // Rate-limited (once a minute) so a display can self-heal for weeks yet never loop
      if (guardedReload('missing chunk')) {
        return new Promise<{ default: T }>(() => {}); // never resolves; the reload takes over
      }
      throw err;
    })
  );
}

/**
 * Keeps an open tab current across deploys. The server announces its build on
 * each socket connection; when it differs from this tab's stamp, the display
 * reloads itself (unattended screens must never wait for a human) and app
 * users get a toast, then pick the new build up on their next page change —
 * the moment they are leaving a screen anyway, so nothing in progress is lost.
 */
function UpdateWatcher() {
  const updateAvailable = useUi((s) => s.updateAvailable);
  const { pathname } = useLocation();
  const kiosk = pathname.startsWith('/kiosk');
  const noticedOn = useRef<string | null>(null);
  // Read through a ref so the effect below runs once per new build, not on
  // every navigation (the display's own tour changes the path every 30 s).
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    settleUpdateTarget();
    installPreloadErrorHandler();
  }, []);

  useEffect(() => {
    if (!updateAvailable) return;
    // A reload already targeted this build and the tab still runs the old one:
    // the shell is cached beyond the app's control — only a hard refresh helps.
    const stuck = updateStuckOn(updateAvailable);
    if (kiosk) {
      if (stuck) return;
      const t = setTimeout(() => {
        markUpdateTarget(updateAvailable);
        guardedReload('new build on the display');
      }, 3000 + Math.random() * 12000); // spread out so several screens don't reload at once
      return () => clearTimeout(t);
    }
    if (noticedOn.current === null) noticedOn.current = pathRef.current;
    toast({
      kind: 'info',
      title: 'Atrium was updated',
      body: stuck
        ? 'Your browser kept an old copy. Press Ctrl+F5 (hard refresh) to load the new version.'
        : 'It loads on your next page change — or refresh now.',
      dedupeKey: 'update',
      ttl: 60 * 60 * 1000,
      action: stuck
        ? undefined
        : {
            label: 'Refresh now',
            onClick: () => {
              markUpdateTarget(updateAvailable);
              window.location.reload();
            },
          },
    });
  }, [updateAvailable, kiosk]);

  useEffect(() => {
    if (!updateAvailable || kiosk || updateStuckOn(updateAvailable)) return;
    if (noticedOn.current !== null && noticedOn.current !== pathname) {
      markUpdateTarget(updateAvailable);
      guardedReload('new build, picked up on navigation');
    }
  }, [pathname, updateAvailable, kiosk]);

  return null;
}
const ChatPage = lazyRetry(() => import('./pages/Chat').then((m) => ({ default: m.ChatPage })));
const SearchPage = lazyRetry(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const AdminPage = lazyRetry(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const KioskPage = lazyRetry(() => import('./pages/Kiosk').then((m) => ({ default: m.KioskPage })));

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 lg:p-8" aria-busy>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Command palette (search, jump, actions)' },
  { keys: ['/'], label: 'Command palette' },
  { keys: ['n'], label: 'New task (on a board)' },
  { keys: ['Esc'], label: 'Close dialog / cancel' },
  { keys: ['Ctrl', 'Enter'], label: 'Save task / send' },
  { keys: ['?'], label: 'Show this sheet' },
];

function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  return (
    <AnimatePresence>
      {open && (
        <Modal key="shortcuts" size="sm" onClose={() => setOpen(false)} labelledBy="shortcuts-title">
          <div className="p-6">
            <h2 id="shortcuts-title" className="text-sm font-semibold">
              Keyboard shortcuts
            </h2>
            <ul className="mt-4 space-y-2.5">
              {SHORTCUTS.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-ink-700">{s.label}</span>
                  <span className="flex items-center gap-1">
                    {s.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  );
}

function Shell() {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const location = useLocation();
  const fetchAll = useData((s) => s.fetchAll);
  const openTask = useData((s) => s.openTask);
  const [menuOpen, setMenuOpen] = useState(false);
  useGlobalHotkeys();

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    const load = () =>
      fetchAll().catch(() =>
        // Never fail silently: an empty dashboard must not masquerade as "no data"
        toast({
          kind: 'error',
          title: "Couldn't load your workspace",
          body: 'Check your connection, then retry.',
          dedupeKey: 'fetch-all',
          ttl: 15000,
          action: { label: 'Retry', onClick: load },
        })
      );
    load();
  }, [token, fetchAll]);

  if (!token) return <Navigate to="/login" replace />;
  // A reset or first sign-in after seeding requires a private password before anything else
  if (user?.mustChangePassword && location.pathname !== '/password') {
    return <Navigate to="/password" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <ErrorBoundary>
            {/*
              Page transition = enter-only CSS keyed by path (see .page-in).
              This used to be AnimatePresence mode="wait" with an exit fade, but
              <Outlet/> inside the *exiting* wrapper re-renders to the NEW route,
              so the new page mounted inside the old wrapper while it faded to 0
              and the wrapper was then never replaced: the first click on a page
              showed nothing until a second click re-rendered it. It also mounted
              every page twice per navigation. A plain keyed div cannot get stuck.
            */}
            <div key={location.pathname} className="page-in h-full">
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            </div>
          </ErrorBoundary>
        </main>
      </div>
      <AnimatePresence>{openTask && <TaskModal key="task-modal" />}</AnimatePresence>
      <Toaster />
      <ConfirmDialog />
      <CommandPalette />
      <ShortcutsSheet />
    </div>
  );
}

function KioskGate() {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const fetchAll = useData((s) => s.fetchAll);
  useEffect(() => {
    if (token) {
      connectSocket(token);
      fetchAll().catch(() => {});
    }
  }, [token, fetchAll]);
  if (!token) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/password" replace />;
  return (
    // A display has nobody to click "Reload": a broken render or a missing
    // chunk after a deploy must recover on its own.
    <ErrorBoundary dark autoReloadMs={15000}>
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-night-900 text-night-muted">Loading live display…</div>}>
        <KioskPage />
      </Suspense>
    </ErrorBoundary>
  );
}

const BASENAME =
  import.meta.env.BASE_URL === '/' ? '/' : import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter basename={BASENAME}>
        <UpdateWatcher />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/kiosk" element={<KioskGate />} />
          <Route path="/kiosk/:groupId" element={<KioskGate />} />
          <Route element={<Shell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tasks" element={<MyTasksPage />} />
            <Route path="/groups/:groupId" element={<GroupPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:roomId" element={<ChatPage />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/password" element={<ChangePasswordPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
