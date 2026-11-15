#!/bin/bash
# Usage: bash setmailbox.sh EDWINCO care@edwin.co.in   (password asked hidden; saved in .env; then pm2 restart)
set -e
P="$1"; U="$2"
[ -z "$P" ] || [ -z "$U" ] && { echo "Use: bash setmailbox.sh PREFIX email  (PREFIX: EDWINCO / EDWININC / DELHICREST)"; exit 1; }
cd "$(dirname "$0")"
read -rsp "App password for $U (hidden): " PW; echo
PW="${PW// /}"
sed -i "/^SMTP_${P}_/d" .env
{ echo "SMTP_${P}_USER=$U"; echo "SMTP_${P}_PASS=$PW"; } >> .env
history -c 2>/dev/null || true
set -a; . ./.env; set +a
pm2 restart crmautomation --update-env >/dev/null && echo "Saved. $U ab $P brand ke liye set hai."
