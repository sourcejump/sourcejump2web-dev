#!/bin/bash
# One-time setup of the preview server (Debian/Ubuntu with Caddy and cloudflared already running). Run as root:
#   sudo ./install.sh "<public key of the CI deploy key>"
# Safe to run again; it brings everything back to this state.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
PUBKEY="${1:?usage: install.sh \"ssh-ed25519 AAAA... comment\"}"
HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME=sjpreview
ROOT=/srv/sj-preview

apt-get install -y podman uidmap curl

if ! id "$USER_NAME" >/dev/null 2>&1; then
  # A real shell is required: sshd runs the forced command through it. The key can't run anything else.
  useradd --system --create-home --shell /bin/bash "$USER_NAME"
fi
# Rootless podman needs subordinate ids; system users don't get them by default.
grep -q "^$USER_NAME:" /etc/subuid || usermod --add-subuids 200000-265535 "$USER_NAME"
grep -q "^$USER_NAME:" /etc/subgid || usermod --add-subgids 200000-265535 "$USER_NAME"

install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$ROOT" "$ROOT/sites" "$ROOT/tmp"
[ -f "$ROOT/ports.map" ] || install -o "$USER_NAME" -g "$USER_NAME" -m 644 /dev/null "$ROOT/ports.map"
install -m 755 "$HERE/sj-preview" /usr/local/bin/sj-preview
[ -f /etc/sj-preview.env ] || printf '# Overrides for /usr/local/bin/sj-preview, e.g. SJP_API_URL=...\n' > /etc/sj-preview.env

# The only privileged thing sj-preview does: reload Caddy after ports.map changes.
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy" > /etc/sudoers.d/sj-preview
chmod 440 /etc/sudoers.d/sj-preview
visudo -cf /etc/sudoers.d/sj-preview

# Containers survive reboots: lingering keeps the user's systemd running, podman-restart starts them.
loginctl enable-linger "$USER_NAME"
uid=$(id -u "$USER_NAME")
for _ in $(seq 10); do [ -d "/run/user/$uid" ] && break; sleep 1; done
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user enable --now podman-restart.service
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$uid" podman pull docker.io/library/node:24-bookworm-slim

home=$(getent passwd "$USER_NAME" | cut -d: -f6)
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$home/.ssh"
echo "command=\"/usr/local/bin/sj-preview\",restrict $PUBKEY" > "$home/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "$home/.ssh/authorized_keys"
chmod 600 "$home/.ssh/authorized_keys"

install -m 644 "$HERE/sj-preview.caddy" /etc/caddy/sj-preview.caddy
if ! grep -q 'import /etc/caddy/sj-preview.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/sj-preview.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy

echo
echo "Done. Remaining by hand:"
echo " - cloudflared: add ingress '*.okwhiteli.st -> http://127.0.0.1:80' (before the catch-all rule)"
echo " - Cloudflare DNS: CNAME '*' -> <tunnel-id>.cfargotunnel.com (proxied)"
echo " - GitHub secret PREVIEW_SSH_TARGET = $USER_NAME@<this host>"
echo " - GitHub secret PREVIEW_SSH_KNOWN_HOSTS = output of: ssh-keyscan <this host>"
