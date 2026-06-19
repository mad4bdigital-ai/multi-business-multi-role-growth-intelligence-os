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

        var evidence = section switch
        {
            "repairs" => RequireTrueBoolean(controls, "elevation_required"),
            "settings" => RequireObject(controls, "capability_consent"),
            _ => "readback_verified"
        };

        return new ConnectorCapabilityVerification(
            section,
            evidence,
            DateTimeOffset.UtcNow,
            root.Clone());
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
    DateTimeOffset VerifiedAt,
    JsonElement ControlEnvelope);
