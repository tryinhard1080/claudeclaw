#!/bin/bash
set -e
cd "$(dirname "$0")/.."

npm run build
mkdir -p logs

npx pm2 start ecosystem.config.cjs
npx pm2 save

echo "ClaudeClaw running headlessly. Use 'npx pm2 status' to check."
