#!/bin/bash
# One-time setup of the preview host (AU: Ubuntu, nginx behind Cloudflare). Run as root from this folder:
#   sudo ./install.sh "<public half of the CI preview key>"
# Needs the Cloudflare Origin CA certificate at /etc/ssl/sj-preview/origin.pem and origin.key first.
# Safe to run again; it brings everything back to this state.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
PUBKEY="${1:?usage: install.sh \"ssh-ed25519 AAAA... comment\"}"
HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME=sjpreview
ROOT=/srv/sj-preview

for f in /etc/ssl/sj-preview/origin.pem /etc/ssl/sj-preview/origin.key; do
  [ -s "$f" ] || { echo "missing $f (Cloudflare → SSL/TLS → Origin Server → Create certificate)"; exit 1; }
done
chmod 600 /etc/ssl/sj-preview/origin.key

apt-get install -y podman uidmap curl

if ! id "$USER_NAME" >/dev/null 2>&1; then
  # A real shell is required: sshd runs the forced command through it. The key can't run anything else.
  useradd --system --create-home --shell /bin/bash "$USER_NAME"
fi
# Rootless podman needs subordinate ids; system users don't get them by default. Take the next free range
# after every existing one, so nothing overlaps another user's containers.
next_free() { awk -F: 'BEGIN { m = 100000 } { e = $2 + $3; if (e > m) m = e } END { print m }' "$1"; }
if ! grep -q "^$USER_NAME:" /etc/subuid; then
  s=$(next_free /etc/subuid); usermod --add-subuids "$s-$(( s + 65535 ))" "$USER_NAME"
fi
if ! grep -q "^$USER_NAME:" /etc/subgid; then
  s=$(next_free /etc/subgid); usermod --add-subgids "$s-$(( s + 65535 ))" "$USER_NAME"
fi

install -d -o "$USER_NAME" -g "$USER_NAME" -m 755 "$ROOT" "$ROOT/sites" "$ROOT/tmp"
[ -f "$ROOT/ports.map" ] || install -o "$USER_NAME" -g "$USER_NAME" -m 644 /dev/null "$ROOT/ports.map"
install -m 755 "$HERE/sj-preview" /usr/local/bin/sj-preview
[ -f /etc/sj-preview.env ] || printf '# Overrides for /usr/local/bin/sj-preview, e.g. SJP_MAX_PREVIEWS=12\n' > /etc/sj-preview.env

# The only privileged thing sj-preview does: check and reload nginx after ports.map changes.
cat > /etc/sudoers.d/sj-preview <<EOF
$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/nginx -t -q, /usr/bin/systemctl reload nginx
EOF
chmod 440 /etc/sudoers.d/sj-preview
visudo -cf /etc/sudoers.d/sj-preview

# Containers survive reboots: lingering keeps the user's systemd running, podman-restart starts them.
loginctl enable-linger "$USER_NAME"
uid=$(id -u "$USER_NAME")
for _ in $(seq 10); do [ -d "/run/user/$uid" ] && break; sleep 1; done
# From /, since the folder this script runs in may be private to whoever copied it over.
as_user() { (cd / && sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$uid" "$@"); }
as_user systemctl --user enable --now podman-restart.service
as_user podman pull docker.io/library/node:24-bookworm-slim

home=$(getent passwd "$USER_NAME" | cut -d: -f6)
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$home/.ssh"
echo "command=\"/usr/local/bin/sj-preview\",restrict $PUBKEY" > "$home/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "$home/.ssh/authorized_keys"
chmod 600 "$home/.ssh/authorized_keys"

install -m 644 "$HERE/sj-preview.nginx.conf" /etc/nginx/sites-available/sj-preview.conf
ln -sf /etc/nginx/sites-available/sj-preview.conf /etc/nginx/sites-enabled/sj-preview.conf
nginx -t
systemctl reload nginx

echo
echo "Done. Left to do:"
echo " - Cloudflare DNS: A record '*' -> $(curl -fsS -4 https://ifconfig.me 2>/dev/null || echo '<this IP>'), proxied"
echo " - GitHub secret PREVIEW_SSH_TARGET = $USER_NAME@<this IP>"
