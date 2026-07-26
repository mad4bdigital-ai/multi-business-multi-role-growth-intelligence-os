using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mad4B.LocalManager.Windows;

internal sealed class DeviceLinkClient
{
    private readonly string _deviceLinkStartUrl;
    private readonly string _deviceLinkPollUrl;
    private readonly string _deviceSessionUrl;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    internal DeviceLinkClient(string baseUrl)
    {
        _deviceLinkStartUrl = baseUrl + "/local-manager/device-link/start";
        _deviceLinkPollUrl = baseUrl + "/local-manager/device-link/poll";
        _deviceSessionUrl = baseUrl + "/local-manager/device/session";
    }

    internal async Task<DeviceLinkHttpResult<DeviceLinkStartResponse>> StartAsync(
        string deviceId,
        string hostname,
        string platform,
        string? appVersion,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        using var response = await client.PostAsync(
            _deviceLinkStartUrl,
            JsonContent(new
            {
                device_id = deviceId,
                hostname,
                platform,
                app_version = appVersion
            }),
            cancellationToken);
        return await ReadAsync<DeviceLinkStartResponse>(response, cancellationToken);
    }

    internal async Task<DeviceLinkHttpResult<DeviceLinkPollResponse>> PollAsync(
        string deviceCode,
        string pollToken,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        using var response = await client.PostAsync(
            _deviceLinkPollUrl,
            JsonContent(new { device_code = deviceCode, poll_token = pollToken }),
            cancellationToken);
        return await ReadAsync<DeviceLinkPollResponse>(response, cancellationToken);
    }

    internal async Task<DeviceLinkHttpResult<JsonElement>> GetSessionAsync(
        string deviceAccessToken,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, _deviceSessionUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", deviceAccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await client.SendAsync(request, cancellationToken);
        return await ReadAsync<JsonElement>(response, cancellationToken);
    }

    private static HttpClient CreateClient() =>
        new() { Timeout = TimeSpan.FromSeconds(30) };

    private static StringContent JsonContent(object payload) =>
        new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

    private async Task<DeviceLinkHttpResult<T>> ReadAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        T? payload = default;
        try
        {
            payload = JsonSerializer.Deserialize<T>(text, _json);
        }
        catch (JsonException)
        {
            // Preserve the raw response so the recovery shell can display it.
        }

        return new DeviceLinkHttpResult<T>(
            response.StatusCode,
            response.IsSuccessStatusCode,
            response.ReasonPhrase,
            text,
            payload);
    }
}

internal sealed record DeviceLinkHttpResult<T>(
    HttpStatusCode StatusCode,
    bool IsSuccessStatusCode,
    string? ReasonPhrase,
    string RawText,
    T? Payload);

internal sealed class DeviceLinkError
{
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

internal sealed class DeviceLinkStartResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("device_code")] public string? DeviceCode { get; set; }
    [JsonPropertyName("user_code")] public string? UserCode { get; set; }
    [JsonPropertyName("verification_uri")] public string? VerificationUri { get; set; }
    [JsonPropertyName("verification_uri_complete")] public string? VerificationUriComplete { get; set; }
    [JsonPropertyName("poll_token")] public string? PollToken { get; set; }
    [JsonPropertyName("interval")] public int Interval { get; set; } = 3;
    [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
    [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
}

internal sealed class DeviceLinkPollResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("device_access_token")] public string? DeviceAccessToken { get; set; }
    [JsonPropertyName("device")] public DeviceLinkDevice? Device { get; set; }
    [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
}

internal sealed class DeviceLinkDevice
{
    [JsonPropertyName("device_id")] public string? DeviceId { get; set; }
}
