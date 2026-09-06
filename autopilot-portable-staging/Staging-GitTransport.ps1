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

function ConvertTo-StagingProcessArgument([AllowNull()][string]$Argument) {
    if ($null -eq $Argument -or $Argument.Length -eq 0) { return '""' }
    if ($Argument -notmatch '[\s"]') { return $Argument }

    # Windows PowerShell 5.1 runs on .NET Framework where ProcessStartInfo does
    # not expose ArgumentList. Quote according to the Windows argv parsing
    # rules so spaces, quotes, and trailing backslashes remain data, not syntax.
    $quoted = '"'
    $backslashCount = 0
    for ($index = 0; $index -lt $Argument.Length; $index++) {
        $character = $Argument[$index]
        if ($character -eq '\') {
            $backslashCount++
            continue
        }
        if ($character -eq '"') {
            if ($backslashCount -gt 0) { $quoted += (('\' * ($backslashCount * 2)) -join '') }
            $quoted += '\"'
            $backslashCount = 0
            continue
        }
        if ($backslashCount -gt 0) {
            $quoted += (('\' * $backslashCount) -join '')
            $backslashCount = 0
        }
        $quoted += $character
    }
    if ($backslashCount -gt 0) { $quoted += (('\' * ($backslashCount * 2)) -join '') }
    $quoted += '"'
    return $quoted
}

function Join-StagingProcessArguments([string[]]$Arguments) {
    return ((@($Arguments) | ForEach-Object { ConvertTo-StagingProcessArgument ([string]$_) }) -join ' ')
}

function ConvertTo-StagingProcessOutputLines([AllowNull()][string]$Text) {
    if ([string]::IsNullOrWhiteSpace([string]$Text)) { return @() }
    return @(([string]$Text -split "\r?\n") | Where-Object { $_ -ne "" })
}

function Invoke-StagingGitProcess([string[]]$TransportArguments) {
    # Do not use PowerShell native-command redirection here. On the real Windows
    # Staging host, `& git ... 2>&1` produced a structurally valid ls-remote ref
    # while $LASTEXITCODE was observed as 1, even though the same Git invocation
    # outside that capture scope returned 0. Process.ExitCode is the native
    # process contract and is independent from PowerShell stream/error semantics.
    $ErrorActionPreference = "Continue"
    $gitCommand = Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if ($null -eq $gitCommand -or [string]::IsNullOrWhiteSpace([string]$gitCommand.Source)) {
        throw "STAGING_GIT_PROCESS_UNAVAILABLE: git application path could not be resolved"
    }

    $currentLocation = Get-Location
    if ($null -eq $currentLocation -or
        $null -eq $currentLocation.Provider -or
        [string]$currentLocation.Provider.Name -ne "FileSystem" -or
        [string]::IsNullOrWhiteSpace([string]$currentLocation.Path)) {
        throw "STAGING_GIT_WORKING_DIRECTORY_INVALID: current location must be a filesystem path"
    }
    $workingDirectory = [IO.Path]::GetFullPath([string]$currentLocation.Path)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = [string]$gitCommand.Source
    $startInfo.Arguments = Join-StagingProcessArguments $TransportArguments
    $startInfo.WorkingDirectory = $workingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "STAGING_GIT_PROCESS_START_FAILED: git process did not start"
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = [string]$stdoutTask.Result
        $stderr = [string]$stderrTask.Result
        $nativeExitCode = [int]$process.ExitCode
    } finally {
        if ($null -ne $process) { $process.Dispose() }
    }

    $nativeOutput = @()
    $nativeOutput += @(ConvertTo-StagingProcessOutputLines $stdout)
    $nativeOutput += @(ConvertTo-StagingProcessOutputLines $stderr)
    return [pscustomobject]@{
        __staging_git_exit_marker = $true
        exit_code = $nativeExitCode
        output = @($nativeOutput)
    }
}

function Test-StagingGitRetryableFailure([string]$Message) {
    return ([string]$Message -match '(?i)(connection was reset|empty reply from server|recv failure|early eof|unexpected disconnect|connection timed out|the remote end hung up|could not resolve host|failed to connect|connection closed)')
}

function Test-StagingGitReadOnlyExitAnomaly([string[]]$Arguments, [int]$ExitCode, [string]$Message) {
    if ($ExitCode -eq 0 -or $null -eq $Arguments -or $Arguments.Count -eq 0) { return $false }
    if ($Arguments[0] -ne "ls-remote") { return $false }

    # Never accept a non-zero exit as success. A complete ref line only permits
    # a bounded retry; authority advances exclusively after Process.ExitCode=0.
    return ([string]$Message -match '(?m)^[0-9a-fA-F]{40}\s+refs/(heads|tags)/[^\s]+$')
}

function Invoke-StagingGit([string[]]$Arguments) {
    if ($null -eq $Arguments -or $Arguments.Count -eq 0) {
        throw "STAGING_GIT_ARGUMENTS_INVALID: at least one git argument is required"
    }

    $transportArguments = Get-StagingGitTransportArguments $Arguments
    $lastOutput = @()
    $lastExitCode = 1
    for ($attempt = 1; $attempt -le $script:StagingGitMaxAttempts; $attempt++) {
        $capture = Invoke-StagingGitProcess $transportArguments
        if ($null -eq $capture -or $capture.PSObject.Properties.Name -notcontains "__staging_git_exit_marker") {
            throw "STAGING_GIT_OPERATION_FAILED: git $($Arguments -join ' ') did not return an exit marker"
        }
        $lastExitCode = [int]$capture.exit_code
        $lastOutput = @($capture.output)
        if ($lastExitCode -eq 0) {
            return [pscustomobject]@{
                exit_code = 0
                attempts = $attempt
                output = $lastOutput
                transport = "protocol.version=0,http.version=HTTP/1.1"
            }
        }

        $message = (($lastOutput | Out-String).Trim())
        $isRetryable = Test-StagingGitRetryableFailure $message
        $isReadOnlyExitAnomaly = Test-StagingGitReadOnlyExitAnomaly $Arguments $lastExitCode $message
        if ($attempt -ge $script:StagingGitMaxAttempts -or -not ($isRetryable -or $isReadOnlyExitAnomaly)) {
            $safeMessage = $message -replace '(?i)(https?://)([^\s/@]+):([^\s/@]+)@', '$1REDACTED@'
            throw "STAGING_GIT_OPERATION_FAILED: git $($Arguments -join ' ') exit=$lastExitCode attempts=$attempt message=$safeMessage"
        }

        $delay = [Math]::Min($script:StagingGitMaxDelaySeconds, $script:StagingGitInitialDelaySeconds * [Math]::Pow(2, $attempt - 1))
        $retryClass = if ($isReadOnlyExitAnomaly) { "read_only_exit_anomaly" } else { "transport" }
        Write-Host ("STAGING_GIT_RETRY: attempt={0}/{1} delay_seconds={2} retry_class={3} transport=protocol.version=0,http.version=HTTP/1.1" -f $attempt, $script:StagingGitMaxAttempts, $delay, $retryClass)
        Write-Verbose ("STAGING_GIT_RETRY: attempt={0}/{1} delay_seconds={2} retry_class={3} transport=protocol.version=0,http.version=HTTP/1.1" -f $attempt, $script:StagingGitMaxAttempts, $delay, $retryClass)
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
        native_capture = "system_diagnostics_process_exitcode"
        process_shell_execute = $false
        process_stdout_stderr_redirected = $true
        process_working_directory = "current_filesystem_location"
        ls_remote_nonzero_ref_policy = "bounded_retry_never_accept_nonzero"
        retryable_errors = "connection reset,empty reply,recv failure,early eof,unexpected disconnect,timeout,remote hung up,resolve host,failed to connect,connection closed"
    }
}
