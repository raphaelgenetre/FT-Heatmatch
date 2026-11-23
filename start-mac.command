#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org and run this again."
  read -n 1; exit 1
fi
(sleep 1.5; open "http://localhost:3000") &
node server.js
