# Integrating Atrium with OpenClaw (or any bot / script)

**You do not need to build a new API.** Atrium already exposes its full REST API —
the same one the web app uses — plus Socket.IO for live events. An OpenClaw
skill only needs an HTTP client and a token.

## 0. Claw mode is already set up on the live deployment

The `aidev` deployment ships pre-configured:

- Bot user: **OpenClaw Bot** (`bot@asmtech.international`), member of every group
- 365-day API token: on the server at `~/aidev/openclaw-token.json` (mode 600)

```bash
# Read the credential on the server (never commit it anywhere):
ssh -i atrium-lightsail.key ubuntu@56.69.175.201 "cat ~/aidev/openclaw-token.json"
```

Copy the `token` value into OpenClaw's config/secrets and point it at
`https://asm-atrium.duckdns.org` (later also `https://aidev.asmtech.international`). To revoke it: **Admin → API tokens** in
the web app (sign in as Smith), or `DELETE /api/admin/api-token/<jti>`.

## 1. Create another bot identity (optional)

Best practice: a dedicated bot user, added only to the groups the assistant may touch.

```bash
BASE=https://asm-atrium.duckdns.org   # live now; https://aidev.asmtech.international once its DNS exists

# Sign in as a super admin (Smith) to get a short-lived admin token
ADMIN_TOKEN=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"smith@asmtech.international","password":"atrium123"}' | jq -r .token)

# Create the bot user
curl -s $BASE/api/admin/users -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Reporting Bot","email":"reports@asmtech.international","password":"<random-strong-pw>","department":"Automation","title":"Assistant"}'

# Add the bot to a group (use the returned user id and your group id)
curl -s $BASE/api/groups/5/members -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"userId":<botId>,"role":"member"}'

# Mint a LONG-LIVED API token for the bot (super admin only; default 365 days)
curl -s $BASE/api/admin/api-token -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"userId":<botId>,"days":365}'
# -> { "token": "eyJ...", "actsAs": "Reporting Bot", "expiresInDays": 365 }
```

Every call below is just `Authorization: Bearer <token>`. Permissions are
enforced server-side, so the bot can only see and change what its group roles allow.

## 2. Endpoints an assistant typically uses

| Action | Call |
|---|---|
| My groups + progress + value | `GET /api/groups` |
| Board snapshot (columns, tasks, members) | `GET /api/groups/:id` |
| Create task | `POST /api/groups/:id/tasks` `{title, columnId, priority?, dueDate?, assigneeIds?}` |
| Move task | `PATCH /api/tasks/:id/move` `{columnId, position}` |
| Update task / assign | `PATCH /api/tasks/:id` `{title?, description?, priority?, dueDate?, progress?, assigneeIds?}` |
| Comment on task | `POST /api/tasks/:id/comments` `{body}` |
| Post announcement (group admin role) | `POST /api/announcements` `{scope:"group", groupId, title, body, priority}` |
| Send chat message | `POST /api/chat/rooms/:roomId/messages` `{body}` (rooms from `GET /api/chat/rooms`) |
| DM a user | `POST /api/chat/dm` `{userId}` → then post to the returned room |
| Search everything the bot can see | `GET /api/search?q=…` |
| Set project value | `PATCH /api/groups/:id` `{value: 250000, valueUnit: "RM"}` |

All responses are JSON. Errors: `{"error": "message"}` with 4xx status.

## 3. Example OpenClaw skill actions

- "add a task to Project Alpha: follow up Meridian PO, due Friday, assign Uma"
  → `GET /api/groups` (find Alpha id) → `GET /api/groups/5` (find column + Uma's id)
  → `POST /api/groups/5/tasks`
- "what's overdue in Accounts?" → `GET /api/groups/2` → filter `dueDate < today && !completedAt`
- "tell the team the demo moved to 4pm" → `POST /api/announcements` or chat message.

## 4. Live events (optional, later)

For push-style automation ("notify me in WhatsApp when a task hits Review"),
connect Socket.IO as the bot: `io("https://asm-atrium.duckdns.org", { auth: { token } })`
and listen for `task.moved`, `announcement.created`, `message.new`, etc.
A polling loop over the REST API is a fine first version.
