# Atrium — Live Workplace Command Center

A real-time workplace collaboration platform: shared Kanban boards, announcements,
group chat, notifications, activity audit trail and a kiosk-grade live display —
built around one rule: **when one member of a group changes something, every
authorized member sees it instantly.**

## Live deployment

**https://asm-atrium.duckdns.org** (later also https://aidev.asmtech.international) — AWS Lightsail instance **Atrium**
(Ubuntu 24.04, 512 MB / 2 vCPU, region ap-southeast-5 Malaysia), public IP
**56.69.175.201**. Until a hostname resolves the app is reachable at
**http://56.69.175.201** over plain HTTP.

> **Hostnames:** Caddy serves every name in `ATRIUM_HOST` (space-separated, in
> `~/aidev/.env`) and fetches a Let's Encrypt certificate for each as soon as it
> resolves to this instance. Currently: **asm-atrium.duckdns.org** (live; kept
> pointed at the box by the updater below) and **aidev.asmtech.international**
> (needs an `A` record → 56.69.175.201 at GoDaddy, the domain's DNS host).
> **Firewall:** HTTP (80), HTTPS (443) and SSH (22) are open in the Lightsail firewall — keep 80 open, Caddy needs it.
> **Static IP:** 56.69.175.201 is a Lightsail static IP (attached 2026-09-08), so it
> survives stop/start. If it ever changes, update `ATRIUM_IP` in `~/aidev/.env`,
> `deploy/deploy.sh`, and the GoDaddy record; DuckDNS follows automatically.
> **DuckDNS updater:** `~/aidev/duckdns-update.sh` runs from cron every 5 min and
> re-points `DUCKDNS_DOMAINS` at the instance's current IPv4 using `DUCKDNS_TOKEN`
> (both in `~/aidev/.env`; log in `~/aidev/duckdns.log`). If you regenerate the
> token in the DuckDNS dashboard, update it in `.env`.

Atrium is a fully standalone stack in `~/aidev` on the instance (`docker-compose.yml`):

- `aidev-caddy` — HTTPS front door (Caddy, ports 80/443); config is `Caddyfile`
- `aidev-atrium` — Node app (API + Socket.IO + built frontend) on internal **port 4600**
- `aidev-atrium-db` — its **own PostgreSQL 16** (`pgdata` volume, survives rebuilds)
- secrets and host settings in `~/aidev/.env` — generated once by
  `deploy/bootstrap.sh`, never committed

The 512 MB plan only works with the 2 GB swap file `deploy/bootstrap.sh` creates.

The SSH key for the instance is `atrium-lightsail.key` in this folder (gitignored);
its public half is in `~/.ssh/authorized_keys` on the box.

### Deploy an update

```bash
# builds web/dist, uploads, runs the idempotent bootstrap, rebuilds the
# containers and waits for /api/health. KEY=… HOST=… override the defaults.
bash deploy/deploy.sh
```

Useful on the box: `cd ~/aidev && sudo docker compose ps|logs -f|restart`.

Nobody needs to refresh after a deploy. The server stamps the HTML shell with a
build id (a hash of the built `index.html`, shown by `/api/health` and printed by
`deploy.sh` as `build old -> new`) and announces it on every socket connection.
An open tab that sees a different id is stale: displays reload themselves within
about 15 seconds, app users get an "Atrium was updated" toast and switch to the
new build on their next page change (or with the Refresh button). A lazy chunk
that vanished with the old build triggers the same rate-limited reload. The
shell is served `Cache-Control: no-cache`, API responses `no-store`, and only
the fingerprinted `/assets` are cached long-term.

To reset the live data:
`ssh -i atrium-lightsail.key ubuntu@56.69.175.201 "cd ~/aidev && sudo docker compose down -v && sudo docker compose up -d --build"`
(`-v` drops the PostgreSQL volume and Caddy's certificates; the app reseeds on first run).

The previous deployment (2026-09-01, instance 56.69.221.184 sharing PolicyCRM's
Caddy) no longer exists; its data was not migrated. Deployed to the new instance
on 2026-09-08.

## Quick start (local)

Requirements: Node.js 22+, Docker (for PostgreSQL).

```bash
# 0. PostgreSQL (once) — role/db matching the dev default DATABASE_URL
docker run -d --name atrium-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5410:5432 postgres:16-alpine
docker exec atrium-pg psql -U postgres -c "CREATE ROLE atrium LOGIN PASSWORD 'atrium'" -c "CREATE DATABASE atrium OWNER atrium"

# 1. API + realtime server (seeds demo data on first run)
cd server
npm install
npm start          # http://localhost:4600

# 2. Web app (separate terminal)
cd web
npm install
npm run dev        # http://localhost:5100
```

Open http://localhost:5100 and sign in.

### Accounts

Local dev password for all four: `atrium123`. On a **production** deployment the
seed flags every account *must change password*, so each person sets a private
password at first sign-in (the change signs out every other session). Users can
change their password any time (key icon next to sign-out). Super admins can
**reset** a password (a one-time temporary password is shown once) and
**disable / re-enable** accounts under Admin; disabled accounts cannot sign in
and their API tokens stop working.

The sign-in page lists the team's accounts ("Who are you?") so people pick
themselves and only type their password — an internal-tool convenience served by
the public `GET /api/auth/accounts` (names, titles and colours only; disabled
accounts and integration accounts holding a live API token are left out). Set
`ATRIUM_LOGIN_ROSTER=off` on the server to hide the list.

| User | Email | Roles |
|---|---|---|
| Smith | smith@asmtech.international | **Owner · Super Admin** · Management admin |
| Uma | uma@asmtech.international | Accountant · **Accounts admin** · Administration & Project Alpha member |
| Nancy | nancy@asmtech.international | HR Manager · **HR admin** · Accounts **viewer** (read-only) |
| Cate | cate@asmtech.international | PA · **Administration & Project Alpha admin** · Management, Accounts, HR member |

Try it: open two browsers (or one normal + one private window), sign in as Cate
and Uma, open **Project Alpha** in both, and drag a task — the other screen
moves instantly. Same for chat messages and announcements.

## Interface

- **Themes:** light, dark, or follow-system — the sun/moon button in the sidebar
  footer cycles them; the choice is remembered per browser and applied before
  first paint. Colours are semantic tokens in `web/src/index.css` (`@theme` +
  the `.dark` remap), so components never hard-code light or dark values.
- **Live feedback:** when a teammate changes a task, the card flashes and shows
  "Uma moved this · just now"; if you are on another screen you get a toast with
  their avatar and a **View** link. New announcements, messages in rooms you
  are not looking at, and notifications also toast. Your own actions never do.
- **Quiet motion:** counters tween instead of jumping and a card a teammate
  just changed flashes its border; nothing else animates. All motion honours
  `prefers-reduced-motion`.
- **Dragging feels direct.** The board uses dnd-kit with pointer-based hit
  testing: a card lifts after 4 px of movement (150 ms hold on touch), follows
  the pointer exactly, moves into whatever column is *under the pointer* the
  moment you cross into it, and lands instantly on release — no drop
  animation, no minimum delay. Siblings step aside in 120 ms. Each card is one
  tab stop: Enter opens it, Space picks it up for a keyboard move (arrows,
  Space to drop, Esc to cancel). Measured with `e2e/shots/_drag-feel.mjs`:
  lift 22 ms, drop settled in 70 ms, and a card released with the pointer over
  another column lands there (the previous library took 210 ms to settle and
  judged the drop by the card's centre, so pointing at a column was not enough).
- **Groups:** super admins create groups from Admin and can delete one from
  Admin → Groups or from the group header (**Delete group**). Deleting removes
  the board, tasks, chat history and announcements for every member; open tabs
  learn immediately and members get a notification.
- **Errors are never silent:** every mutation goes through `mutate()` in
  `web/src/lib/api.ts`, which shows an error toast on failure; destructive
  actions use an in-app confirm dialog; a lost socket shows "Reconnecting…".
- **Command palette:** `Ctrl+K` (or `/`, or the search box) opens a palette that
  jumps to any page, group, task or conversation, starts a DM with anyone, runs
  actions (theme, password, shortcuts, sign out) and falls back to the server
  search for tasks, announcements and messages. Arrow keys + Enter.
- **Keyboard:** `n` starts a new task on a board, `Esc` closes, `Ctrl+Enter`
  saves a task, `?` lists the shortcuts.
- **Shell:** the avatar in the top bar opens an account menu; the sidebar
  collapses to an icon rail on desktop (state remembered per browser).
- **Reactions:** hover a chat message and pick a quick emoji; tallies update
  live for everyone in the room and are stored in `message_reactions`.
- **Caching:** `index.html` and deep links are served `no-cache`; fingerprinted
  `/assets` are immutable for a year. Old asset files stay on the server across
  deploys, and a tab that requests a chunk that no longer exists reloads itself
  once, so a deploy never strands an open browser.
- **Board:** sticky filter bar with sort (board order / due / priority — drag is
  off while sorted), hover quick actions on cards (mark done, assign to me),
  coloured column dots, animated counts, and a done-column progress ring. On
  phones the board shows one column per swipe with a tappable column pager, and
  the task modal has a **Column** selector as the reliable way to move a task.
- **Chat:** messages appear instantly (optimistic, swapped for the server copy
  via `clientId`), `Enter` sends and `Shift+Enter` adds a line, a "N new
  messages" pill appears when you are scrolled up, typing shows as bouncing
  dots, reply quotes jump to the original, emoji picker remembers recents, and
  the DM picker is searchable. Voice input shows the live transcript and
  reports a blocked microphone.
- **Lists:** notifications and activity are grouped by day; notifications mark
  read optimistically; activity is a timeline with avatars and verb icons that
  links into the group. Announcements mark themselves read after two seconds in
  view, and the page has an "Unread only" filter.

### Theme: "quiet console"

The interface follows the theme spec in `../PruExpert/ui-theme` (adopted
2026-09-21): white page, one hairline grey (`#e5e7eb`) for every border, a light
grey (`#f7f8fa`) for inset surfaces, two greys of text (`#1f2933` body,
`#6b7480` muted), and a single accent (`#ed1b2e`) used only for the primary
button, the brand line, the active tab line and the focus ring. Semantic tones
(red / amber / green / grey) appear on badges only — priority, due state,
done — never as decoration. Inter at four sizes (`text-xl` page title,
`text-sm` body, `text-xs` meta, 11px fine print), three weights, borders
instead of shadows (the only two: the active nav item and drawers/menus), and a
right-hand **drawer** for task detail so the board never loses its place.

All of this lives in `web/src/index.css`: the `@theme` block maps Atrium's
semantic token names (`panel`, `paper`, `line`, `ink-*`, `brand-*`, the
`*-soft` tones, radii, weights) onto those values, so changing the accent is
one line. The dark theme is the same six roles on dark greys. There are no
emoji or pictures anywhere in the interface: navigation and controls use
monochrome line icons that inherit the text colour, people are initials on a
grey disc, and each group carries a letter monogram (`GroupMark`) instead of
an icon. Nothing animates for its own sake — no confetti, no glows; motion is
limited to the drag itself, a short fade on page change and the live flash
on a card a teammate just changed.

### Install as an app

Atrium ships a web manifest (`web/public/manifest.webmanifest`) and icons, so it
installs like a native app with no store and no extra code: on a phone use the
browser's **Add to Home Screen**; in desktop Chrome/Edge click **Install Atrium**
in the address bar. Installed, it opens in its own window without browser
chrome, with shortcuts to *My Tasks*, *Chat* and the *Live display*. On the
office TV, install it and launch from the desktop for a clean full-screen kiosk.

## Live display / wallpaper mode

Every group has a **Display mode** (button in the group header, or
`/kiosk/<groupId>`): a dark, high-contrast 1920×1080 dashboard with live task
columns, stats, pinned notices and upcoming deadlines. Every card on the
board shows the task's description, progress bar and percentage (100% once it
reaches a done column), checklist count, owners and due state, so the display
answers "what is this and how far along is it" without anyone opening the app. `/kiosk` alone is
the all-projects overview. Every project also has its own display, reachable
three ways: the **project switcher** along the bottom (overview + one pill per
project, the current one lit), the small chevron on each overview card, or the
**← / → keys** (Home returns to the overview — TV remotes send these). The
**play button** (bottom-right) starts an **auto-tour**: the screen walks
overview → each project → overview, staying 30 seconds on each with a thin
progress line along the top; `?tour=45` in the URL sets the dwell time, and
the setting is remembered per browser so a TV keeps touring after a reload.
Cards themselves stay inert so stray clicks can't switch a wallpaper display;
the grid icon returns to the overview and the external-link icon opens the full
app. The display updates in real time, resyncs fully every 5 minutes, reloads
itself when a new version is deployed and recovers from a broken screen on its
own, so it can stay open on an office TV indefinitely.

**Every panel shows a digest and expands.** The small ⤢ icon in each panel
header opens a popup over the display with the full content: the announcement
card shows **pinned notices only** (falling back to the most important recent
one) and expands to every announcement in scope; *Coming up* expands to all
open deadlines grouped Overdue / Today / This week / Later; *Completed today*
to the whole week by day; each board column to all its tasks with description,
progress, checklist and owners; the project stat strip and each overview card
to a full project view. The **chat icon** (bottom-right) opens a read-only,
live view of team chat — the project's room, or a room picker on the overview —
with a link to reply in the app. Popups close with Esc, the Close control or the
backdrop, close themselves after 90 s without interaction, and pause the
auto-tour while open.

**The bottom strip shows what matters now, not a log.** It rotates through open
deadlines (nearest first, overdue in red, today in amber) and pinned notices.
The moment a teammate adds, moves or finishes a task in scope, the strip
flashes that change with a red *Live* mark for a few seconds, then returns to
the deadlines. It expands to the full deadline list.

**The right rail has a tab row.** On the overview the rail rotates every 15 s
between *Notices*, *Coming up* and *Done today*; the tabs above it show which
panel is on screen, with a thin line filling over the dwell time. Click a tab
to hold that panel; **Auto** resumes the rotation.

To use it as an actual Windows **desktop wallpaper**, use a web-capable live
wallpaper app (e.g. the open-source *Lively Wallpaper*): add a "Web page"
wallpaper pointing at `https://asm-atrium.duckdns.org/kiosk` (sign in once
in that view). For an office TV, just open the URL in a browser and press F11.
Exit display mode with Esc.

## OpenClaw / bot integration ("claw mode")

Pre-configured on the live deployment — see [INTEGRATION.md](INTEGRATION.md):

- Bot user **OpenClaw Bot** (`bot@asmtech.international`), member of all groups
- 365-day API token stored at `~/aidev/openclaw-token.json` on the server (mode 600;
  minted 2026-09-08 for the current instance — re-mint after a database reset, INTEGRATION.md §0–1)
- Mint/revoke more tokens in **Admin → API tokens** (super admin only)

## Architecture (summary)

- **Server** (`server/`): Node + Express 5 + Socket.IO + **PostgreSQL 16** (`pg`).
  Every mutation: permission check → DB write → broadcast to exactly the
  Socket.IO room that is allowed to see it (`group:{id}`, `user:{id}`,
  `room:{chatRoomId}`). JWT auth (bcrypt-hashed passwords) for both HTTP and
  the WebSocket handshake. Roles: super admin (global) + per-group
  admin / member / viewer, enforced server-side in `src/permissions.js`.
- **Web** (`web/`): React 18 + TypeScript + Vite + Tailwind v4 + Zustand +
  @dnd-kit (pointer-based drag and drop). REST responses and socket events land in one store;
  the board, dashboard, chat and kiosk are all views over the same state.
- **Scale path**: schema is plain relational SQL on PostgreSQL — add the
  Socket.IO Redis adapter for multi-node.

## Tests

```bash
# Backend API + permission suite (28 tests, throwaway PostgreSQL database per run;
# needs the local dev Postgres from Quick start, or set ATRIUM_TEST_ADMIN_URL)
cd server && npm test

# The same suite plus the web typecheck and build run on GitHub Actions for
# every push and pull request (.github/workflows/ci.yml).

# Two-user realtime E2E: real drag-and-drop synced across two browser sessions,
# live chat + typing indicator, announcement broadcast, permission walls.
# Requires both servers running and Chrome or Edge installed.
cd e2e && npm install && npm test

# Product screenshots (writes e2e/shots/*.png)
cd e2e && npm run shots

# Visual + realtime check of the local production build (server on :4600):
# screenshots every screen in light/dark/mobile and has a second user move a
# task to verify the card flash, the live toast and the kiosk pulse.
# The script lives in the gitignored e2e/shots/ folder (_round1-check.mjs).
```

## Project layout

```
server/src
  db.js            pg pool, schema, query helpers (?-placeholders -> $n)
  seed.js          demo data (4 users, 5 groups, tasks, chat, announcements)
  auth.js          JWT login + middleware + login rate limit
  permissions.js   role ranks, group/task/room guards — the security boundary
  live.js          Socket.IO hub: authenticated rooms, presence, typing
  services.js      notification fan-out + activity audit trail
  routes/          groups & columns & members, tasks & comments & checklist,
                   announcements, chat, notifications, activity, search, admin
web/src
  stores/          auth (persisted) + data (single realtime store)
  lib/             api client, socket wiring, types, formatting
  components/      layout, board (drag & drop, task modal), chat, announcements
  pages/           dashboard, my tasks, group workspace, chat, announcements,
                   notifications, activity, search, admin, kiosk display
e2e/               puppeteer realtime tests + screenshot capture
```

## Backups

`~/aidev/backup.sh` on the server runs from cron every night at 19:17 UTC
(03:17 Malaysia) and writes `pg_dump --clean` output to
`~/aidev/backups/atrium-YYYYMMDD-HHMM.sql.gz`, keeping 14 days (log:
`backups/backup.log`). Run it by hand any time: `~/aidev/backup.sh`.

Restore into the running database:

```bash
cd ~/aidev
gunzip -c backups/atrium-<stamp>.sql.gz | sudo docker compose exec -T db psql -U atrium -d atrium
sudo docker compose restart atrium
```

Dumps live on the same disk as the database. For an off-box copy turn on
**automatic snapshots** in the Lightsail console (instance → *Snapshots* →
*Automatic snapshots*, pick a time such as 20:00 UTC, after the dump): Lightsail
keeps the last seven daily images of the whole disk, including `~/aidev/backups`,
and a snapshot can be restored to a fresh instance in minutes.

### Self-healing and housekeeping

- `deploy/watchdog.sh` runs from cron every 5 minutes on the server. It probes
  `https://<host>/api/health`; after three consecutive failures it runs
  `docker compose up -d` and restarts the app and Caddy, logging to
  `~/aidev/watchdog.log`. It never touches the database container.
- Container logs are capped at 3 × 10 MB per service (`x-logging` in
  `docker-compose.yml`); `deploy.sh` prunes old images and unused Docker build
  cache after every deploy, so disk use stays flat.
- Ubuntu installs security updates unattended. When `/var/run/reboot-required`
  exists (kernel/libc), reboot at a quiet hour: `sudo reboot` — every container
  restarts on its own (`restart: unless-stopped`) and swap is in `/etc/fstab`.

## Security notes

- Sessions are 7-day JWTs. Changing or resetting a password invalidates every
  session token issued before it; long-lived API tokens (with a `jti`) are
  unaffected and are revoked explicitly in Admin.
- Disabled accounts are refused everywhere: sign-in, existing sessions, API
  tokens and live sockets.
- Sign-in is rate-limited per IP (20 failed attempts / 10 min). The server trusts
  exactly one proxy hop for the client address.
- CORS is an allowlist in production (see `ATRIUM_HOST` above). Caddy adds
  HSTS, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`.
- The HTML shell carries a `Content-Security-Policy` (built in
  `server/src/app.js`): scripts only from this origin plus the inline theme
  bootstrap, allowed by a SHA-256 hash computed from the built `index.html`;
  fonts from Google Fonts; fetch/WebSocket targets, frames, forms and plugins
  locked to this origin. Styles come only from this origin and Google Fonts —
  no `unsafe-inline` (the previous drag library needed it; dnd-kit does not).
- Passwords are bcrypt-hashed; the demo password is rejected as a new password.
- Schema changes go through `MIGRATIONS` in `server/src/db.js` (tracked in
  `schema_migrations`, applied at startup).

## Ports

Atrium's ports are deliberately distinct from the other projects on the dev
machine and avoid Windows' reserved (Hyper-V) TCP ranges, so all stacks can run
side by side. Reallocated 2026-09-07 — previously API `4100`, web `5273` (clashed
with PolicyCRM's `dev-prodapi` Vite config) and local PostgreSQL `55432` (clashed
with `policycrm-test-pg`).

| Service | Port | Where it is set |
|---|---|---|
| API + Socket.IO (dev **and** production container) | **4600** | `PORT` env; defaults in `server/src/index.js`, `Dockerfile`, `docker-compose.yml` |
| Web dev server (Vite, `strictPort`) | **5100** | `web/vite.config.ts` (also proxies `/api` + `/socket.io` to `:4600`) |
| Local PostgreSQL (host port → container 5432) | **5410** | `docker run -p 5410:5432` above; default `DATABASE_URL` in `server/src/db.js` and `server/tests/api.test.js` |

Production PostgreSQL is not published on any host port (private compose network).
The API port is only reachable inside Docker; the `reverse_proxy atrium:4600` line in
`Caddyfile` (deployed to `~/aidev/Caddyfile`) must always match it. Avoid
`54035–54634` for anything new — Windows reserves that range on this machine.

## Environment

- `DATABASE_URL` — PostgreSQL connection string
  (default `postgres://atrium:atrium@localhost:5410/atrium` for local dev;
  set by docker-compose in production)
- `ATRIUM_SECRET` — JWT signing secret. **Required when `NODE_ENV=production`**
  (the server refuses to start without it); a dev default is used otherwise.
- `ATRIUM_HOST`, `ATRIUM_IP` — hostnames / bare IP Caddy serves. In production
  they also form the CORS allowlist (`https://<host>` each, `http://<ip>`);
  `ATRIUM_ORIGINS="https://a https://b"` overrides it. Dev reflects any origin.
- `ATRIUM_LOGIN_ROSTER` — set to `off` to hide the account list on the sign-in page.
- `PORT` — API port (default 4600)
- `POSTGRES_PASSWORD` — database password (docker-compose, via `.env`)
