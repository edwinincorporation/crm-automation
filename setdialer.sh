#!/bin/bash
# Usage: bash setdialer.sh   (connects the portal to Edwin Dialer's AI Caller; the API key is asked HIDDEN; then clean restart)
set -e
cd "$(dirname "$0")"
read -rp "Dialer ka address [https://dialer.edwin.co.in]: " U; U="$(printf %s "$U" | tr -d '[:space:]')"; U="${U:-https://dialer.edwin.co.in}"
read -rsp "Dialer API key (edk_..., hidden): " K; echo
K="$(printf %s "$K" | tr -d '[:space:]')"
case "$K" in edk_*) ;; *) echo "Ye edk_ se shuru hone wali key nahi lagti - kuch badla nahi."; exit 1;; esac
read -rp "AI caller profile ka number (Dialer -> AI Caller me profile id, jaise 1): " P
P="${P//[^0-9]/}"
case "$P" in ''|*[!0-9]*) echo "Profile id sirf number hona chahiye."; exit 1;; esac
sed -i '/^DIALER_URL=/d;/^DIALER_API_KEY=/d;/^DIALER_AI_PROFILE_ID=/d' .env
printf 'DIALER_URL=%s\nDIALER_API_KEY=%s\nDIALER_AI_PROFILE_ID=%s\n' "$U" "$K" "$P" >> .env
history -c 2>/dev/null || true
bash restart.sh
