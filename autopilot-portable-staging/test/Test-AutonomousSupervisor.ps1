[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$supervisor = Join-Path $root "Staging-AutonomousSupervisor.ps1"
$install = Join-Path $root "Install-AutoDeployTask.ps1"
$uninstall = Join-Path $root "Uninstall-AutoDeployTask.ps1"
$additiveInstall = Join-Path $root "Install-AutonomousSupervisorTask.ps1"
$policyFile = Join-Path $root "autonomous-operations-policy.json"
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "AUTONOMOUS_SUPERVISOR_TEST_FAILED: $Message" }
}
foreach ($source in @($supervisor, $install, $uninstall, $additiveInstall)) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
    Assert (@($errors).Count -eq 0) "PowerShell parser failed for $source : $($errors | Out-String)"
}
$Policy = Get-Content -Raw -LiteralPath $policyFile | ConvertFrom-Json
Assert ($Policy.contract -eq "mad4b.staging-autonomous-operations.v1") "wrong contract"
Assert ($Policy.environment -eq "staging") "wrong environment"
Assert ($Policy.recovery.max_starts_per_24_hours -ge 1 -and $Policy.recovery.max_starts_per_24_hours -le 3) "unsafe retry budget"
Assert ($Policy.recovery.cooldown_seconds -ge 300) "unsafe cooldown"
foreach ($name in @("production_mutation", "database_mutation", "migration_apply", "provider_mutation", "cloudflare_dns_mutation", "secret_logging")) {
    Assert ($Policy.safety.$name -eq $false) "unsafe policy $name"
}
# Exercise the actual function bodies without starting any task or live services.
$sourceTokens = $null
$sourceErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($supervisor, [ref]$sourceTokens, [ref]$sourceErrors)
Assert (@($sourceErrors).Count -eq 0) "Unexpected parser error"
$funcs = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false))
foreach ($name in @("Get-Prop", "Read-Evidence", "Get-Time", "Test-WatcherTaskIdentity", "Get-RecentWatcherEvidence", "Get-ActiveLease", "Get-Acceptance", "Recover-Watcher")) {
    $sourceFn = $funcs | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    Assert ($null -ne $sourceFn) "missing function $name"
    Invoke-Expression $sourceFn.Extent.Text
}
$fixtureRoot = Join-Path $env:TEMP ("mad4b-autonomy-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    $RepositoryPath = $fixtureRoot
    $scriptRoot = $PSScriptRoot
    $expectedScript = Join-Path $PSScriptRoot "Auto-Deploy-Staging.ps1"
    $expectedPrincipal = "$env:USERDOMAIN\$env:USERNAME"
    $operationsPath = Join-Path $fixtureRoot "operations.jsonl"
    $healthPath = Join-Path $fixtureRoot "health.json"
    $deployPath = Join-Path $fixtureRoot "deploy.json"
    $runtimePath = Join-Path $fixtureRoot "runtime.json"
    $leasePath = Join-Path $fixtureRoot "lease.json"
    $statePath = Join-Path $fixtureRoot "recovery-state.json"
    $DryRun = $true
    $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$expectedScript`" -RepositoryPath `"$RepositoryPath`" -Watch -PollSeconds 300 -BuildMode Smart -TunnelMode windows_service"
    $action = [pscustomobject]@{ Execute = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"; Arguments = $arguments; WorkingDirectory = $PSScriptRoot }
    $task = [pscustomobject]@{ Actions = @($action); Principal = [pscustomobject]@{ UserId = $expectedPrincipal }; State = "Running"; Settings = [pscustomobject]@{ Enabled = $true } }
    Assert (Test-WatcherTaskIdentity $task) "valid task rejected"
    $action.WorkingDirectory = $RepositoryPath
    Assert (Test-WatcherTaskIdentity $task) "valid repo-root task rejected"
    $action.WorkingDirectory = Join-Path $env:TEMP "alien-workdir"
    Assert (-not (Test-WatcherTaskIdentity $task)) "foreign workdir accepted"
    $action.WorkingDirectory = $PSScriptRoot
    $action.Arguments += " -EncodedCommand Zg=="
    Assert (-not (Test-WatcherTaskIdentity $task)) "extra command accepted"
    $action.Arguments = $arguments -replace '-Watch', '-ValidateOnly'
    Assert (-not (Test-WatcherTaskIdentity $task)) "non-watch task accepted"
    $action.Arguments = $arguments
    $task.Principal.UserId = "OTHER\SERVICE"
    Assert (-not (Test-WatcherTaskIdentity $task)) "foreign principal accepted"
    $task.Principal.UserId = $expectedPrincipal

    $now = [DateTimeOffset]::UtcNow
    $start = $now.AddMinutes(-11)
    $events = @()
    foreach ($i in @(0, 1)) {
        $t = $now.AddSeconds(-500 + 300 * $i)
        $events += (@{ component = "auto-deploy"; stage = "poll"; timestamp = $t.ToString("o"); run_id = "same-run"; level = "info" } | ConvertTo-Json -Compress)
        $events += (@{ component = "auto-deploy"; stage = "sleep"; timestamp = $t.AddSeconds(5).ToString("o"); run_id = "same-run"; level = "info" } | ConvertTo-Json -Compress)
    }
    [IO.File]::WriteAllLines($operationsPath, [string[]]$events)
    $sha = "a" * 40
    @{ ok = $true; effective_ok = $true; timestamp = $now.ToString("o"); lifecycle = @{ grace_active = $false } } | ConvertTo-Json -Depth 5 | Set-Content $healthPath
    @{ desired_commit = $sha; deployed_commit = $sha; certified_commit = $sha; ref = "main"; overall = "ready"; certification_status = "ready"; certification_ready = $true; production_deploy = $false; database_mutated = $false; migration_applied = $false; ruleset_mutation = $false } | ConvertTo-Json | Set-Content $deployPath
    @{ commit = $sha; certification_status = "ready"; certification_ready = $true } | ConvertTo-Json | Set-Content $runtimePath
    $info = [pscustomobject]@{ LastRunTime = $start.LocalDateTime }
    $decision = Get-Acceptance $now $task $info
    Assert ($decision.accepted -eq $true) "valid two-cycle acceptance was rejected: $($decision.reasons -join ',')"
    Assert ($decision.full_runtime_integrity_attested -eq $false) "unsafe integrity attestation"
    $task.State = "Ready"
    $decision = Get-Acceptance $now $task $info
    Assert ($decision.accepted -eq $false) "stopped watcher was accepted"
    Assert ((Recover-Watcher $now $task $decision) -eq "dry_run") "dry-run recovery not selected"
    $task.State = "Running"
    $stale = Get-Acceptance ($now.AddSeconds(1200)) $task $info
    Assert ($stale.accepted -eq $false) "stale watcher was accepted"
    $other = "b" * 40
    $deployment = Get-Content -Raw $deployPath | ConvertFrom-Json
    $deployment.certified_commit = $other
    $deployment | ConvertTo-Json | Set-Content $deployPath
    $drift = Get-Acceptance $now $task $info
    Assert ($drift.accepted -eq $false) "SHA drift was accepted"
    $deployment.certified_commit = $sha
    $deployment | ConvertTo-Json | Set-Content $deployPath
    @{ contract = "mad4b.staging-deployment-lease.v1"; expires_at = $now.AddMinutes(10).ToString("o") } |
        ConvertTo-Json | Set-Content $leasePath
    $leased = Get-Acceptance $now $task $info
    Assert ($leased.accepted -eq $false) "active deployment lease was accepted"
    $task.State = "Ready"
    Assert ((Recover-Watcher $now $task $leased) -eq "blocked_by_authority") "recovery ignored active lease"
    Remove-Item $leasePath -Force
    @{ contract = "mad4b.staging-autonomous-recovery-state.v1"; attempts_utc = @($now.AddMinutes(-3).ToString("o")) } |
        ConvertTo-Json | Set-Content $statePath
    $unleased = Get-Acceptance $now $task $info
    Assert ((Recover-Watcher $now $task $unleased) -eq "cooldown") "recovery cooldown bypass"
    Write-Output "AUTONOMOUS_SUPERVISOR_STATIC_AND_FIXTURE_TESTS: PASS"
} finally {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
