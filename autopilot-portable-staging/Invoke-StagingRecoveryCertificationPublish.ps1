[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [long]$RunId,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedSha = "",

    [Parameter(Mandatory = $false)]
    [string]$DownloadDirectory = ""
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
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required to retrieve the independently countersigned certification artifact."
}

Push-Location $repoRoot
try {
    Invoke-NativeChecked -FilePath "git" -Arguments @("fetch", "origin", "main")
    $head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve local HEAD." }
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    $originMain = (& git rev-parse origin/main).Trim().ToLowerInvariant()
    if ($branch -ne "main" -or $head -ne $originMain) {
        throw "Certification publication requires local main to equal exact origin/main. branch=$branch local=$head origin/main=$originMain"
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedSha)) { $ExpectedSha = $head }
    $ExpectedSha = $ExpectedSha.Trim().ToLowerInvariant()
    if ($ExpectedSha -notmatch '^[0-9a-f]{40}$' -or $ExpectedSha -ne $head) {
        throw "ExpectedSha must equal the exact current main HEAD. expected=$ExpectedSha head=$head"
    }

    $runJson = & gh run view $RunId --repo mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os --json headSha,conclusion,event,workflowName,url
    if ($LASTEXITCODE -ne 0) { throw "Unable to read GitHub countersign run $RunId." }
    $run = $runJson | ConvertFrom-Json
    if ([string]$run.workflowName -ne "Staging Post-Deploy Verification" -or [string]$run.event -ne "workflow_dispatch") {
        throw "Run $RunId is not the governed Staging Post-Deploy Verification workflow_dispatch run."
    }
    if ([string]$run.conclusion -ne "success") {
        throw "Run $RunId did not complete successfully; signed certification will not be published."
    }
    if (([string]$run.headSha).ToLowerInvariant() -ne $ExpectedSha) {
        throw "Countersign run SHA does not match exact current main. run=$($run.headSha) expected=$ExpectedSha"
    }

    $cleanup = $false
    if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
        $DownloadDirectory = Join-Path $scriptRoot ("recovery-certification-countersign\" + $RunId)
        $cleanup = $true
    }
    $DownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
    if (Test-Path -LiteralPath $DownloadDirectory) { Remove-Item -LiteralPath $DownloadDirectory -Recurse -Force }
    New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null

    try {
        Invoke-NativeChecked -FilePath "gh" -Arguments @("run", "download", [string]$RunId, "--repo", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", "--dir", $DownloadDirectory)
        $signedFiles = @(Get-ChildItem -LiteralPath $DownloadDirectory -Filter "signed-certification.json" -File -Recurse)
        if ($signedFiles.Count -ne 1) {
            throw "Expected exactly one signed-certification.json in countersign run $RunId; observed $($signedFiles.Count)."
        }
        $signed = Get-Content -LiteralPath $signedFiles[0].FullName -Raw | ConvertFrom-Json
        if ([string]$signed.contract -ne "mad4b.staging-recovery-signed-certification.v1") {
            throw "Downloaded artifact is not a Staging Recovery signed-certification record."
        }
        if (([string]$signed.payload.deployment_sha).ToLowerInvariant() -ne $ExpectedSha) {
            throw "Downloaded signed certification is not bound to exact current main."
        }
        if ([string]$signed.payload.target_fingerprint -notmatch '^[0-9a-f]{64}$') {
            throw "Downloaded signed certification target fingerprint is invalid."
        }
        if ($signed.payload.production_live_enabled -ne $false -or $signed.payload.production_mutation_performed -ne $false -or $signed.secrets_included -ne $false) {
            throw "Downloaded signed certification crossed the bounded no-Production/no-secret contract."
        }

        $compose = @(
            "compose",
            "-f", $composeBase,
            "-f", $composeStaging,
            "-f", $composeWindows,
            "--env-file", $envFile
        )
        $containerRoot = "/app/data/recovery-certification-signed/$ExpectedSha"
        Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("exec", "-T", "app", "sh", "-lc", "rm -rf '$containerRoot' && mkdir -p '$containerRoot'"))
        Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("cp", $signedFiles[0].FullName, ("app:{0}/signed-certification.json" -f $containerRoot)))
        Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @(
            "exec", "-T",
            "-e", ("RECOVERY_STAGING_EXPECTED_SHA={0}" -f $ExpectedSha),
            "-e", ("RECOVERY_STAGING_SIGNED_CERTIFICATION_FILE={0}/signed-certification.json" -f $containerRoot),
            "app", "node", "scripts/staging-recovery-publish-countersign.mjs"
        ))

        Write-Host "Signed Staging Recovery certification was independently verified again and published to the durable local readiness store."
        Write-Host ("Exact main SHA: {0}" -f $ExpectedSha)
        Write-Host ("Target fingerprint: {0}" -f $signed.payload.target_fingerprint)
        Write-Host ("Countersign run: {0}" -f $RunId)
        Write-Host "No Production, provider, or target-database mutation was performed by publication."
    }
    finally {
        if ($cleanup -and (Test-Path -LiteralPath $DownloadDirectory)) {
            Remove-Item -LiteralPath $DownloadDirectory -Recurse -Force
        }
    }
}
finally {
    Pop-Location
}
