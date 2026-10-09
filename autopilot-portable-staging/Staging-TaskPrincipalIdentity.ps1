# Shared task-principal identity validation. Read-only Windows NTAccount/SID translation.
# A different owner, group, SYSTEM or unresolved SID is never considered equivalent.
function Resolve-StagingTaskPrincipalSid([string]$UserId) {
    if ([string]::IsNullOrWhiteSpace($UserId)) { return "" }
    try {
        if ($UserId -match '^S-\d-\d+(?:-\d+)+$') {
            $sid = [System.Security.Principal.SecurityIdentifier]::new($UserId)
            return $sid.Value
        }
        $account = [System.Security.Principal.NTAccount]::new($UserId)
        return $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        return ""
    }
}
function Test-StagingTaskPrincipalIsCurrentUser([string]$UserId) {
    $actualSid = Resolve-StagingTaskPrincipalSid $UserId
    if ([string]::IsNullOrWhiteSpace($actualSid)) { return $false }
    try {
        $expected = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        return (-not [string]::IsNullOrWhiteSpace($expected) -and $actualSid -eq $expected)
    } catch { return $false }
}
