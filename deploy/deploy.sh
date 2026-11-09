#!/usr/bin/env bash
# Builds the API and web app on this machine and ships them to one environment over SSH (ADR 0005).
# Usage: deploy/deploy.sh <environment>; deploy/environments/<environment>.env sets SSH_TARGET and SITE_ADDRESS,
# and NOINDEX=true to keep search engines off an environment whose data doesn't last (the public beta).
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="deploy/environments/${1:?usage: deploy.sh <environment>}.env"
[ -f "$env_file" ] || { echo "$env_file is missing; start from deploy/environments/example.env" >&2; exit 1; }
# shellcheck source=/dev/null
source "$env_file"
: "${SSH_TARGET:?is not set in $env_file}" "${SITE_ADDRESS:?is not set in $env_file}"

# Static binary, built from the committed query cache so the build needs no database. Only the API package: the
# workspace also holds the WebAssembly crate the web app loads, which can't build for this target. TLS (aws-lc-sys)
# compiles C, which needs musl's compiler wrapper: `apt install musl-tools`.
command -v musl-gcc >/dev/null || { echo "musl-gcc is missing: sudo apt install musl-tools" >&2; exit 1; }
(cd api && SQLX_OFFLINE=true CC_x86_64_unknown_linux_musl=musl-gcc \
  cargo build --release --locked --target x86_64-unknown-linux-musl -p sourcejump-api)
# Standalone server, plus the static assets Next expects next to it.
(cd web && SJ_SITE_URL="https://$SITE_ADDRESS" npm run build)
rm -rf web/.next/standalone/.next/static
cp -r web/.next/static web/.next/standalone/.next/static
if [ -d web/public ]; then cp -r web/public web/.next/standalone/; fi

rsync -az api/target/x86_64-unknown-linux-musl/release/sourcejump-api "$SSH_TARGET:/opt/sourcejump/api/"
rsync -az --delete --exclude .next/cache web/.next/standalone/ "$SSH_TARGET:/opt/sourcejump/web/"
rsync -az deploy/sourcejump-api.service deploy/sourcejump-web.service "$SSH_TARGET:/etc/systemd/system/"
robots_header=""
if [ "${NOINDEX:-false}" = true ]; then robots_header='header X-Robots-Tag "noindex, nofollow"'; fi
sed -e "s/SITE_ADDRESS/$SITE_ADDRESS/" -e "s/ROBOTS_HEADER/$robots_header/" deploy/Caddyfile |
  ssh "$SSH_TARGET" 'cat >/etc/caddy/Caddyfile.new'

ssh "$SSH_TARGET" bash -euo pipefail <<'EOF'
install -d -o sourcejump -g sourcejump /opt/sourcejump/web/.next/cache
systemctl daemon-reload
systemctl enable sourcejump-api sourcejump-web
# The API applies migrations as it starts; if one fails, the API stays down and the smoke test below fails.
systemctl restart sourcejump-api sourcejump-web
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl reload caddy
EOF

echo "Waiting for https://$SITE_ADDRESS ..."
for _ in $(seq 30); do
  if curl -sf "https://$SITE_ADDRESS/health" >/dev/null && curl -sf -o /dev/null "https://$SITE_ADDRESS/"; then
    echo "Deployed: API and web answer on https://$SITE_ADDRESS"
    exit 0
  fi
  sleep 2
done
echo "Smoke test failed. Logs: ssh $SSH_TARGET journalctl -u sourcejump-api -u sourcejump-web -n 50" >&2
exit 1
