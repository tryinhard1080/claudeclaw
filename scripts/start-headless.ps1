Set-Location $PSScriptRoot\..
npm run build
New-Item -ItemType Directory -Force -Path logs | Out-Null
npx pm2 start ecosystem.config.cjs
npx pm2 save
Write-Host "ClaudeClaw running headlessly. Use 'npx pm2 status' to check."
