# Registers the "Kino2026 Update" scheduled task on this machine.
#
# Run it once, from an elevated PowerShell, logged in as the Windows account
# that should run the update (the one that ran "npx playwright install
# chromium"; Playwright keeps the browser in that account's profile):
#
#   powershell -ExecutionPolicy Bypass -File .\register-update-task.ps1
#
# The task runs run-update.ps1 from this folder on Monday, Thursday and
# Saturday at 10:00 (the mornings after the Sunday, Wednesday and Friday
# draws), whether or not anyone is logged on. Running the script again
# replaces the existing task.

param(
    [string]$TaskName = 'Kino2026 Update',
    [string]$At = '10:00',
    [string[]]$Days = @('Monday', 'Thursday', 'Saturday')
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'Run this script from an elevated PowerShell (Run as administrator).'
}

$updateScript = Join-Path $PSScriptRoot 'run-update.ps1'
if (-not (Test-Path $updateScript)) {
    throw "run-update.ps1 not found next to this script ($PSScriptRoot)."
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\.bin\ts-node.cmd'))) {
    throw 'Dependencies are not installed. Run "npm ci" in this folder first.'
}

# "Run whether user is logged on or not" requires the account's password;
# Windows stores it with the task. It is not written anywhere else.
$credential = Get-Credential -UserName $identity.Name `
    -Message "Password for $($identity.Name), the account the task will run as"
if (-not $credential) { throw 'No credentials given; task not registered.' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updateScript`"" `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Days -At $At

# StartWhenAvailable runs a missed update as soon as the machine is back on.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings `
    -User $credential.UserName `
    -Password $credential.GetNetworkCredential().Password `
    -RunLevel Limited `
    -Description 'Adds new Kino draws to kino-history.json / kino-history.xml.' `
    -Force | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Registered '$TaskName' for $($credential.UserName)."
Write-Host "Runs: $($Days -join ', ') at $At. Next run: $($info.NextRunTime)"
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Output is appended to: $(Join-Path $PSScriptRoot 'update-latest.log')"
