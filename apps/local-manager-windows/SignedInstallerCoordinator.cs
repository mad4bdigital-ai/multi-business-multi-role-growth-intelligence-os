using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mad4B.LocalManager.Windows;

internal sealed class SignedInstallerCoordinator
{
    private const int MinimumInstallerBytes = 64;

    private readonly Uri _baseUri;
    private readonly string _requestUrl;
    private readonly string _updatesRoot;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    internal SignedInstallerCoordinator(string baseUrl, string updatesRoot)
    {
        _baseUri = new Uri(baseUrl, UriKind.Absolute);
        _requestUrl = baseUrl + "/local-connector/install/device-download-link";
        _updatesRoot = Path.GetFullPath(updatesRoot);
    }

    internal Task<SignedInstallerLinkResult> RequestRepairAsync(
        string deviceAccessToken,
        CancellationToken cancellationToken = default) =>
        RequestAsync(deviceAccessToken, new
        {
            format = "bat",
            ttl_minutes = 30,
            app_managed = true,
            suppress_pause = true
        }, cancellationToken);

    internal Task<SignedInstallerLinkResult> RequestCapabilitiesAsync(
        string deviceAccessToken,
        IReadOnlyList<string> capabilities,
        IReadOnlyList<object> apps,
        IReadOnlyList<string> allowedPaths,
        IReadOnlyList<object> shellAliases,
        CancellationToken cancellationToken = default) =>
        RequestAsync(deviceAccessToken, new
        {
            format = "bat",
            ttl_minutes = 30,
            app_managed = true,
            suppress_pause = true,
            capabilities,
            permission_grants = new
            {
                apps,
                allowed_paths = allowedPaths,
                shell_aliases = shellAliases
            }
        }, cancellationToken);

    internal async Task<SignedInstallerDownload> DownloadAsync(
        DeviceInstallerLinkResponse link,
        SignedInstallerKind kind,
        CancellationToken cancellationToken = default)
    {
        var downloadUri = ValidateDownloadUri(link.DownloadUrl);
        Directory.CreateDirectory(_updatesRoot);
        var safeDeviceId = SafeFileSegment(link.CanonicalDeviceId ?? link.DeviceId ?? Environment.MachineName);
        var prefix = kind == SignedInstallerKind.Repair
            ? "install-local-connector"
            : "enable-connector-capabilities";
        var target = Path.GetFullPath(Path.Combine(
            _updatesRoot,
            $"{prefix}-{safeDeviceId}-{Guid.NewGuid():N}.bat"));
        AssertOwnedInstallerPath(target);

        using var client = CreateGovernedHttpClient();
        using var response = await client.GetAsync(downloadUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = File.Create(target);
        await source.CopyToAsync(destination, cancellationToken);

        var fileInfo = new FileInfo(target);
        if (!fileInfo.Exists || fileInfo.Length < MinimumInstallerBytes)
        {
            throw new InvalidOperationException("Downloaded installer file is missing or too small.");
        }

        return new SignedInstallerDownload(target, fileInfo.Length, await ComputeSha256Async(target, cancellationToken));
    }

    internal async Task<SignedInstallerRunResult> RunElevatedAsync(
        SignedInstallerDownload download,
        CancellationToken cancellationToken = default)
    {
        var ownedPath = Path.GetFullPath(download.InstallerPath);
        AssertOwnedInstallerPath(ownedPath);
        if (!File.Exists(ownedPath)) throw new FileNotFoundException("Installer file was not found.", ownedPath);
        var currentHash = await ComputeSha256Async(ownedPath, cancellationToken);
        if (!string.Equals(currentHash, download.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Installer file changed after governed download.");
        }

        Process? process;
        try
        {
            process = Process.Start(new ProcessStartInfo
            {
                FileName = ownedPath,
                UseShellExecute = true,
                WorkingDirectory = _updatesRoot,
                Verb = "runas"
            });
        }
        catch (System.ComponentModel.Win32Exception exception) when (exception.NativeErrorCode == 1223)
        {
            return SignedInstallerRunResult.CancelledByUser;
        }

        if (process is null) return SignedInstallerRunResult.ProcessHandleUnavailable;

        try
        {
            await process.WaitForExitAsync(cancellationToken);
            return SignedInstallerRunResult.Completed;
        }
        catch (InvalidOperationException)
        {
            await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
            return SignedInstallerRunResult.CompletionNotObservable;
        }
        finally
        {
            process.Dispose();
        }
    }

    private async Task<SignedInstallerLinkResult> RequestAsync(
        string deviceAccessToken,
        object payload,
        CancellationToken cancellationToken)
    {
        using var client = CreateGovernedHttpClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, _requestUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", deviceAccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await client.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        DeviceInstallerLinkResponse? link = null;
        try
        {
            link = JsonSerializer.Deserialize<DeviceInstallerLinkResponse>(text, _json);
        }
        catch (JsonException)
        {
            // Preserve raw response for the recovery shell without widening the request contract.
        }

        return new SignedInstallerLinkResult(
            response.StatusCode,
            response.IsSuccessStatusCode,
            response.ReasonPhrase,
            text,
            link);
    }

    private Uri ValidateDownloadUri(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.Equals(uri.Host, _baseUri.Host, StringComparison.OrdinalIgnoreCase)
            || uri.Port != _baseUri.Port
            || !string.Equals(uri.AbsolutePath, "/local-connector/install/download", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Signed installer download URL is outside the governed Local Manager endpoint.");
        }

        return uri;
    }

    private static HttpClient CreateGovernedHttpClient() =>
        new(new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromMinutes(5)
        };

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash);
    }

    private void AssertOwnedInstallerPath(string path)
    {
        var relative = Path.GetRelativePath(_updatesRoot, path);
        if (relative.StartsWith("..", StringComparison.Ordinal)
            || Path.IsPathRooted(relative)
            || !string.Equals(Path.GetExtension(path), ".bat", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Installer path is outside the governed Local Manager updates folder.");
        }
    }

    private static string SafeFileSegment(string value)
    {
        var chars = value.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.' ? ch : '-').ToArray();
        var safe = new string(chars).Trim('-');
        return string.IsNullOrWhiteSpace(safe) ? "device" : safe;
    }
}

internal enum SignedInstallerKind
{
    Repair,
    Capabilities
}

internal enum SignedInstallerRunResult
{
    Completed,
    CompletionNotObservable,
    CancelledByUser,
    ProcessHandleUnavailable
}

internal sealed record SignedInstallerDownload(string InstallerPath, long SizeBytes, string Sha256);

internal sealed record SignedInstallerLinkResult(
    HttpStatusCode StatusCode,
    bool IsSuccessStatusCode,
    string? ReasonPhrase,
    string RawText,
    DeviceInstallerLinkResponse? Link);

internal sealed class DeviceInstallerLinkResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("device_id")] public string? DeviceId { get; set; }
    [JsonPropertyName("canonical_device_id")] public string? CanonicalDeviceId { get; set; }
    [JsonPropertyName("config_id")] public string? ConfigId { get; set; }
    [JsonPropertyName("format")] public string? Format { get; set; }
    [JsonPropertyName("ttl_minutes")] public int TtlMinutes { get; set; }
    [JsonPropertyName("download_url")] public string? DownloadUrl { get; set; }
    [JsonPropertyName("run_as_admin_required")] public bool RunAsAdminRequired { get; set; }
    [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
}
