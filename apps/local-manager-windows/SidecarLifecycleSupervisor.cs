using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class SidecarLifecycleSupervisor : IAsyncDisposable
{
    private static readonly TimeSpan RestartDelay = TimeSpan.FromSeconds(2);

    private readonly ISidecarRpcServer _server;
    private readonly Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> _dispatch;
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _runTask;
    private DateTimeOffset? _startedAt;
    private DateTimeOffset? _lastFailureAt;
    private int _restartCount;
    private bool _disposed;

    internal SidecarLifecycleSupervisor(
        ISidecarRpcServer server,
        Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> dispatch)
    {
        _server = server;
        _dispatch = dispatch;
    }

    internal void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_runTask is not null)
        {
            throw new InvalidOperationException("The sidecar lifecycle supervisor is already started.");
        }

        _startedAt = DateTimeOffset.UtcNow;
        _runTask = RunSupervisedAsync(_lifetime.Token);
    }

    internal SidecarLifecycleStatus GetStatus() =>
        new(
            _runTask is not null && !_runTask.IsCompleted,
            _restartCount,
            _startedAt,
            _lastFailureAt,
            false);

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _lifetime.Cancel();
        if (_runTask is not null)
        {
            try
            {
                await _runTask;
            }
            catch (OperationCanceledException)
            {
                // Expected during supervised shutdown.
            }
        }

        _lifetime.Dispose();
    }

    private async Task RunSupervisedAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await _server.RunAsync(_dispatch, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                _restartCount++;
                _lastFailureAt = DateTimeOffset.UtcNow;
                await Task.Delay(RestartDelay, cancellationToken);
            }
        }
    }
}

internal sealed record SidecarLifecycleStatus(
    bool Running,
    int RestartCount,
    DateTimeOffset? StartedAt,
    DateTimeOffset? LastFailureAt,
    bool SecretsIncluded);
