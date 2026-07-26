using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class LocalRuntimeClient
{
    private static readonly HashSet<string> AllowedActions = new(StringComparer.Ordinal)
    {
        "capabilities",
        "recommend_models"
    };

    private readonly string _runtimeReadbackUrl;

    internal LocalRuntimeClient(string baseUrl)
    {
        _runtimeReadbackUrl = baseUrl + "/local-manager/device/agent-runtime";
    }

    internal async Task<LocalRuntimeHttpResult> GetAsync(
        string action,
        string deviceAccessToken,
        CancellationToken cancellationToken = default)
    {
        if (!AllowedActions.Contains(action))
        {
            throw new ArgumentOutOfRangeException(nameof(action), "The requested runtime action is not read-only allowlisted.");
        }

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        using var request = new HttpRequestMessage(HttpMethod.Post, _runtimeReadbackUrl)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { action }),
                Encoding.UTF8,
                "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", deviceAccessToken);
        request.Headers.Accept.ParseAdd("application/json");
        using var response = await client.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return new LocalRuntimeHttpResult(
            response.StatusCode,
            response.IsSuccessStatusCode,
            response.ReasonPhrase,
            text);
    }
}

internal sealed record LocalRuntimeHttpResult(
    HttpStatusCode StatusCode,
    bool IsSuccessStatusCode,
    string? ReasonPhrase,
    string RawText);
