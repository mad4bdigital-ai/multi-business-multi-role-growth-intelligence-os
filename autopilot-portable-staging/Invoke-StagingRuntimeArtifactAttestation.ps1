[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)] [string]$ExpectedSha = "",
    [Parameter(Mandatory = $false)] [string]$OutputDirectory = "",
    [Parameter(Mandatory = $false)] [switch]$DispatchAttestation,
    [Parameter(Mandatory = $false)] [string]$Confirmation = ""
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
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required Staging file is missing: $requiredPath" }
}

Push-Location $repoRoot
try {
    Invoke-NativeChecked -FilePath "git" -Arguments @("fetch", "origin", "main")
    $head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    $originMain = (& git rev-parse origin/main).Trim().ToLowerInvariant()
    $dirty = ((& git status --porcelain | Out-String).Trim())

    if ([string]::IsNullOrWhiteSpace($ExpectedSha)) { $ExpectedSha = $head }
    $ExpectedSha = $ExpectedSha.Trim().ToLowerInvariant()
    if ($ExpectedSha -notmatch "^[0-9a-f]{40}$") { throw "ExpectedSha must be a full lowercase 40-character SHA." }
    if ($branch -ne "main") { throw "Runtime artifact attestation must run from local main; observed $branch." }
    if ($head -ne $originMain -or $ExpectedSha -ne $head) { throw "Runtime artifact attestation requires exact local main == origin/main == ExpectedSha." }
    if (-not [string]::IsNullOrWhiteSpace($dirty)) { throw "Runtime artifact attestation requires a clean Git working tree." }

    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mad4b-staging-runtime-artifact-attestation\" + $ExpectedSha) }
    $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $OutputDirectory) { Remove-Item -LiteralPath $OutputDirectory -Recurse -Force }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

    $compose = @("compose", "-f", $composeBase, "-f", $composeStaging, "-f", $composeWindows, "--env-file", $envFile)
    Invoke-NativeChecked -FilePath "docker" -Arguments ($compose + @("config", "--quiet"))

    $appContainerId = ((& docker @compose ps -q app 2>$null | Out-String).Trim()).ToLowerInvariant()
    if ($appContainerId -notmatch "^[0-9a-f]{64}$") { throw "Staging app container is not running with a full container ID." }
    $appImageDigest = ((& docker inspect --format "{{.Image}}" $appContainerId 2>$null | Out-String).Trim()).ToLowerInvariant()
    if ($appImageDigest -notmatch "^sha256:[0-9a-f]{64}$") { throw "Staging app image identity is not a content-addressed sha256 digest." }

    $containerIdBytes = [Text.Encoding]::UTF8.GetBytes($appContainerId)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $containerIdentitySha256 = ([BitConverter]::ToString($sha.ComputeHash($containerIdBytes))).Replace("-", "").ToLowerInvariant() }
    finally { $sha.Dispose() }

    $buildContextDir = Join-Path $OutputDirectory ".staging-build-context"
    Invoke-NativeChecked -FilePath "node" -Arguments @("http-generic-api/scripts/prepare-staging-build-context.mjs", "--repository-path", ".", "--commit", $ExpectedSha, "--output-dir", $buildContextDir)
    $contextMetaPath = Join-Path $buildContextDir ".staging-build-context.json"
    $contextMeta = Get-Content -LiteralPath $contextMetaPath -Raw | ConvertFrom-Json
    $expectedTree = (& git rev-parse "$ExpectedSha^{tree}").Trim().ToLowerInvariant()
    $contextFileSet = ([string]$contextMeta.context_file_set_sha256).ToLowerInvariant()
    if ($expectedTree -notmatch "^[0-9a-f]{40}$" -or $contextFileSet -notmatch "^[0-9a-f]{64}$") { throw "Canonical Staging build-context identity is invalid." }

    $policy = Get-Content -LiteralPath (Join-Path $repoRoot "edge\activation-gateway\generated\route-policy.staging.json") -Raw | ConvertFrom-Json
    $policyHash = ([string]$policy.content_hash_sha256).ToLowerInvariant()
    if ($policyHash -notmatch "^[0-9a-f]{64}$") { throw "Canonical Staging Gateway policy hash is invalid." }

    $localDeployment = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/deployment-info" -TimeoutSec 20
    $localCommit = [string]$localDeployment.commit_sha
    if ([string]::IsNullOrWhiteSpace($localCommit)) { $localCommit = [string]$localDeployment.commit }
    $localCommit = $localCommit.ToLowerInvariant()
    $localManifest = $localDeployment.deployment
    if ($localCommit -ne $ExpectedSha -or [string]$localDeployment.branch -ne "main" -or ([string]$localDeployment.app_env).ToLowerInvariant() -ne "staging" -or ([string]$localManifest.commit_sha).ToLowerInvariant() -ne $ExpectedSha -or ([string]$localManifest.tree_sha).ToLowerInvariant() -ne $expectedTree -or ([string]$localManifest.context_file_set_sha256).ToLowerInvariant() -ne $contextFileSet -or ([string]$localManifest.image_digest).ToLowerInvariant() -ne $appImageDigest -or $localManifest.secrets_included -ne $false) {
        throw "Local Staging app manifest disagrees with Docker/Git exact identity."
    }

    $gatewayHealth = Invoke-RestMethod -Method Get -Uri "https://activation-dev.mad4b.com/health" -TimeoutSec 20
    if ($gatewayHealth.ok -ne $true -or $gatewayHealth.stale -ne $false -or [string]$gatewayHealth.sourceCommit -ne $ExpectedSha -or [string]$gatewayHealth.workerBuildSha -ne $ExpectedSha -or [string]$gatewayHealth.policyHash -ne $policyHash -or [string]$gatewayHealth.workerBundleSha256 -notmatch "^[0-9a-f]{64}$" -or $gatewayHealth.secretsIncluded -ne $false) {
        throw "Public Activation Gateway identity is not exact-main bound."
    }

    $now = [DateTimeOffset]::UtcNow
    $evidence = [ordered]@{
        contract = "mad4b.staging-runtime-artifact-local-evidence.v1"
        environment = "staging"
        branch = "main"
        deployment_sha = $ExpectedSha
        tree_sha = $expectedTree
        context_file_set_sha256 = $contextFileSet
        app_image_digest = $appImageDigest
        app_container_identity_sha256 = $containerIdentitySha256
        gateway_policy_hash = $policyHash
        gateway_source_commit = [string]$gatewayHealth.sourceCommit
        gateway_worker_build_sha = [string]$gatewayHealth.workerBuildSha
        gateway_worker_bundle_sha256 = [string]$gatewayHealth.workerBundleSha256
        generated_at = $now.ToString("o")
        expires_at = $now.AddMinutes(30).ToString("o")
        local_docker_observation = $true
        local_app_manifest_verified = $true
        public_gateway_verified = $true
        production_mutation_performed = $false
        provider_mutation_performed = $false
        database_mutation_performed = $false
        secrets_included = $false
    }

    $evidencePath = Join-Path $OutputDirectory "runtime-artifact-evidence.json"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine), $utf8NoBom)

    Write-Host "Staging runtime artifact local evidence completed."
    Write-Host ("Exact main SHA: {0}" -f $ExpectedSha)
    Write-Host ("Tree SHA: {0}" -f $expectedTree)
    Write-Host ("Context file set: {0}" -f $contextFileSet)
    Write-Host ("App image digest: {0}" -f $appImageDigest)
    Write-Host ("Evidence file: {0}" -f $evidencePath)
    Write-Host "Production/provider/database mutation: none"

    if ($DispatchAttestation) {
        if ($Confirmation -cne "ATTEST_STAGING_RUNTIME_ARTIFACT") { throw "DispatchAttestation requires -Confirmation ATTEST_STAGING_RUNTIME_ARTIFACT." }
        $gh = Get-Command gh -ErrorAction SilentlyContinue
        if (-not $gh) { throw "GitHub CLI (gh) is required for -DispatchAttestation." }
        $zipPath = Join-Path $OutputDirectory "staging-runtime-artifact-evidence.zip"
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
        Compress-Archive -LiteralPath $evidencePath -DestinationPath $zipPath -CompressionLevel Optimal -Force
        try {
            $bundleBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zipPath))
            if ($bundleBase64.Length -gt 58000) { throw "Runtime artifact evidence bundle exceeds bounded workflow_dispatch transport." }
            $dispatch = @{ ref = "main"; inputs = @{ operation = "attest_runtime_artifact"; expected_sha = $ExpectedSha; confirmation = "ATTEST_STAGING_RUNTIME_ARTIFACT"; runtime_artifact_evidence_zip_base64 = $bundleBase64 } } | ConvertTo-Json -Depth 6 -Compress
            $dispatch | & $gh.Source api --method POST "repos/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/actions/workflows/staging-post-deploy-verification.yml/dispatches" --input - | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "GitHub rejected the exact-main Staging runtime artifact attestation dispatch." }
            Write-Host "Exact-main GitHub runtime artifact attestation dispatched."
        }
        finally { if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force } }
    }
}
finally {
    Pop-Location
}