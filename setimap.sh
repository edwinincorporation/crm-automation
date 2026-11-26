#!/bin/bash
# Usage: bash setimap.sh   (asks the Gmail APP PASSWORD of each care@ mailbox HIDDEN, checks the login, saves it encrypted in the portal DB; then clean restart)
# Enter = skip that mailbox. Nothing is printed or stored in shell history.
set -e
cd "$(dirname "$0")"
touch .env
if ! grep -q '^IMAP_KEY=' .env; then printf 'IMAP_KEY=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)" >> .env; echo "IMAP_KEY .env me bana diya."; fi
set -a; . ./.env; set +a
for M in care@edwinepc.com care@edwincorp.com care@edwin.co.in; do
  read -rsp "$M ka App Password (skip: Enter) : " P; echo
  [ -z "$P" ] && { echo "  - $M chhoda"; continue; }
  if IMAP_PW="$P" node -e "require('./lib/gmail').savePassword('$M', process.env.IMAP_PW).then(m=>{console.log('  OK: '+m+' jud gaya');process.exit(0)}).catch(e=>{console.log('  FAIL: '+e.message);process.exit(1)})"; then :; else echo "  (is mailbox ko dobara chalake try karo)"; fi
  unset P
done
history -c 2>/dev/null || true
bash restart.sh
