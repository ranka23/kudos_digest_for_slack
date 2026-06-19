$ErrorActionPreference = 'SilentlyContinue'
if (Test-Path node_modules\.pnpm\openai@4.104.0_ws@8.21.0\node_modules\openai\index.d.ts) {
  Get-Content node_modules\.pnpm\openai@4.104.0_ws@8.21.0\node_modules\openai\index.d.ts -TotalCount 200
}