#!/bin/bash
# Usage: bash linkdialer.sh        -> copies the portal's AI_RECEPTIONIST_SECRET into the Dialer's .env (EMPLOYEE_PORTAL_URL + EMPLOYEE_PORTAL_AI_SECRET). The secret is never printed.
#        bash linkdialer.sh jwt    -> also makes a new JWT_SECRET for the Dialer (everyone has to log in again after the next restart)
# Both files live on the same server. A backup of the Dialer .env is kept next to it.
set -e
cd "$(dirname "$0")"
D="${DIALER_ENV:-/opt/edwin-dialer/app/.env}"
URL="${PORTAL_URL:-https://crmautomation.delhicrest.in}"
S="$(grep '^AI_RECEPTIONIST_SECRET=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
[ "${#S}" -ge 16 ] || { echo "Portal ki .env me AI_RECEPTIONIST_SECRET nahi mila - pehle bash setaisecret.sh chalao."; exit 1; }
[ -f "$D" ] || { echo "Dialer ki .env nahi mili: $D"; exit 1; }
cp -p "$D" "$D.bak-$(date +%Y%m%d-%H%M%S)"
T="$(mktemp)"; trap 'rm -f "$T"' EXIT
grep -v -e '^EMPLOYEE_PORTAL_URL=' -e '^EMPLOYEE_PORTAL_AI_SECRET=' "$D" > "$T" || true
if [ "$1" = "jwt" ]; then
  J="$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  grep -v '^JWT_SECRET=' "$T" > "$T.2" || true; mv "$T.2" "$T"; echo "JWT_SECRET=$J" >> "$T"
  echo "JWT_SECRET naya bana diya (Dialer restart ke baad sab ko dobara login karna hoga)."
fi
printf 'EMPLOYEE_PORTAL_URL=%s\nEMPLOYEE_PORTAL_AI_SECRET=%s\n' "$URL" "$S" >> "$T"
cat "$T" > "$D"   # same file, so owner and permissions stay as they were
echo "Dialer ki .env me portal ka address aur secret likh diya (secret dikhaya nahi)."
echo "Check: $(grep -c '^EMPLOYEE_PORTAL_AI_SECRET=.\{16,\}' "$D") line sahi, placeholder: $(grep -c 'naya secret' "$D")"
