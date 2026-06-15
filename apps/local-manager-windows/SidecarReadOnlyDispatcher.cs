using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class SidecarReadOnlyDispatcher
{
    private readonly DeviceIdentityStore _deviceIdentityStore;
    private readonly ConnectorCapabilityVerifier _connectorCapabilityVerifier;

    internal SidecarReadOnlyDispatcher(
        DeviceIdentityStore deviceIdentityStore,
        ConnectorCapabilityVerifier connectorCapabilityVerifier)
    {
        _deviceIdentityStore = deviceIdentityStore;
        _connectorCapabilityVerifier = connectorCapabilityVerifier;
    }

    internal Task<JsonElement> DispatchAsync(
        SidecarRpcRequest request,
        CancellationToken cancellationToken = default) =>
        request.Operation switch
        {
            "device.getStatus" => Task.FromResult(GetDeviceStatus()),
            "connector.getControls" => GetConnectorControlsAsync(request.Arguments, cancellationToken),
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

    private async Task<JsonElement> GetConnectorControlsAsync(
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        var section = GetOptionalString(arguments, "section") ?? "overview";
        var token = _deviceIdentityStore.Load(out var loadError);
        if (token is null)
        {
            throw new InvalidOperationException(
                loadError is null
                    ? "The device is not linked."
                    : "The linked-device credential is unavailable.");
        }

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
}
