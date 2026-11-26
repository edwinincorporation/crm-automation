#!/bin/bash
# Usage: bash setgmail.sh   (puts the Google OAuth Client ID + Secret for "Gmail connect" into the portal's .env; the secret is asked HIDDEN; then clean restart)
set -e
cd "$(dirname "$0")"
read -rp "Google Client ID (xxxx.apps.googleusercontent.com): " I; I="$(printf %s "$I" | tr -d '[:space:]')"
case "$I" in *.apps.googleusercontent.com) ;; *) echo "Ye Client ID (.apps.googleusercontent.com) nahi lagti - kuch badla nahi."; exit 1;; esac
read -rsp "Google Client Secret (hidden): " S; echo
S="$(printf %s "$S" | tr -d '[:space:]')"
[ ${#S} -ge 20 ] || { echo "Secret chhota lagta hai - kuch badla nahi."; exit 1; }
sed -i '/^GOOGLE_CLIENT_ID=/d;/^GOOGLE_CLIENT_SECRET=/d' .env
printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$I" "$S" >> .env
history -c 2>/dev/null || true
bash restart.sh
