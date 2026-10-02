#!/usr/bin/env bash
# Self-healing check for the Atrium stack. Installed as a cron job every 5 minutes
# by deploy/deploy.sh. Probes the public health endpoint; after 3 consecutive
# failures (about 15 minutes) it brings the stack back up and restarts the app
# and Caddy, then logs what it did to ~/aidev/watchdog.log.
# It never touches the database container, and it never deletes anything.
set -u
APP_DIR="$HOME/aidev"
STATE="$APP_DIR/.watchdog-fails"
LOG="$APP_DIR/watchdog.log"
cd "$APP_DIR" || exit 0

# First hostname in ATRIUM_HOST (Caddy only answers for names it serves).
host=$(grep -E '^ATRIUM_HOST=' .env | cut -d= -f2- | awk '{print $1}')
url="https://${host}/api/health"
[ -z "$host" ] && { ip=$(grep -E '^ATRIUM_IP=' .env | cut -d= -f2-); url="http://${ip}/api/health"; }

if curl -fsS --max-time 15 "$url" >/dev/null 2>&1; then
  rm -f "$STATE"
  exit 0
fi

fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$STATE"
echo "$(date -Is) health check failed ($fails/3): $url" >> "$LOG"
[ "$fails" -lt 3 ] && exit 0

echo "$(date -Is) restarting stack" >> "$LOG"
sudo docker compose up -d >> "$LOG" 2>&1
sudo docker compose restart atrium caddy >> "$LOG" 2>&1
rm -f "$STATE"
