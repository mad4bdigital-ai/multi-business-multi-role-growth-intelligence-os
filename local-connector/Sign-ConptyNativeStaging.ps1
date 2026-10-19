# Staging-only operator-invoked signing. Never invokes a secret or credential
# outside the Windows CurrentUser certificate store. Does not deploy.
param(
  [Parameter(Mandatory=$true)][string]$ConnectorRoot,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$NativeAddonRelativePath,
  [Parameter(Mandatory=$true)][string]$ExpectedPackageJsonSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedUnsignedAddonSha256,
  [Parameter(Mandatory=$true)][string]$SignerThumbprint,
  [Parameter(Mandatory=$true)][string]$TimestampUrl
)
$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "ConPTY signing requires Windows." }
if ($env:CONNECTOR_ENVIRONMENT -ne "staging" -or
    $env:CONNECTOR_DEVICE_MCP_ENVIRONMENT -ne "staging") {
  throw "ConPTY signing is Staging-only and requires real environment bindings."
}
foreach($candidate in @($ExpectedPackageJsonSha256, $ExpectedUnsignedAddonSha256)) {
  if ($candidate -notmatch '^[a-fA-F0-9]{64}$') { throw "Pinned source hashes required." }
}
if ($SignerThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw "Signing certificate thumbprint required." }
if ($TimestampUrl -notmatch '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]*)?$') {
  throw "Timestamp URL must be a pinned HTTPS endpoint."
}
$root = [IO.Path]::GetFullPath($ConnectorRoot)
$package = [IO.Path]::GetFullPath((Join-Path $root 'node_modules/node-pty'))
$manifest = Join-Path $package 'package.json'
if (-not [IO.File]::Exists($manifest)) { throw "node-pty metadata not installed." }
if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash -ine $ExpectedPackageJsonSha256) {
  throw "Pinned node-pty package metadata mismatch."
}
$json = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if ($json.name -cne 'node-pty' -or $json.version -cne '1.1.0') {
  throw "Only the reviewed node-pty@1.1.0 package can be signed."
}
$addon = [IO.Path]::GetFullPath((Join-Path $package $NativeAddonRelativePath))
if (-not $addon.StartsWith($package.TrimEnd('\')+'\', [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($addon) -ne '.node' -or -not [IO.File]::Exists($addon)) {
  throw "Signed addon must be an actual node-pty .node child."
}
if ((Get-FileHash -LiteralPath $addon -Algorithm SHA256).Hash -ine $ExpectedUnsignedAddonSha256) {
  throw "Original node-pty addon hash does not match source approval."
}
$cert = Get-Item -LiteralPath ("Cert:\CurrentUser\My\"+$SignerThumbprint) -ErrorAction Stop
if (-not $cert.HasPrivateKey -or $cert.NotAfter -lt (Get-Date) -or
    $cert.NotBefore -gt (Get-Date) -or
    -not @($cert.EnhancedKeyUsageList | Where-Object {$_.ObjectId -eq '1.3.6.1.5.5.7.3.3'}).Count) {
  throw "Code signing certificate is not eligible."
}
$signTool = (Get-Command signtool.exe -ErrorAction Stop).Source
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "Output directory must not exist." }
New-Item -ItemType Directory -Path $output -Force | Out-Null
$staged = Join-Path $output "node-pty"
try {
  foreach($entry in Get-ChildItem -LiteralPath $package -Recurse -Force) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Source node-pty package contains a reparse point."
    }
  }
  Copy-Item -LiteralPath $package -Destination $staged -Recurse -Force
  $relative = $addon.Substring($package.TrimEnd('\').Length).TrimStart('\')
  $signedAddon = Join-Path $staged $relative
  & $signTool sign /fd SHA256 /sha1 $SignerThumbprint /tr $TimestampUrl /td SHA256 $signedAddon
  if ($LASTEXITCODE -ne 0) { throw "Windows Authenticode signer rejected native addon." }
  $signedHash=(Get-FileHash -LiteralPath $signedAddon -Algorithm SHA256).Hash.ToLowerInvariant()
  $validation = Join-Path $root "Test-ConptyNativePackage.ps1"
  if (-not (Test-Path -LiteralPath $validation -PathType Leaf)) {
    throw "Mandatory native verifier missing."
  }
  # Validator roots its native addon under node_modules/node-pty: the staged
  # folder is isolated, so validate signature and exact signer locally first.
  $sig=Get-AuthenticodeSignature -LiteralPath $signedAddon
  if($sig.Status -ne "Valid" -or $sig.SignerCertificate.Thumbprint -ine $SignerThumbprint) {
    throw "Signed addon failed Authenticode verification."
  }
  $receipt = [ordered]@{
    contract = "mad4b.node-pty-signed-staging-candidate.v1"
    environment = "staging"
    package = "node-pty"
    version = "1.1.0"
    original_addon_sha256 = $ExpectedUnsignedAddonSha256.ToLowerInvariant()
    signed_addon_sha256 = $signedHash
    signer_thumbprint = $SignerThumbprint.ToLowerInvariant()
    timestamp_url = $TimestampUrl
    signed = $true
    installed = $false
    production_activated = $false
    secrets_included = $false
  }
  $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output "manifest.json") -Encoding UTF8
  Write-Host "Governed Staging node-pty native signing candidate prepared; not installed."
} catch {
  Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
