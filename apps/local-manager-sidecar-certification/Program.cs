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
        await AssertMutationConsentAsync();

        var beforeShutdown = supervisor.GetStatus();
        Assert(beforeShutdown.Running, "supervisor must be running before shutdown");
        await supervisor.DisposeAsync();
        var afterShutdown = supervisor.GetStatus();
        Assert(!afterShutdown.Running, "supervisor must stop after shutdown");

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            certification = "local_manager_sidecar_named_pipe_live",
            checks = new[] { "success", "rejection", "timeout_recovery", "supervisor_restart", "shutdown", "os_private_mutation_consent", "one_shot", "principal_isolation", "expiry", "argument_binding" },
            secrets_included = false
        }));
    }


    private static async Task AssertMutationConsentAsync()
    {
        var scopeOwner = "windows-sid-a";
        var clock = DateTimeOffset.UtcNow;
        var broker = new SidecarLocalConsentBroker(() => scopeOwner, () => clock);
        var pipe = $"mad4b-consent-cert-{Guid.NewGuid():N}";
        var server = new SidecarRpcServer(pipe, TimeSpan.FromSeconds(2), broker);
        await using var supervisor = new SidecarLifecycleSupervisor(server, DispatchAsync);
        supervisor.Start();

        var request = new
        {
            protocol_version = 1,
            request_id = "mutation-once",
            operation = "runtime.updateSettings",
            arguments = new { settings_update_approved = true, value = "test-only" }
        };
        var typed = JsonSerializer.Deserialize<SidecarRpcRequest>(
            JsonSerializer.Serialize(request), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        using (var blocked = await SendRequestAsync(pipe, request))
            Assert(blocked.RootElement.GetProperty("error").GetProperty("code").GetString() ==
                "os_private_consent_required", "client-provided approval boolean alone must not authorize mutation");
        Assert(!broker.ApproveLocally(typed, false), "unconfirmed local action cannot create consent");
        Assert(broker.ApproveLocally(typed, true), "explicit in-process consent should issue once");

        using (var passed = await SendRequestAsync(pipe, request))
            Assert(passed.RootElement.GetProperty("accepted").GetBoolean(),
                "locally approved exact request must reach dispatcher");
        using (var replay = await SendRequestAsync(pipe, request))
            Assert(replay.RootElement.GetProperty("error").GetProperty("code").GetString() ==
                "os_private_consent_required", "local consent must never be reusable");

        var scoped = new SidecarRpcRequest(1, "cross-principal", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true }));
        Assert(broker.ApproveLocally(scoped, true), "create principal-bound consent");
        scopeOwner = "windows-sid-b";
        Assert(!broker.Consume(scoped), "another OS principal must not consume issued grant");
        scopeOwner = "windows-sid-a";

        var expired = new SidecarRpcRequest(1, "expired", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true }));
        Assert(broker.ApproveLocally(expired, true), "create expiring consent");
        clock = clock.AddSeconds(91);
        Assert(!broker.Consume(expired), "90-second expiry must fail closed");

        var substituted = new SidecarRpcRequest(1, "exact-args", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true, value = "a" }));
        Assert(broker.ApproveLocally(substituted, true), "create argument-bound consent");
        Assert(!broker.Consume(substituted with
        {
            Arguments = JsonSerializer.SerializeToElement(new { settings_update_approved = true, value = "b" })
        }), "argument substitution must fail closed");

        broker.InvalidateAll(); // same behavior required on user logout / UI disposal.
        Assert(!broker.Consume(substituted), "logout/dispose revokes all pending grants");
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
        const int maxAttempts = 3;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await SendRequestOnceAsync(pipeName, request);
            }
            catch (Exception error) when (attempt < maxAttempts && IsTransientPipeFailure(error))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100 * attempt));
            }
        }
    }

    private static async Task<JsonDocument> SendRequestOnceAsync(string pipeName, object request)
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

    private static bool IsTransientPipeFailure(Exception error) =>
        error is IOException or TimeoutException;

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
