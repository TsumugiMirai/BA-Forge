#!/bin/bash
# Install or update the BA-ReCard API on the server. Copy this folder to the
# server and run it from there:
#
#   sudo ./install.sh
#
# Needs PostgreSQL 14+ on 127.0.0.1:5432 and nginx with the HTTPS site of
# 110.42.238.185. On the first install, put
# postgrest-<version>-linux-static-x86-64.tar.xz (from
# https://github.com/PostgREST/postgrest/releases) next to this script.
# Running it again keeps the data and the secrets already in use.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo." >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

PGRST_VERSION=v16.6
PGRST_SHA256=335ea29f00145705fb569b1268b9c8e53d062f8f6f9188192e92ea3781d2dca1
CONF=/etc/ba-recard/postgrest.conf
SITE=/etc/nginx/sites-available/particlexx
INCLUDE='include /etc/nginx/snippets/ba-recard.conf;'

# 1. service account
id ba-recard >/dev/null 2>&1 ||
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ba-recard

# 2. PostgREST binary
tarball="$here/postgrest-$PGRST_VERSION-linux-static-x86-64.tar.xz"
if [ -f "$tarball" ]; then
  echo "$PGRST_SHA256  $tarball" | sha256sum -c --quiet
  install -d -m 0755 /opt/ba-recard/bin
  tar -xJf "$tarball" -C /opt/ba-recard/bin --no-same-owner postgrest
  chmod 0755 /opt/ba-recard/bin/postgrest
elif [ ! -x /opt/ba-recard/bin/postgrest ]; then
  echo "Missing $tarball" >&2
  exit 1
fi

# 3. secrets: keep the ones in use, else make new ones
auth_pw='' jwt_secret=''
if [ -f "$CONF" ]; then
  auth_pw=$(sed -n 's|^db-uri = "postgres://ba_recard_authenticator:\([^@]*\)@.*|\1|p' "$CONF")
  jwt_secret=$(sed -n 's|^jwt-secret = "\(.*\)"$|\1|p' "$CONF")
fi
[ -n "$auth_pw" ] || auth_pw=$(openssl rand -hex 24)
[ -n "$jwt_secret" ] || jwt_secret=$(openssl rand -hex 32)

# 4. database (roles, ba_recard database, tables, login function)
{
  printf '\\set auth_password %s\n\\set jwt_secret %s\n' "'$auth_pw'" "'$jwt_secret'"
  cat "$here/schema.sql"
} | (cd / && runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres)

# 5. PostgREST config (holds both secrets)
install -d -m 0750 -o root -g ba-recard /etc/ba-recard
sed -e "s|{{AUTH_PASSWORD}}|$auth_pw|" -e "s|{{JWT_SECRET}}|$jwt_secret|" \
  "$here/postgrest.conf.template" > "$CONF.new"
chown root:ba-recard "$CONF.new"
chmod 0640 "$CONF.new"
mv "$CONF.new" "$CONF"

# 6. services: API, daily backup, password tool
install -m 0644 "$here/ba-recard-api.service" "$here/ba-recard-backup.service" \
  "$here/ba-recard-backup.timer" /etc/systemd/system/
install -m 0755 "$here/ba-recard-backup" "$here/ba-recard-set-password" /usr/local/sbin/
systemctl daemon-reload
systemctl enable --quiet ba-recard-api.service ba-recard-backup.timer
systemctl restart ba-recard-api.service
systemctl start ba-recard-backup.timer

# 7. nginx: rate-limit zones, the /ba-recard/api/ locations, and one include
#    line in the existing HTTPS site. Anything that fails `nginx -t` is put
#    back, so the running site (and its certificate renewals) never break.
[ -f "$SITE" ] || { echo "Missing $SITE (the site with the HTTPS server block)." >&2; exit 1; }
stamp=$(date +%Y%m%d%H%M%S)
saved=$(mktemp -d)
for f in /etc/nginx/conf.d/ba-recard.conf /etc/nginx/snippets/ba-recard.conf "$SITE"; do
  if [ -f "$f" ]; then cp -a "$f" "$saved/$(basename "$f")"; fi
done
revert_nginx() {
  for f in /etc/nginx/conf.d/ba-recard.conf /etc/nginx/snippets/ba-recard.conf; do
    if [ -f "$saved/$(basename "$f")" ]; then cp -a "$saved/$(basename "$f")" "$f"; else rm -f "$f"; fi
  done
  cp -a "$saved/$(basename "$SITE")" "$SITE"
}
install -m 0644 "$here/nginx/ba-recard-zones.conf" /etc/nginx/conf.d/ba-recard.conf
install -m 0644 "$here/nginx/ba-recard-locations.conf" /etc/nginx/snippets/ba-recard.conf
if ! grep -qF "$INCLUDE" "$SITE"; then
  cp -a "$SITE" "/var/backups/$(basename "$SITE").nginx.$stamp.bak"
  sed -i "/listen 443 ssl/,/^}/ s|^\(\s*\)server_name 110\.42\.238\.185;|&\n\1$INCLUDE|" "$SITE"
  if ! grep -qF "$INCLUDE" "$SITE"; then
    revert_nginx
    echo "Could not find the HTTPS server block in $SITE; nginx left unchanged." >&2
    exit 1
  fi
fi
if ! nginx -t -q; then
  revert_nginx
  echo "nginx -t failed; nginx changes reverted." >&2
  exit 1
fi
systemctl reload nginx
rm -rf "$saved"

# 8. quick check: a wrong login must be refused with 403
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"username":"","password":""}' http://127.0.0.1:3020/rpc/login || true)
echo "PostgREST $(/opt/ba-recard/bin/postgrest --version 2>/dev/null | head -1): wrong login -> HTTP $code (expected 403)"
accounts=$(cd / && runuser -u postgres -- psql -X -At -d ba_recard -c 'select count(*) from private.accounts')
[ "$accounts" != 0 ] || echo "No account yet: run  sudo ba-recard-set-password"
