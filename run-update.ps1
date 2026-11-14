Set-Location -Path $PSScriptRoot

# Node writes UTF-8; without this PowerShell garbles characters such as the
# check mark when it captures the output for the log.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$logPath = Join-Path $PSScriptRoot 'update-latest.log'
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$tsNode = Join-Path $PSScriptRoot 'node_modules\.bin\ts-node.cmd'

"[$timestamp] Starting scheduled Kino update..." | Add-Content -Path $logPath -Encoding utf8
$output = & $tsNode src/update-latest.ts 2>&1 | Out-String
$output | Add-Content -Path $logPath -Encoding utf8

if ($LASTEXITCODE -ne 0) {
    "[$timestamp] ERROR: update-latest.ts exited with code $LASTEXITCODE" | Add-Content -Path $logPath -Encoding utf8
    exit $LASTEXITCODE
}

# Redraw the frequency chart so it includes the draws just added.
$output = & $tsNode src/analyze-kino.ts 2>&1 | Out-String
$output | Add-Content -Path $logPath -Encoding utf8

if ($LASTEXITCODE -ne 0) {
    "[$timestamp] ERROR: analyze-kino.ts exited with code $LASTEXITCODE" | Add-Content -Path $logPath -Encoding utf8
    exit $LASTEXITCODE
}

# Publish the chart to Cloudflare Pages. Skipped until .env holds the credentials.
if (-not (Test-Path (Join-Path $PSScriptRoot '.env'))) {
    "[$timestamp] No .env file; chart not published." | Add-Content -Path $logPath -Encoding utf8
    exit 0
}

$output = & $tsNode src/publish.ts 2>&1 | Out-String
$output | Add-Content -Path $logPath -Encoding utf8

if ($LASTEXITCODE -ne 0) {
    "[$timestamp] ERROR: publish.ts exited with code $LASTEXITCODE" | Add-Content -Path $logPath -Encoding utf8
    exit $LASTEXITCODE
}
