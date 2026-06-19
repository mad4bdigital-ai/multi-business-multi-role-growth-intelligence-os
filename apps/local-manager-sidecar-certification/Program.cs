using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private static async Task Main()
    {
        var pipeName = $"mad4b-local-manager-cert-{Guid.NewGuid():N}";
        var server = new SidecarRpcServer(pipeName, TimeSpan.FromMilliseconds(250));
        var supervisor = new SidecarLifecycleSupervisor(server, DispatchAsync);
        supervisor.Start();

        await AssertSuccessfulRequestAsync(pipeName);
        await AssertRejectedRequestAsync(pipeName);
        await AssertStalledClientTimeoutAsync(pipeName);
        await AssertSupervisorRestartAsync();

        var beforeShutdown = supervisor.GetStatus();
        Assert(beforeShutdown.Running, "supervisor must be running before shutdown");
        await supervisor.DisposeAsync();
        var afterShutdown = supervisor.GetStatus();
        Assert(!afterShutdown.Running, "supervisor must stop after shutdown");

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            certification = "local_manager_sidecar_named_pipe_live",
            checks = new[] { "success", "rejection", "timeout_recovery", "supervisor_restart", "shutdown" },
            secrets_included = false
        }));
    }

    private static Task<JsonElement> DispatchAsync(
        SidecarRpcRequest request,
        CancellationToken cancellationToken) =>
        Task.FromResult(JsonSerializer.SerializeToElement(new
        {
            operation = request.Operation,
            certified = true,
            secrets_included = false
        }));

    private static async Task AssertSuccessfulRequestAsync(string pipeName)
    {
        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-success",
                operation = "device.getStatus",
                arguments = new { }
            });
        Assert(response.RootElement.GetProperty("ok").GetBoolean(), "read-only request must succeed");
        Assert(response.RootElement.GetProperty("request_id").GetString() == "cert-success", "successful request id must round-trip");
    }

    private static async Task AssertRejectedRequestAsync(string pipeName)
    {
        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-reject",
                operation = "runtime.installModel",
                arguments = new { }
            });
        Assert(!response.RootElement.GetProperty("accepted").GetBoolean(), "mutation without approval must be rejected");
        Assert(
            response.RootElement.GetProperty("error").GetProperty("code").GetString() == "action_specific_approval_required",
            "rejection must preserve the approval error code");
    }

    private static async Task AssertStalledClientTimeoutAsync(string pipeName)
    {
        await using (var stalled = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous))
        {
            await stalled.ConnectAsync(2000);
            await Task.Delay(450);
        }

        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-after-timeout",
                operation = "device.getStatus",
                arguments = new { }
            });
        Assert(response.RootElement.GetProperty("ok").GetBoolean(), "server must accept a request after dropping a stalled client");
    }

    private static async Task AssertSupervisorRestartAsync()
    {
        var faultingServer = new FaultOnceServer();
        await using var supervisor = new SidecarLifecycleSupervisor(faultingServer, DispatchAsync);
        supervisor.Start();

        var timer = Stopwatch.StartNew();
        while (faultingServer.RunCount < 2 && timer.Elapsed < TimeSpan.FromSeconds(5))
        {
            await Task.Delay(50);
        }

        var status = supervisor.GetStatus();
        Assert(status.Running, "supervisor must continue after a server fault");
        Assert(status.RestartCount == 1, "supervisor must record exactly one injected restart");
        Assert(faultingServer.RunCount >= 2, "supervisor must invoke the server again after a fault");
    }

    private static async Task<JsonDocument> SendRequestAsync(string pipeName, object request)
    {
        await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(2000);
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
        await writer.WriteLineAsync(JsonSerializer.Serialize(request));
        var response = await reader.ReadLineAsync();
        Assert(!string.IsNullOrWhiteSpace(response), "sidecar must return a response");
        return JsonDocument.Parse(response!);
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class FaultOnceServer : ISidecarRpcServer
    {
        internal int RunCount { get; private set; }

        public async Task RunAsync(
            Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> dispatch,
            CancellationToken cancellationToken)
        {
            RunCount++;
            if (RunCount == 1) throw new InvalidOperationException("injected certification fault");
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
    }
}
