#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
pkg install -y nodejs chromium
if [ ! -f .env ]; then cp .env.example .env; fi
npm install
npm run setup-auth
