using System.Net;
using System.Net.Http.Headers;

namespace Mad4B.LocalManager.Windows;

internal sealed class DeviceControlClient
{
    private static readonly HashSet<string> AllowedSections = new(StringComparer.Ordinal)
    {
        "overview",
        "routes",
        "backups",
        "settings",
        "repairs",
        "n8n"
    };

    private readonly string _deviceControlsUrl;

    internal DeviceControlClient(string baseUrl)
    {
        _deviceControlsUrl = baseUrl + "/local-manager/device/controls";
    }

    internal async Task<DeviceControlHttpResult> GetAsync(
        string section,
        string deviceAccessToken,
        CancellationToken cancellationToken = default)
    {
        if (!AllowedSections.Contains(section))
        {
            throw new ArgumentOutOfRangeException(nameof(section), "The requested device-control section is not allowlisted.");
        }

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            _deviceControlsUrl + "?section=" + Uri.EscapeDataString(section));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", deviceAccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await client.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return new DeviceControlHttpResult(
            response.StatusCode,
            response.IsSuccessStatusCode,
            response.ReasonPhrase,
            text);
    }
}

internal sealed record DeviceControlHttpResult(
    HttpStatusCode StatusCode,
    bool IsSuccessStatusCode,
    string? ReasonPhrase,
    string RawText);
