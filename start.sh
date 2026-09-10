#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
test -f .env || { echo "Missing .env. Copy .env.example to .env first."; exit 1; }
exec npm start
