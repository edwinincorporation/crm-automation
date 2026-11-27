#!/bin/bash
# Usage: bash setimap.sh   (asks the password of each care@ mailbox HIDDEN (Gmail: App Password; edwincorp: its normal mail password), checks the login, saves it encrypted in the portal DB; then clean restart)
# Enter = skip that mailbox. Nothing is printed or stored in shell history.
set -e
cd "$(dirname "$0")"
touch .env
if ! grep -q '^IMAP_KEY=' .env; then printf 'IMAP_KEY=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)" >> .env; echo "IMAP_KEY .env me bana diya."; fi
set -a; . ./.env; set +a
for M in care@edwinepc.com care@edwincorp.com care@edwin.co.in; do
  if [ "$M" = "care@edwincorp.com" ]; then
    read -rsp "$M ka MAIL PASSWORD (Gmail nahi, hosting wala) (skip: Enter) : " P; echo
    [ -z "$P" ] && { echo "  - $M chhoda"; continue; }
    read -rp "  IMAP server (Enter = automatic try: imap.hostinger.com, mail.edwincorp.com, edwincorp.com) : " H
    OKK=0
    for HH in ${H:-imap.hostinger.com mail.edwincorp.com edwincorp.com}; do
      echo "  try: $HH"
      if IMAP_PW="$P" node -e "require('./lib/gmail').savePassword('$M', process.env.IMAP_PW, 'setimap', '$HH').then(m=>{console.log('  OK: '+m+' jud gaya ('+'$HH'+')');process.exit(0)}).catch(e=>{console.log('  FAIL: '+e.message);process.exit(1)})"; then OKK=1; break; fi
    done
    [ "$OKK" = 1 ] || echo "  (kisi server se login nahi hua - hosting panel me Email > IMAP server naam dekho)"
  else
    read -rsp "$M ka App Password (skip: Enter) : " P; echo
    [ -z "$P" ] && { echo "  - $M chhoda"; continue; }
    if IMAP_PW="$P" node -e "require('./lib/gmail').savePassword('$M', process.env.IMAP_PW).then(m=>{console.log('  OK: '+m+' jud gaya');process.exit(0)}).catch(e=>{console.log('  FAIL: '+e.message);process.exit(1)})"; then :; else echo "  (is mailbox ko dobara chalake try karo)"; fi
  fi
  unset P
done
history -c 2>/dev/null || true
bash restart.sh
