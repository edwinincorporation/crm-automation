#!/bin/bash
# Usage: bash setdefaultmail.sh   (changes only the DEFAULT mailbox password SMTP_PASS in .env; asked hidden; then pm2 restart)
set -e
cd "$(dirname "$0")"
U=$(grep '^SMTP_USER=' .env | head -1 | cut -d= -f2-)
H=$(grep '^SMTP_HOST=' .env | head -1 | cut -d= -f2-)
echo "Default mailbox: ${U:-(SMTP_USER not set)}  host: ${H:-(SMTP_HOST not set)}"
read -rsp "New App password for $U (hidden): " PW; echo
PW="${PW// /}"
[ -z "$PW" ] && { echo "Khali password - kuch badla nahi."; exit 1; }
sed -i '/^SMTP_PASS=/d' .env
echo "SMTP_PASS=$PW" >> .env
history -c 2>/dev/null || true
set -a; . ./.env; set +a
pm2 restart crmautomation --update-env >/dev/null && echo "Saved. Default mailbox ka password badal gaya."
