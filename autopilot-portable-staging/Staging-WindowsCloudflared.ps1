Set-StrictMode -Version Latest

function Convert-StagingSecureStringToPlain([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-StagingCloudflaredBinary {
    $command = Get-Command cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source) -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
    foreach ($candidate in @(
        'C:\Program Files (x86)\cloudflared\cloudflared.exe',
        'C:\Program Files\cloudflared\cloudflared.exe'
    )) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'cloudflared.exe is not installed in a supported Windows location.'
}

function Protect-StagingCloudflaredFile([string]$Path) {
    & icacls.exe $Path '/inheritance:r' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to disable inherited ACLs for $Path" }
    & icacls.exe $Path '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to apply SYSTEM/Administrators ACLs for $Path" }
}

function Ensure-StagingCloudflaredTokenFile([string]$EnvFile) {
    $tokenFile = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_TOKEN_FILE'
    if ([string]::IsNullOrWhiteSpace($tokenFile)) {
        $tokenFile = 'C:\ProgramData\cloudflared\tunnel-token.txt'
        Set-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_TOKEN_FILE' $tokenFile
    }
    $directory = Split-Path -Parent $tokenFile
    New-Item -ItemType Directory -Force -Path $directory | Out-Null

    $hasToken = (Test-Path -LiteralPath $tokenFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content -Raw -LiteralPath $tokenFile -ErrorAction SilentlyContinue))
    if (-not $hasToken) {
        $token = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_TOKEN'
        if ([string]::IsNullOrWhiteSpace($token)) {
            Write-Host 'One-time secure input: provide the dedicated Staging Cloudflare Tunnel token for the Windows service token-file.'
            $secure = Read-Host 'Staging Tunnel token' -AsSecureString
            $token = Convert-StagingSecureStringToPlain $secure
        }
        if ([string]::IsNullOrWhiteSpace($token)) { throw 'Windows Staging tunnel requires a non-empty token file.' }
        $encoding = New-Object Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($tokenFile, $token.Trim(), $encoding)
    }
    Protect-StagingCloudflaredFile $tokenFile
    return $tokenFile
}

function Ensure-StagingCloudflaredWindowsService([string]$EnvFile) {
    $exe = Get-StagingCloudflaredBinary
    $tokenFile = Ensure-StagingCloudflaredTokenFile $EnvFile
    $logFile = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_LOG_FILE'
    if ([string]::IsNullOrWhiteSpace($logFile)) {
        $logFile = 'C:\ProgramData\cloudflared\staging-cloudflared.log'
        Set-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_LOG_FILE' $logFile
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null
    if (-not (Test-Path -LiteralPath $logFile)) { New-Item -ItemType File -Path $logFile -Force | Out-Null }
    Protect-StagingCloudflaredFile $logFile

    $metrics = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_METRICS'
    if ([string]::IsNullOrWhiteSpace($metrics)) {
        $metrics = '127.0.0.1:49312'
        Set-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_METRICS' $metrics
    }
    if ($metrics -notmatch '^127\.0\.0\.1:\d{2,5}$') { throw 'Windows cloudflared metrics listener must remain loopback-only.' }

    $binPath = '"' + $exe + '" tunnel --no-autoupdate --loglevel info --logfile "' + $logFile + '" --metrics ' + $metrics + ' run --token-file "' + $tokenFile + '"'
    $service = Get-Service Cloudflared -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne 'Stopped') {
        Stop-Service Cloudflared -Force -ErrorAction Stop
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(20))
    }

    # Remote-origin proof must belong to this exact service start. Stale log lines
    # from an earlier app:8080 configuration must never contaminate the readback.
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($logFile, '', $encoding)
    Protect-StagingCloudflaredFile $logFile

    if ($null -eq $service) {
        & sc.exe create Cloudflared "binPath= $binPath" 'start= auto' 'obj= LocalSystem' 'DisplayName= Cloudflared Staging Tunnel' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the Cloudflared Windows service.' }
    } else {
        # Windows PowerShell 5.1 native argument quoting can corrupt an sc.exe config
        # binPath that itself contains quoted paths. Reconcile the existing service
        # through Win32_Service.Change so PathName is passed as structured CIM data.
        $serviceConfig = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction Stop
        $change = Invoke-CimMethod -InputObject $serviceConfig -MethodName Change -Arguments @{
            PathName = $binPath
            StartMode = 'Automatic'
            StartName = 'LocalSystem'
        } -ErrorAction Stop
        $changeCode = [int]$change.ReturnValue
        if ($changeCode -ne 0) {
            throw "Unable to reconcile the Cloudflared Windows service configuration: Win32_Service.Change returned $changeCode."
        }
    }
    & sc.exe failure Cloudflared 'reset= 86400' 'actions= restart/5000/restart/15000/none/0' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to configure bounded Cloudflared Windows service recovery.' }

    Start-Service Cloudflared -ErrorAction Stop
    Start-Sleep -Seconds 2
    $readback = Get-CimInstance Win32_Service -Filter "Name='Cloudflared'" -ErrorAction Stop
    $pathName = [string]$readback.PathName
    if ($pathName -match '(?i)(?:^|\s)--token(?:\s|=)') { throw 'Cloudflared service readback still embeds an inline token.' }
    if ($pathName -notmatch '(?i)--token-file' -or $pathName -notmatch [regex]::Escape($tokenFile)) { throw 'Cloudflared service readback is not bound to the canonical token-file.' }
    if ($pathName -notmatch [regex]::Escape($logFile)) { throw 'Cloudflared service readback is not bound to the canonical Staging logfile.' }
    if ([string]$readback.StartName -notin @('LocalSystem', 'NT AUTHORITY\LocalSystem')) { throw 'Cloudflared Windows service is not bound to LocalSystem after reconciliation.' }
    if ($readback.StartMode -ne 'Auto') { throw 'Cloudflared Windows service is not configured for automatic start after reconciliation.' }
    if ($readback.State -ne 'Running' -or [int]$readback.ProcessId -le 0) { throw 'Cloudflared Windows service did not reach Running after reconciliation.' }

    return [pscustomobject]@{
        service_reconciled = $true
        service_name = 'Cloudflared'
        process_id = [int]$readback.ProcessId
        token_transport = 'token_file'
        token_file = $tokenFile
        log_file = $logFile
        metrics = $metrics
        service_account = [string]$readback.StartName
        service_start_mode = [string]$readback.StartMode
        reconciliation_transport = if ($null -eq $service) { 'sc_create' } else { 'win32_service_change' }
        inline_token = $false
        fresh_log_evidence = $true
        secrets_included = $false
    }
}

function Get-StagingCloudflaredRuntimeLog([string]$Mode, [string]$EnvFile, [string]$ContainerId = '') {
    if ($Mode -eq 'windows_service') {
        $logFile = Get-StagingEnvValue $EnvFile 'CLOUDFLARE_TUNNEL_LOG_FILE'
        if ([string]::IsNullOrWhiteSpace($logFile) -or -not (Test-Path -LiteralPath $logFile)) { return '' }
        return (Get-Content -LiteralPath $logFile -Tail 500 -ErrorAction SilentlyContinue | Out-String)
    }
    if ($Mode -eq 'docker_sidecar' -and -not [string]::IsNullOrWhiteSpace($ContainerId)) {
        return (& docker logs --tail 500 $ContainerId 2>&1 | Out-String)
    }
    return ''
}

function Assert-StagingRemoteManagedOriginEvidence([string]$Mode, [string]$EnvFile, [string]$ContainerId = '') {
    $expected = 'http://127.0.0.1:8080'
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        $logText = Get-StagingCloudflaredRuntimeLog $Mode $EnvFile $ContainerId
        if ($logText -match 'http://app:8080') {
            throw 'REMOTE_MANAGED_TUNNEL_ORIGIN_MISMATCH: Cloudflare still advertises http://app:8080; expected http://127.0.0.1:8080. No Cloudflare mutation was performed.'
        }
        $devReady = $logText -match 'dev\.mad4b\.com[\s\S]{0,320}http://127\.0\.0\.1:8080'
        $mcpReady = $logText -match 'mcp-dev\.mad4b\.com[\s\S]{0,320}http://127\.0\.0\.1:8080'
        if ($devReady -and $mcpReady) {
            return [pscustomobject]@{
                remote_managed_origin = $expected
                dev_origin_verified = $true
                mcp_origin_verified = $true
                evidence_source = if ($Mode -eq 'windows_service') { 'windows_cloudflared_log' } else { 'docker_cloudflared_log' }
                cloudflare_mutation = $false
                secrets_included = $false
            }
        }
        Start-Sleep -Seconds 2
    }
    throw 'REMOTE_MANAGED_TUNNEL_ORIGIN_EVIDENCE_MISSING: cloudflared did not expose evidence binding both Staging hostnames to http://127.0.0.1:8080.'
}
