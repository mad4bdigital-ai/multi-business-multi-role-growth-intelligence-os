Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:StagingGitMaxAttempts = 4
$script:StagingGitInitialDelaySeconds = 2
$script:StagingGitMaxDelaySeconds = 15

function Get-StagingGitTransportArguments([string[]]$Arguments) {
    $commandArguments = @($Arguments)
    if ($commandArguments.Count -gt 0 -and $commandArguments[0] -eq "fetch") {
        $tail = @()
        if ($commandArguments.Count -gt 1) {
            $tail = @($commandArguments[1..($commandArguments.Count - 1)])
        }
        $fetchOptions = @()
        if ($tail -notcontains "--no-auto-maintenance") { $fetchOptions += "--no-auto-maintenance" }
        if ($tail -notcontains "--no-recurse-submodules") { $fetchOptions += "--no-recurse-submodules" }
        $commandArguments = @("fetch") + $fetchOptions + $tail
    }
    return @("-c", "protocol.version=0", "-c", "http.version=HTTP/1.1") + $commandArguments
}

function Test-StagingGitRetryableFailure([string]$Message) {
    return ([string]$Message -match '(?i)(connection was reset|empty reply from server|recv failure|early eof|unexpected disconnect|connection timed out|the remote end hung up|could not resolve host|failed to connect|connection closed)')
}

function Invoke-StagingGit([string[]]$Arguments) {
    if ($null -eq $Arguments -or $Arguments.Count -eq 0) {
        throw "STAGING_GIT_ARGUMENTS_INVALID: at least one git argument is required"
    }

    $transportArguments = Get-StagingGitTransportArguments $Arguments
    $lastOutput = @()
    $lastExitCode = 1
    for ($attempt = 1; $attempt -le $script:StagingGitMaxAttempts; $attempt++) {
        $invocationOutput = @(& {
            # Windows PowerShell 5.1 can promote native stderr to a terminating
            # NativeCommandError when the caller uses ErrorActionPreference=Stop.
            # Git writes progress/protocol diagnostics to stderr even on success;
            # capture that stream without weakening the exit-code gate.
            $ErrorActionPreference = "Continue"
            & git @transportArguments 2>&1
            [pscustomobject]@{ __staging_git_exit_marker = $true; exit_code = $LASTEXITCODE }
        })
        $marker = $invocationOutput | Select-Object -Last 1
        if ($null -eq $marker -or $marker.PSObject.Properties.Name -notcontains "__staging_git_exit_marker") {
            throw "STAGING_GIT_OPERATION_FAILED: git $($Arguments -join ' ') did not return an exit marker"
        }
        $lastExitCode = [int]$marker.exit_code
        if ($invocationOutput.Count -gt 1) {
            $lastOutput = @($invocationOutput[0..($invocationOutput.Count - 2)] | ForEach-Object { [string]$_ })
        } else {
            $lastOutput = @()
        }
        if ($lastExitCode -eq 0) {
            return [pscustomobject]@{
                exit_code = 0
                attempts = $attempt
                output = $lastOutput
                transport = "protocol.version=0,http.version=HTTP/1.1"
            }
        }

        $message = (($lastOutput | Out-String).Trim())
        if ($attempt -ge $script:StagingGitMaxAttempts -or -not (Test-StagingGitRetryableFailure $message)) {
            $safeMessage = $message -replace '(?i)(https?://)([^\s/@]+):([^\s/@]+)@', '$1REDACTED@'
            throw "STAGING_GIT_OPERATION_FAILED: git $($Arguments -join ' ') exit=$lastExitCode attempts=$attempt message=$safeMessage"
        }

        $delay = [Math]::Min($script:StagingGitMaxDelaySeconds, $script:StagingGitInitialDelaySeconds * [Math]::Pow(2, $attempt - 1))
        Write-Host ("STAGING_GIT_RETRY: attempt={0}/{1} delay_seconds={2} transport=protocol.version=0,http.version=HTTP/1.1" -f $attempt, $script:StagingGitMaxAttempts, $delay)
        Write-Verbose ("STAGING_GIT_RETRY: attempt={0}/{1} delay_seconds={2} transport=protocol.version=0,http.version=HTTP/1.1" -f $attempt, $script:StagingGitMaxAttempts, $delay)
        Start-Sleep -Seconds ([int]$delay)
    }

    throw "STAGING_GIT_OPERATION_FAILED: git $($Arguments -join ' ') exit=$lastExitCode attempts=$script:StagingGitMaxAttempts"
}

function Get-StagingGitText([string[]]$Arguments) {
    $result = Invoke-StagingGit $Arguments
    $readable = @($result.output | Where-Object {
        $_ -notmatch '^(From |remote: |warning: |hint: )'
    })
    return (($readable | Out-String).Trim())
}

function Test-StagingGitTransportContract {
    return [pscustomobject]@{
        max_attempts = $script:StagingGitMaxAttempts
        initial_delay_seconds = $script:StagingGitInitialDelaySeconds
        max_delay_seconds = $script:StagingGitMaxDelaySeconds
        transport = "protocol.version=0,http.version=HTTP/1.1"
        fetch_isolation = "--no-auto-maintenance,--no-recurse-submodules"
        retryable_errors = "connection reset,empty reply,recv failure,early eof,unexpected disconnect,timeout,remote hung up,resolve host,failed to connect,connection closed"
    }
}
