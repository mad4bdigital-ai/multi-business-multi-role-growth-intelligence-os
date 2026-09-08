[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ExpectedSha = "",

    [Parameter(Mandatory = $true)]
    [string]$RegistrationEvidenceFile,

    [Parameter(Mandatory = $true)]
    [string]$OAuthEvidenceFile,

    [Parameter(Mandatory = $true)]
    [string]$NetworkEvidenceFile,

    [Parameter(Mandatory = $true)]
    [string]$WorkerEvidenceFile,

    [Parameter(Mandatory = $true)]
    [string]$IngressBuildIdentityFile,

    [Parameter(Mandatory = $false)]
    [string]$OutputDirectory = "",

    [Parameter(Mandatory = $false)]
    [switch]$DispatchCountersign,

    [Parameter(Mandatory = $false)]
    [string]$CountersignConfirmation = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ("Native command failed with exit code {0}: {1} {2}" -f $LASTEXITCODE, $FilePath, ($Arguments -join " "))
    }
}

function Resolve-RequiredFile {
    param([Parameter(Mandatory = $true)][string]$PathValue, [Parameter(Mandatory = $true)][string]$Label)
    $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Label must point to one JSON file."
    }
    try {
        $null = Get-Content -LiteralPath $resolved.Path -Raw | ConvertFrom-Json
    }
    catch {
        throw "$Label is not valid JSON: $($resolved.Path)"
    }
    return $resolved.Path
}

function Invoke-CountersignDispatch {
    param(
        [Parameter(Mandatory = $true)][string]$ExactSha,
        [Parameter(Mandatory = $true)][string]$TargetFingerprint,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$Confirmation
    )

    if ($Confirmation -cne "COUNTERSIGN_STAGING_RECOVERY") {
        throw "DispatchCountersign requires -CountersignConfirmation COUNTERSIGN_STAGING_RECOVERY."
    }
    if ($TargetFingerprint -notmatch '^[0-9a-f]{64}$') {
        throw "The canary summary did not contain a valid 64-character target fingerprint."
    }
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        throw "GitHub CLI (gh) is required only for -DispatchCountersign. Generate-only mode remains available without it."
    }

    $requiredNames = @(
        "canary-evidence.json",
        "kernel-plan.json",
        "kernel-approval.json",
        "kernel-ticket.json",
        "kernel-receipt.json",
        "kernel-run.json"
    )
    $bundleFiles = @()
    foreach ($name in $requiredNames) {
        $file = Join-Path $EvidenceDirectory $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Countersign evidence bundle is incomplete: $file"
        }
        $bundleFiles += $file
    }

    $zipPath = Join-Path $EvidenceDirectory "staging-recovery-canary-countersign.zip"
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -LiteralPath $bundleFiles -DestinationPath $zipPath -CompressionLevel Optimal -Force
    try {
        $bundleBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zipPath))
        if ($bundleBase64.Length -gt 58000) {
            throw ("The no-secret canary bundle is too large for bounded workflow_dispatch transport ({0} characters). Use the evidence_run_id artifact fallback." -f $bundleBase64.Length)
        }
        $dispatch = @{
            ref = "main"
            inputs = @{
                operation = "countersign_recovery"
                expected_sha = $ExactSha
                expected_target_fingerprint = $TargetFingerprint
                confirmation = "COUNTERSIGN_STAGING_RECOVERY"
                evidence_bundle_zip_base64 = $bundleBase64
            }
        } | ConvertTo-Json -Depth 6 -Compress

        $dispatch | & $gh.Source api --method POST `
            "repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/workflows/staging-post-deploy-verification.yml/dispatches" `
            --input - | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub rejected the exact-main Staging Recovery countersign dispatch."
        }
    }
    finally {
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$apiRoot = Join-Path $repoRoot "http-generic-api"
$envFile = Join-Path $apiRoot ".env.staging"
$composeBase = Join-Path $apiRoot "docker-compose.yml"
$composeStaging = Join-Path $apiRoot "docker-compose.staging.yml"
$composeWindows = Join-Path $apiRoot "docker-compose.staging.windows-service.yml"

foreach ($requiredPath in @($envFile, $composeBase, $composeStaging, $composeWindows)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required Staging file is missing: $requiredPath"
    }
}

Push-Location $repoRoot
try {
    Invoke-NativeChecked -FilePath "git" -Arguments @("fetch", "origin", "main")
    $head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve local HEAD." }
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve local branch." }
    $originMain = (& git rev-parse origin/main).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve origin/main." }

    if ([string]::IsNullOrWhiteSpace($ExpectedSha)) { $ExpectedSha = $head }
    $ExpectedSha = $ExpectedSha.Trim().ToLowerInvariant()
    if ($ExpectedSha -notmatch '^[0-9a-f]{40}$') { throw "ExpectedSha must be a full 40-character lowercase SHA." }
    if ($branch -ne "main") { throw "Staging certification must run from the local main branch; observed '$branch'." }
    if ($head -ne $originMain) { throw "Local main is not exact origin/main. local=$head origin/main=$originMain" }
    if ($ExpectedSha -ne $head) { throw "ExpectedSha must equal the exact current main HEAD. expected=$ExpectedSha head=$head" }

    $registration = Resolve-RequiredFile -PathValue $RegistrationEvidenceFile -Label "RegistrationEvidenceFile"
    $oauth = Resolve-RequiredFile -PathValue $OAuthEvidenceFile -Label "OAuthEvidenceFile"
    $network = Resolve-RequiredFile -PathValue $NetworkEvidenceFile -Label "NetworkEvidenceFile"
    $worker = Resolve-RequiredFile -PathValue $WorkerEvidenceFile -Label "WorkerEvidenceFile"
    $ingress = Resolve-RequiredFile -PathValue $IngressBuildIdentityFile -Label "IngressBuildIdentityFile"

    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $OutputDirectory = Join-Path $scriptRoot ("recovery-certification-artifacts\" + $ExpectedSha)
    }
    $OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

    $compose = @(
        "compose",
        "-f", $composeBase,
        "-f", $composeStaging,
        "-f", $composeWindows,
        "--env-file", $envFile
    )
    $containerInput = "/app/data/recovery-certification-input/$ExpectedSha"
    $containerOutput = "/app/data/recovery-certification-out/$ExpectedSha"

    Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("exec", "-T", "app", "sh", "-lc", "rm -rf '$containerInput' '$containerOutput' && mkdir -p '$containerInput' '$containerOutput'"))

    $copies = @(
        @($registration, "registration.json"),
        @($oauth, "oauth.json"),
        @($network, "network.json"),
        @($worker, "worker.json"),
        @($ingress, "ingress-build.json")
    )
    foreach ($copy in $copies) {
        Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("cp", $copy[0], ("app:{0}/{1}" -f $containerInput, $copy[1])))
    }

    $execArgs = $compose + @(
        "exec", "-T",
        "-e", ("RECOVERY_STAGING_EXPECTED_SHA={0}" -f $ExpectedSha),
        "-e", ("RECOVERY_STAGING_CANARY_OUTPUT_DIRECTORY={0}" -f $containerOutput),
        "-e", ("RECOVERY_STAGING_REGISTRATION_EVIDENCE_FILE={0}/registration.json" -f $containerInput),
        "-e", ("RECOVERY_STAGING_OAUTH_EVIDENCE_FILE={0}/oauth.json" -f $containerInput),
        "-e", ("RECOVERY_STAGING_NETWORK_EVIDENCE_FILE={0}/network.json" -f $containerInput),
        "-e", ("RECOVERY_STAGING_WORKER_EVIDENCE_FILE={0}/worker.json" -f $containerInput),
        "-e", ("RECOVERY_STAGING_INGRESS_BUILD_IDENTITY_FILE={0}/ingress-build.json" -f $containerInput),
        "app", "node", "scripts/staging-recovery-genuine-canary.mjs"
    )
    Invoke-NativeChecked -FilePath "docker" -Arguments $execArgs

    Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("cp", ("app:{0}/." -f $containerOutput), $OutputDirectory))

    $summaryPath = Join-Path $OutputDirectory "summary.json"
    if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) {
        throw "The canary completed without a summary artifact."
    }
    $summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
    if ($summary.deployment_sha -ne $ExpectedSha -or $summary.production_live_enabled -ne $false -or $summary.secrets_included -ne $false) {
        throw "The generated canary summary failed exact-SHA or safety validation."
    }

    Write-Host "Staging Recovery genuine canary evidence completed."
    Write-Host ("Exact main SHA: {0}" -f $ExpectedSha)
    Write-Host ("Target fingerprint: {0}" -f $summary.target_fingerprint)
    Write-Host ("Evidence directory: {0}" -f $OutputDirectory)
    Write-Host "No Production, provider, or database mutation was requested by this runner."

    if ($DispatchCountersign) {
        Invoke-CountersignDispatch -ExactSha $ExpectedSha -TargetFingerprint ([string]$summary.target_fingerprint) -EvidenceDirectory $OutputDirectory -Confirmation $CountersignConfirmation
        Write-Host "Exact-main GitHub countersign workflow dispatched with the no-secret canary bundle."
    }
}
finally {
    Pop-Location
}
