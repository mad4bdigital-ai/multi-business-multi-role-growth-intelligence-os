using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace Mad4B.LocalManager.Windows;

internal sealed record AutopilotFailure(string Code, string Message, string Diagnostic, bool Retryable);

internal static class AutopilotNetworkRecovery
{
    internal static async Task<AutopilotFailure> ClassifyAsync(
        string baseUrl,
        Exception exception,
        CancellationToken cancellationToken = default)
    {
        var root = exception.GetBaseException();
        if (!IsDnsFailure(root)) return ClassifyException(root);

        var resolvedOnProbe = await CanResolveHostAsync(baseUrl, cancellationToken);
        return resolvedOnProbe
            ? new AutopilotFailure(
                "dns_recovered",
                "dns_recovered: auth.mad4b.com resolved again; desktop command polling will retry automatically.",
                "The original request failed during name resolution, but the same-cycle DNS probe succeeded.",
                true)
            : new AutopilotFailure(
                "dns_unresolved",
                "dns_unresolved: Windows cannot resolve auth.mad4b.com. Local Manager paused polling and will retry with backoff.",
                "Check the active network adapter DNS, VPN/proxy policy, and Windows DNS Client service. No token or secret was exposed.",
                true);
    }

    internal static AutopilotFailure ClassifyHttp(HttpStatusCode statusCode, string? responseBody)
    {
        var numeric = (int)statusCode;
        var body = responseBody ?? string.Empty;
        if (numeric == 530 || body.Contains("1033", StringComparison.OrdinalIgnoreCase))
        {
            return new AutopilotFailure(
                "connector_tunnel_unavailable",
                $"connector_tunnel_unavailable: HTTP {numeric}; the Cloudflare tunnel or its local connector origin is down.",
                "Local Manager will keep bounded retries. A linked device with missing local services will enter signed repair autopilot.",
                true);
        }
        if (numeric is 502 or 503 or 504)
        {
            return new AutopilotFailure(
                "platform_origin_unavailable",
                $"platform_origin_unavailable: auth.mad4b.com returned HTTP {numeric}.",
                "Cloudflare was reachable but the platform origin did not complete the request. Polling will retry automatically.",
                true);
        }
        if (numeric == 429)
        {
            return new AutopilotFailure(
                "platform_rate_limited",
                "platform_rate_limited: auth.mad4b.com asked Local Manager to slow down.",
                "The existing exponential backoff remains active.",
                true);
        }
        return new AutopilotFailure(
            "platform_http_failure",
            $"platform_http_failure: auth.mad4b.com returned HTTP {numeric} {statusCode}.",
            "The response body was not copied into the diagnostic envelope.",
            numeric >= 500);
    }

    private static AutopilotFailure ClassifyException(Exception exception)
    {
        if (exception is TaskCanceledException or TimeoutException)
        {
            return new AutopilotFailure(
                "platform_timeout",
                "platform_timeout: auth.mad4b.com did not respond before the request deadline.",
                "Desktop command polling will retry automatically with bounded backoff.",
                true);
        }
        if (exception is HttpRequestException)
        {
            return new AutopilotFailure(
                "platform_transport_failed",
                "platform_transport_failed: Local Manager could not establish the HTTPS request to auth.mad4b.com.",
                SafeDiagnostic(exception.Message),
                true);
        }
        return new AutopilotFailure(
            "desktop_command_poll_failed",
            "desktop_command_poll_failed: Local Manager could not complete desktop command polling.",
            SafeDiagnostic(exception.Message),
            true);
    }

    private static bool IsDnsFailure(Exception exception)
    {
        if (exception is SocketException socketException
            && socketException.SocketErrorCode is SocketError.HostNotFound or SocketError.TryAgain or SocketError.NoData)
        {
            return true;
        }
        var text = exception.Message ?? string.Empty;
        return text.Contains("No such host is known", StringComparison.OrdinalIgnoreCase)
            || text.Contains("Name or service not known", StringComparison.OrdinalIgnoreCase)
            || text.Contains("nodename nor servname", StringComparison.OrdinalIgnoreCase)
            || text.Contains("name resolution", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<bool> CanResolveHostAsync(string baseUrl, CancellationToken cancellationToken)
    {
        try
        {
            var host = new Uri(baseUrl, UriKind.Absolute).Host;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            var addresses = await Dns.GetHostAddressesAsync(host).WaitAsync(timeout.Token);
            return addresses.Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static string SafeDiagnostic(string? value)
    {
        var text = (value ?? "unknown transport error").Replace('\r', ' ').Replace('\n', ' ').Trim();
        return text.Length <= 300 ? text : text[..300];
    }
}

internal sealed record ConnectorFootprintAssessment(
    bool RepairRequired,
    bool RepairSuggested,
    bool CloudflaredPresent,
    bool CloudflaredRunning,
    bool ConnectorServicePresent,
    bool ConnectorServiceRunning,
    string Reason);

internal static class LocalConnectorFootprint
{
    internal static async Task<ConnectorFootprintAssessment> AssessAsync(CancellationToken cancellationToken = default)
    {
        var cloudflared = await QueryServiceAsync("cloudflared", cancellationToken);
        var connector = await QueryServiceAsync("local-connector", cancellationToken);
        var repairRequired = !cloudflared.Exists || !connector.Exists;
        var repairSuggested = repairRequired || !cloudflared.Running || !connector.Running;
        var reason = repairRequired
            ? "One or more required Windows services are missing. This is expected after a Windows reinstall or format."
            : repairSuggested
                ? "The connector services exist but one or more are not running."
                : "The connector service footprint is present and running.";
        return new ConnectorFootprintAssessment(
            repairRequired,
            repairSuggested,
            cloudflared.Exists,
            cloudflared.Running,
            connector.Exists,
            connector.Running,
            reason);
    }

    private static async Task<(bool Exists, bool Running)> QueryServiceAsync(
        string serviceName,
        CancellationToken cancellationToken)
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "sc.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            startInfo.ArgumentList.Add("query");
            startInfo.ArgumentList.Add(serviceName);
            using var process = Process.Start(startInfo);
            if (process is null) return (false, false);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var outputTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errorTask = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var output = (await outputTask) + " " + (await errorTask);
            var exists = process.ExitCode == 0 && !output.Contains("1060", StringComparison.OrdinalIgnoreCase);
            var running = exists && output.Contains("RUNNING", StringComparison.OrdinalIgnoreCase);
            return (exists, running);
        }
        catch
        {
            return (false, false);
        }
    }
}
