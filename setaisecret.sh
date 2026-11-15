#!/bin/bash
# Usage: bash setaisecret.sh   (makes a random secret for the Edwin Dialer AI receptionist, saves it in .env, restarts, prints it ONCE)
set -e
cd "$(dirname "$0")"
if grep -q '^AI_RECEPTIONIST_SECRET=' .env; then
  echo "Secret pehle se .env me hai (naya nahi banaya). Dialer me yahi daalna hai:"
  grep '^AI_RECEPTIONIST_SECRET=' .env | cut -d= -f2-
else
  S=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
  echo "AI_RECEPTIONIST_SECRET=$S" >> .env
  echo "Naya secret bana. Dialer ke .env me EMPLOYEE_PORTAL_AI_SECRET= ke aage yahi daalna hai:"
  echo "$S"
  bash restart.sh
fi
