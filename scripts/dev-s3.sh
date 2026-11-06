#!/usr/bin/env bash
# Runs a single-node Garage S3 server for development (ADR 0006), so replay uploads use the same presigned
# flow as production, and serves the bucket's public files (map images, viewer files) to browsers at
# http://sourcejump-dev.web.garage.localhost:3902. Data lives in .garage/ (gitignored). The bucket and access key match .env.example;
# they only work against this local server. Runs in the foreground; Ctrl+C stops it.
set -euo pipefail
cd "$(dirname "$0")/.."

dir="$PWD/.garage"
config="$dir/garage.toml"
bucket=sourcejump-dev
# Private, no website: staff and replay uploads wait here until the API checks them.
staging=sourcejump-dev-staging
key_id=GK000000000000000000000001
key_secret=0000000000000000000000000000000000000000000000000000000000000001

command -v garage >/dev/null || { echo "garage is not installed; see CLAUDE.md prerequisites" >&2; exit 1; }
mkdir -p "$dir"
if [ ! -f "$config" ]; then
  cat >"$config" <<EOF
metadata_dir = "$dir/meta"
data_dir = "$dir/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

[s3_api]
s3_region = "garage"
api_bind_addr = "127.0.0.1:3900"
EOF
  chmod 600 "$config"
fi
# Configs made before public files were served lack the web endpoint.
if ! grep -q '^\[s3_web\]' "$config"; then
  printf '\n[s3_web]\nbind_addr = "127.0.0.1:3902"\nroot_domain = ".web.garage.localhost"\n' >>"$config"
fi
export GARAGE_CONFIG_FILE="$config"

garage server &
server=$!
trap 'kill $server 2>/dev/null' EXIT
until garage status >/dev/null 2>&1; do sleep 0.2; done

# First run only: give the node storage, then create the bucket and the dev key.
if garage layout show 2>/dev/null | grep -q 'Current cluster layout version: 0'; then
  garage layout assign -z dev -c 1G "$(garage node id -q | cut -d@ -f1)" >/dev/null
  garage layout apply --version 1 >/dev/null
fi
garage bucket info "$bucket" >/dev/null 2>&1 || garage bucket create "$bucket" >/dev/null
garage key info "$key_id" >/dev/null 2>&1 || garage key import --yes -n dev "$key_id" "$key_secret" >/dev/null
garage bucket allow --read --write --owner "$bucket" --key "$key_id" >/dev/null
garage bucket website --allow "$bucket" >/dev/null
garage bucket info "$staging" >/dev/null 2>&1 || garage bucket create "$staging" >/dev/null
garage bucket allow --read --write --owner "$staging" --key "$key_id" >/dev/null
# The replay viewer reads maps and stock VPKs (by range request) from the site's own origin, so the bucket must
# allow it. Garage's CLI can't set CORS; its S3 API can, and curl signs the request itself.
cors='<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>'
curl -fsS -o /dev/null -X PUT --aws-sigv4 "aws:amz:garage:s3" --user "$key_id:$key_secret" \
  -H "Content-MD5: $(printf '%s' "$cors" | openssl dgst -md5 -binary | base64)" \
  --data-binary "$cors" "http://127.0.0.1:3900/$bucket?cors"
# Staff pages upload straight to the staging bucket, so it takes PUT from the site.
staging_cors='<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>'
curl -fsS -o /dev/null -X PUT --aws-sigv4 "aws:amz:garage:s3" --user "$key_id:$key_secret" \
  -H "Content-MD5: $(printf '%s' "$staging_cors" | openssl dgst -md5 -binary | base64)" \
  --data-binary "$staging_cors" "http://127.0.0.1:3900/$staging?cors"

echo "Local S3 ready at http://127.0.0.1:3900, buckets $bucket and $staging"
wait $server
