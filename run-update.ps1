Set-Location -Path $PSScriptRoot

$logPath = Join-Path $PSScriptRoot 'update-latest.log'
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$tsNode = Join-Path $PSScriptRoot 'node_modules\.bin\ts-node.cmd'

"[$timestamp] Starting scheduled Kino update..." | Add-Content -Path $logPath -Encoding utf8
$output = & $tsNode src/update-latest.ts 2>&1 | Out-String
$output | Add-Content -Path $logPath -Encoding utf8

if ($LASTEXITCODE -ne 0) {
    "[$timestamp] ERROR: update-latest.ts exited with code $LASTEXITCODE" | Add-Content -Path $logPath -Encoding utf8
}
