#!/bin/bash
# Deploy/update crmautomation.delhicrest.in on the VPS. Run as root:  bash /opt/crmautomation/deploy.sh
set -e
APP=/opt/crmautomation
DOMAIN=crmautomation.delhicrest.in
REPO=${REPO:-https://github.com/edwinincorporation/crm-automation}
export DEBIAN_FRONTEND=noninteractive
if [ -d $APP/.git ]; then git -C $APP pull --ff-only; else
  [ -e $APP ] && [ ! -f $APP/.env ] && rm -rf $APP
  if [ -e $APP ]; then mkdir -p /root/crmauto-bak && cp -a $APP/.env $APP/portal.db* /root/crmauto-bak/ 2>/dev/null || true; fi
  git clone "$REPO" /root/crmauto-src && mkdir -p $APP && cp -a /root/crmauto-src/. $APP/ && rm -rf /root/crmauto-src
  cp -an /root/crmauto-bak/. $APP/ 2>/dev/null || true
fi
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
command -v pm2 >/dev/null || npm i -g pm2
cd $APP
npm install --omit=dev || { apt-get install -y build-essential python3 && npm install --omit=dev; }
if [ ! -f .env ]; then
  PORT=3100; while ss -ltn | grep -q ":$PORT "; do PORT=$((PORT+1)); done
  PW=$(head -c 9 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)
  printf 'PORT=%s\nADMIN_USER=admin\nADMIN_PASSWORD=%s\nCOOKIE_SECURE=1\nDEMO=1\nDRY_RUN=1\n' "$PORT" "$PW" > .env
  chmod 600 .env
  echo "FIRST LOGIN -> admin / $PW"
fi
set -a; . ./.env; set +a
pm2 delete crmautomation >/dev/null 2>&1 || true
pm2 start server.js --name crmautomation --update-env
pm2 save
cat > /etc/nginx/sites-available/crmautomation <<NG
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 5m;
  location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
}
NG
ln -sf /etc/nginx/sites-available/crmautomation /etc/nginx/sites-enabled/crmautomation
nginx -t && systemctl reload nginx
certbot --nginx -d $DOMAIN --register-unsafely-without-email --agree-tos --redirect --non-interactive || echo "!! certbot failed - check DNS A record for $DOMAIN"
echo "DONE: https://$DOMAIN/"
