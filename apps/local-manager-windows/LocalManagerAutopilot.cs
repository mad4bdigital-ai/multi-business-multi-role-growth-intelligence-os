using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed record AutopilotFailure(
    string Code,
    string Message,
    string Diagnostic,
    bool Retryable,
    string? RequestId = null,
    int? RetryAfterSeconds = null,
    string? Surface = null,
    string? RateLimitSource = null);

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

    internal static AutopilotFailure ClassifyHttp(
        HttpStatusCode statusCode,
        string? responseBody,
        string? rateLimitSource = null)
    {
        var numeric = (int)statusCode;
        var body = responseBody ?? string.Empty;
        if (numeric == 530 || body.Contains("1033", StringComparison.OrdinalIgnoreCase))
        {
            var structured = ParseStructuredHttpError(body, "connector_tunnel_unavailable", true);
            return new AutopilotFailure(
                structured.Code,
                $"{structured.Code}: HTTP {numeric}; the Cloudflare tunnel or its local connector origin is down.",
                "Local Manager retained only bounded error metadata; the raw response body was not copied.",
                structured.Retryable,
                structured.RequestId,
                structured.RetryAfterSeconds,
                structured.Surface);
        }
        if (numeric is 502 or 503 or 504 || numeric is >= 520 and <= 527)
        {
            var structured = ParseStructuredHttpError(body, "platform_origin_unavailable", true);
            return new AutopilotFailure(
                structured.Code,
                $"{structured.Code}: auth.mad4b.com returned HTTP {numeric}.",
                numeric is >= 520 and <= 527
                    ? "Cloudflare reached the request path but reported an origin-side failure. Only bounded error metadata was retained."
                    : "The platform origin did not complete the request. Only bounded error metadata was retained.",
                structured.Retryable,
                structured.RequestId,
                structured.RetryAfterSeconds,
                structured.Surface);
        }
        if (numeric == 429)
        {
            var fallbackCode = string.Equals(rateLimitSource, "upstream_edge", StringComparison.OrdinalIgnoreCase)
                ? "edge_rate_limited"
                : "platform_rate_limited";
            var structured = ParseStructuredHttpError(body, fallbackCode, true);
            return new AutopilotFailure(
                structured.Code,
                $"{structured.Code}: auth.mad4b.com asked Local Manager to slow down.",
                "The existing exponential backoff remains active. Only bounded error metadata was retained.",
                structured.Retryable,
                structured.RequestId,
                structured.RetryAfterSeconds,
                structured.Surface,
                string.IsNullOrWhiteSpace(rateLimitSource) ? structured.RateLimitSource : rateLimitSource);
        }

        var generic = ParseStructuredHttpError(body, "platform_http_failure", numeric >= 500);
        return new AutopilotFailure(
            generic.Code,
            $"{generic.Code}: auth.mad4b.com returned HTTP {numeric}.",
            "The raw response body was not copied; only code/requestId/retryable/retry_after/surface metadata may be shown.",
            generic.Retryable,
            generic.RequestId,
            generic.RetryAfterSeconds,
            generic.Surface);
    }

    private sealed record StructuredHttpError(
        string Code,
        string? RequestId,
        bool Retryable,
        int? RetryAfterSeconds,
        string? Surface,
        string? RateLimitSource);

    private static StructuredHttpError ParseStructuredHttpError(string? responseBody, string fallbackCode, bool fallbackRetryable)
    {
        var code = fallbackCode;
        string? requestId = null;
        var retryable = fallbackRetryable;
        int? retryAfterSeconds = null;
        string? surface = null;
        string? rateLimitSource = null;

        try
        {
            using var document = JsonDocument.Parse(responseBody ?? string.Empty);
            var root = document.RootElement;
            var error = root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("error", out var nested)
                && nested.ValueKind == JsonValueKind.Object
                    ? nested
                    : root;

            code = JsonText(error, "code") ?? JsonText(root, "code") ?? fallbackCode;
            requestId = JsonText(root, "requestId")
                ?? JsonText(root, "request_id")
                ?? JsonText(error, "requestId")
                ?? JsonText(error, "request_id");
            retryable = JsonBool(error, "retryable") ?? JsonBool(root, "retryable") ?? fallbackRetryable;
            retryAfterSeconds = JsonInt(error, "retry_after")
                ?? JsonInt(error, "retry_after_seconds")
                ?? JsonInt(root, "retry_after")
                ?? JsonInt(root, "retry_after_seconds");
            surface = JsonText(error, "surface") ?? JsonText(root, "surface");
            rateLimitSource = JsonText(error, "rate_limit_source") ?? JsonText(root, "rate_limit_source");
        }
        catch (JsonException)
        {
            // Non-JSON responses remain intentionally opaque.
        }

        return new StructuredHttpError(
            SafeDiagnostic(code),
            string.IsNullOrWhiteSpace(requestId) ? null : SafeDiagnostic(requestId),
            retryable,
            retryAfterSeconds is null ? null : Math.Clamp(retryAfterSeconds.Value, 1, 86400),
            string.IsNullOrWhiteSpace(surface) ? null : SafeDiagnostic(surface),
            string.IsNullOrWhiteSpace(rateLimitSource) ? null : SafeDiagnostic(rateLimitSource));
    }

    private static string? JsonText(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool? JsonBool(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static int? JsonInt(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)) return number;
        return null;
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
