using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class SidecarReadOnlyDispatcher
{
    private readonly DeviceIdentityStore _deviceIdentityStore;
    private readonly ConnectorCapabilityVerifier _connectorCapabilityVerifier;
    private readonly LocalRuntimeClient _localRuntimeClient;

    internal SidecarReadOnlyDispatcher(
        DeviceIdentityStore deviceIdentityStore,
        ConnectorCapabilityVerifier connectorCapabilityVerifier,
        LocalRuntimeClient localRuntimeClient)
    {
        _deviceIdentityStore = deviceIdentityStore;
        _connectorCapabilityVerifier = connectorCapabilityVerifier;
        _localRuntimeClient = localRuntimeClient;
    }

    internal Task<JsonElement> DispatchAsync(
        SidecarRpcRequest request,
        CancellationToken cancellationToken = default) =>
        request.Operation switch
        {
            "device.getStatus" => Task.FromResult(GetDeviceStatus()),
            "connector.getControls" => GetConnectorControlsAsync(request.Arguments, cancellationToken),
            "runtime.getCapabilities" => GetRuntimeReadbackAsync("capabilities", cancellationToken),
            "runtime.getRecommendations" => GetRuntimeReadbackAsync("recommend_models", cancellationToken),
            _ => throw new InvalidOperationException("The sidecar operation has no attached dispatcher.")
        };

    private JsonElement GetDeviceStatus()
    {
        var token = _deviceIdentityStore.Load(out var loadError);
        return JsonSerializer.SerializeToElement(new
        {
            linked = token is not null,
            credential_file_exists = _deviceIdentityStore.TokenFileExists,
            credential_readable = token is not null,
            credential_read_error = loadError is not null,
            credential_storage = "Windows DPAPI CurrentUser",
            secrets_included = false
        });
    }

    private async Task<JsonElement> GetRuntimeReadbackAsync(
        string action,
        CancellationToken cancellationToken)
    {
        var token = LoadDeviceToken();
        var response = await _localRuntimeClient.GetAsync(action, token, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Local runtime readback failed with status {(int)response.StatusCode}.");
        }

        using var document = JsonDocument.Parse(response.RawText);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !GetTrueBoolean(root, "ok")
            || GetTrueBoolean(root, "secrets_included"))
        {
            throw new InvalidOperationException("Local runtime readback returned an invalid or unsafe envelope.");
        }

        var payload = root.Clone();
        SidecarRpcContracts.AssertSecretSafeResponse(payload);
        return payload;
    }

    private string LoadDeviceToken()
    {
        var token = _deviceIdentityStore.Load(out var loadError);
        if (token is null)
        {
            throw new InvalidOperationException(
                loadError is null
                    ? "The device is not linked."
                    : "The linked-device credential is unavailable.");
        }

        return token;
    }

    private async Task<JsonElement> GetConnectorControlsAsync(
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        var section = GetOptionalString(arguments, "section") ?? "overview";
        var token = LoadDeviceToken();
        var verification = await _connectorCapabilityVerifier.VerifyAsync(section, token, cancellationToken);
        SidecarRpcContracts.AssertSecretSafeResponse(verification.ControlEnvelope);
        return JsonSerializer.SerializeToElement(new
        {
            section = verification.Section,
            evidence = verification.Evidence,
            verified_at = verification.VerifiedAt,
            controls = verification.ControlEnvelope,
            secrets_included = false
        });
    }

    private static string? GetOptionalString(JsonElement arguments, string propertyName)
    {
        if (arguments.ValueKind != JsonValueKind.Object
            || !arguments.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return value.GetString();
    }

    private static bool GetTrueBoolean(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.True;
}
