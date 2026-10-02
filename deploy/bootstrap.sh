#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu Lightsail instance for Atrium.
# Run as the ubuntu user:  bash bootstrap.sh
# Idempotent: safe to run again.
set -euo pipefail

APP_DIR="$HOME/aidev"
HOST="${ATRIUM_HOST:-aidev.asmtech.international}"
IP="${ATRIUM_IP:-$(curl -fsS -4 https://checkip.amazonaws.com || hostname -I | awk '{print $1}')}"

# 1. Swap: the 512 MB plan cannot build/run Node + PostgreSQL + Caddy without it.
if ! swapon --show --noheadings | grep -q '/swapfile'; then
  echo '>> creating 2 GB swap'
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-atrium-swap.conf >/dev/null
  sudo sysctl -q -p /etc/sysctl.d/99-atrium-swap.conf
fi

# 2. Docker Engine + compose plugin (official convenience script)
if ! command -v docker >/dev/null 2>&1; then
  echo '>> installing Docker'
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker >/dev/null

# 3. App directory + secrets (generated once, never printed)
mkdir -p "$APP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
  echo '>> generating .env secrets'
  umask 077
  cat > "$APP_DIR/.env" <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ATRIUM_SECRET=$(openssl rand -hex 48)
ATRIUM_HOST=$HOST
ATRIUM_IP=$IP
ENV
fi

echo ">> ready. App dir: $APP_DIR  host: $HOST  ip: $IP"
free -m | sed -n '1,3p'
