using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class ConnectorCapabilityVerifier
{
    private readonly DeviceControlClient _deviceControlClient;

    internal ConnectorCapabilityVerifier(DeviceControlClient deviceControlClient)
    {
        _deviceControlClient = deviceControlClient;
    }

    internal async Task<ConnectorCapabilityVerification> VerifyAsync(
        string section,
        string deviceAccessToken,
        CancellationToken cancellationToken = default)
    {
        var response = await _deviceControlClient.GetAsync(section, deviceAccessToken, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Connector capability verification failed with status {(int)response.StatusCode}.");
        }

        using var document = JsonDocument.Parse(response.RawText);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !GetTrueBoolean(root, "ok")
            || GetString(root, "section") != section
            || GetTrueBoolean(root, "secrets_included")
            || !root.TryGetProperty("controls", out var controls)
            || controls.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Connector capability verification returned an invalid or unsafe control envelope.");
        }

        var (evidence, runtimeVerified) = section switch
        {
            "repairs" => VerifyRepairRuntimeReadback(root, controls),
            "settings" => (RequireObject(controls, "capability_consent"), true),
            _ => ("readback_verified", true)
        };

        return new ConnectorCapabilityVerification(
            section,
            evidence,
            runtimeVerified,
            DateTimeOffset.UtcNow,
            root.Clone());
    }

    private static (string Evidence, bool RuntimeVerified) VerifyRepairRuntimeReadback(
        JsonElement root,
        JsonElement controls)
    {
        RequireTrueBoolean(controls, "elevation_required");
        if (!root.TryGetProperty("runtime_readback", out var runtime)
            || runtime.ValueKind != JsonValueKind.Object)
        {
            return ("runtime_readback_missing", false);
        }

        if (GetTrueBoolean(runtime, "secrets_included"))
        {
            throw new InvalidOperationException("Connector runtime verification returned an unsafe evidence envelope.");
        }

        var routeCount = GetInt32(runtime, "registered_route_count");
        var runtimeVerified = GetTrueBoolean(runtime, "resolved")
            && GetTrueBoolean(runtime, "connector_active")
            && GetTrueBoolean(runtime, "health_recent")
            && GetTrueBoolean(runtime, "alias_resolved")
            && routeCount > 0;

        return runtimeVerified
            ? ("runtime_readback_verified", true)
            : ("runtime_readback_unverified", false);
    }

    private static int GetInt32(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var parsed)
                ? parsed
                : 0;
    }

    private static string RequireTrueBoolean(JsonElement element, string propertyName)
    {
        if (!GetTrueBoolean(element, propertyName))
        {
            throw new InvalidOperationException($"Connector control verification is missing {propertyName}=true.");
        }

        return propertyName;
    }

    private static string RequireObject(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException($"Connector control verification is missing {propertyName}.");
        }

        return propertyName;
    }

    private static bool GetTrueBoolean(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.True;

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

internal sealed record ConnectorCapabilityVerification(
    string Section,
    string Evidence,
    bool RuntimeVerified,
    DateTimeOffset VerifiedAt,
    JsonElement ControlEnvelope);
