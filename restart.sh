#!/bin/bash
# Usage: bash restart.sh   (clean restart: old exported variables of this shell are NOT carried over)
set -e
cd "$(dirname "$0")"
pm2 delete crmautomation >/dev/null 2>&1 || true
env -i HOME="$HOME" PATH="$PATH" bash -c 'set -a; . ./.env; set +a; pm2 start server.js --name crmautomation --update-env' >/dev/null
pm2 save >/dev/null
echo "Portal clean restart ho gaya."
