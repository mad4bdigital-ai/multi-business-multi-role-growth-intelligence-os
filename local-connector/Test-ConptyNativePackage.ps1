# Read-only Staging supply-chain gate for the optional Windows node-pty binary.
# Never downloads, installs, signs or trusts a package based on a caller boolean.
param(
    [Parameter(Mandatory=$true)][string]$ConnectorRoot,
    [Parameter(Mandatory=$true)][string]$NativeAddonPath,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][string]$AllowedSignerThumbprint
)
$ErrorActionPreference = "Stop"
if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
    throw "ConPTY verification requires Windows."
}
if ($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
    $AllowedSignerThumbprint -notmatch '^[A-Fa-f0-9]{40}$') {
    throw "ConPTY source digest and signer thumbprint are required."
}
$root = [IO.Path]::GetFullPath($ConnectorRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$allowed = Join-Path $root "node_modules\node-pty"
$canonicalRoot = [IO.Path]::GetFullPath($allowed).TrimEnd([IO.Path]::DirectorySeparatorChar)
$full = [IO.Path]::GetFullPath($NativeAddonPath)
if (-not $full.StartsWith($canonicalRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($full) -ne ".node" -or
    -not [IO.File]::Exists($full)) {
    throw "ConPTY native addon must be a local node-pty binary inside the approved connector root."
}
$nodePty = Get-Item -LiteralPath $full -Force
if (($nodePty.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "ConPTY reparse-point binaries are denied."
}
$packageFile = Join-Path $canonicalRoot "package.json"
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "ConPTY package metadata is missing."
}
$manifest = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
if ($manifest.name -cne "node-pty" -or $manifest.version -cne "1.1.0") {
    throw "ConPTY package must match the exact approved node-pty@1.1.0 version."
}
$actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
if ($actual -ine $ExpectedSha256) { throw "ConPTY native binary hash mismatch." }
$signature = Get-AuthenticodeSignature -LiteralPath $full
if ($signature.Status -ne "Valid" -or
    $signature.SignerCertificate.Thumbprint -ine $AllowedSignerThumbprint) {
    throw "ConPTY binary is not signed by the approved code-signing identity."
}
[pscustomobject]@{
    contract = "mad4b.conpty-native-supply-chain-readiness.v1"
    ok = $true
    package = "node-pty"
    version = "1.1.0"
    sha256 = $actual.ToLowerInvariant()
    authenticode_verified = $true
    signer_thumbprint_verified = $true
    environment = "staging"
    install_performed = $false
    production_activated = $false
    secrets_included = $false
} | ConvertTo-Json -Compress
