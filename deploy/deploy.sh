#!/usr/bin/env bash
# Build, package and deploy Atrium to the Lightsail instance.
#   KEY=path/to/key.pem HOST=56.69.175.201 bash deploy/deploy.sh
# First run on a fresh instance also uploads and runs deploy/bootstrap.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${KEY:-atrium-lightsail.key}"
HOST="${HOST:-56.69.175.201}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new ubuntu@$HOST"

build_of() { curl -s --max-time 5 "http://$HOST/api/health" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p'; }
before=$(build_of || true)

echo '>> building frontend'
(cd web && npm run build >/dev/null)

echo '>> packaging'
tar czf aidev-deploy.tgz Dockerfile docker-compose.yml Caddyfile deploy/watchdog.sh \
  server/package.json server/package-lock.json server/src web/dist

echo ">> uploading to $HOST"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new aidev-deploy.tgz deploy/bootstrap.sh ubuntu@"$HOST":~/
rm -f aidev-deploy.tgz

echo '>> bootstrap (idempotent) + compose up'
$SSH 'bash ~/bootstrap.sh && mkdir -p ~/aidev && tar xzf ~/aidev-deploy.tgz -C ~/aidev && rm ~/aidev-deploy.tgz \
  && cd ~/aidev && sudo docker compose up -d --build --remove-orphans \
  && sudo docker compose restart caddy \
  && sudo docker image prune -f >/dev/null \
  && sudo docker builder prune -f >/dev/null \
  && chmod +x deploy/watchdog.sh \
  && (crontab -l 2>/dev/null | grep -q "deploy/watchdog.sh" || (crontab -l 2>/dev/null; echo "*/5 * * * * $HOME/aidev/deploy/watchdog.sh") | crontab -) \
  && sudo docker compose ps'
# Caddy is restarted (not reloaded): the Caddyfile is a single-file bind mount and
# tar replaces it with a new inode, which a running container never sees.
# Image/builder prune keeps the disk flat across deploys: old images and build
# cache no longer backing the current image go; the layers behind the running
# image stay, so the next build is still fast. (`--keep-storage` reclaimed nothing
# here.) The watchdog cron self-heals the stack (deploy/watchdog.sh).

echo '>> health'
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$HOST/api/health" || true)
  if [ "$code" = "200" ]; then
    after=$(build_of || true)
    echo "http://$HOST/api/health -> 200  build ${before:-?} -> ${after:-?}"
    # Open tabs learn the new id over their sockets: displays reload themselves,
    # app users get a prompt and switch on their next page change.
    [ -n "$before" ] && [ "$before" = "$after" ] && echo "   (same build id: frontend unchanged, server-only deploy)"
    exit 0
  fi
  sleep 3
done
echo "app not healthy yet (last code: $code) — check: $SSH 'cd ~/aidev && sudo docker compose logs --tail=50'"
exit 1
