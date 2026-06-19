using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mad4B.LocalManager.Windows;

internal static class SidecarRpcContracts
{
    internal const int ProtocolVersion = 1;
    internal const string PipeName = "mad4b-local-manager-v1";

    private static readonly HashSet<string> ForbiddenResponseKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "access_token",
        "authorization",
        "backend_api_key",
        "connector_secret",
        "cookie",
        "device_access_token",
        "device_token",
        "installer_token",
        "password",
        "private_key",
        "refresh_token",
        "secret",
        "signed_installer_url",
        "token"
    };

    internal static readonly IReadOnlyDictionary<string, SidecarOperationPolicy> Operations =
        new Dictionary<string, SidecarOperationPolicy>(StringComparer.Ordinal)
        {
            ["device.getStatus"] = ReadOnly(),
            ["device.startLink"] = Mutation("device_link_approved"),
            ["device.forget"] = Mutation("device_forget_approved"),
            ["connector.getControls"] = ReadOnly(),
            ["connector.requestRepair"] = Mutation("repair_approved"),
            ["connector.requestCapabilities"] = Mutation("capability_change_approved"),
            ["runtime.getCapabilities"] = ReadOnly(),
            ["runtime.getRecommendations"] = ReadOnly(),
            ["runtime.updateSettings"] = Mutation("settings_update_approved"),
            ["runtime.installProvider"] = Mutation("installation_approved"),
            ["runtime.installModel"] = Mutation("model_installation_approved"),
            ["runtime.runApprovedJob"] = Mutation("delegation_approved"),
            ["runtime.getJob"] = ReadOnly(),
            ["runtime.cancelJob"] = Mutation("cancellation_approved")
        };

    internal static SidecarRpcResponse ValidateRequest(SidecarRpcRequest request)
    {
        if (request.ProtocolVersion != ProtocolVersion)
        {
            return SidecarRpcResponse.Rejected(
                request.RequestId,
                "unsupported_protocol_version",
                $"protocol_version must be {ProtocolVersion}.");
        }

        if (!Operations.TryGetValue(request.Operation, out var policy))
        {
            return SidecarRpcResponse.Rejected(
                request.RequestId,
                "unknown_sidecar_operation",
                "The requested sidecar operation is not allowlisted.");
        }

        if (policy.RequiredApprovalField is not null
            && !HasTrueBoolean(request.Arguments, policy.RequiredApprovalField))
        {
            return SidecarRpcResponse.Rejected(
                request.RequestId,
                "action_specific_approval_required",
                $"{policy.RequiredApprovalField}=true is required.");
        }

        return SidecarRpcResponse.Allow(request.RequestId, policy);
    }

    internal static void AssertSecretSafeResponse(JsonElement payload)
    {
        InspectElement(payload, "$");
    }

    private static SidecarOperationPolicy ReadOnly() =>
        new(RiskClass.ReadOnly, null, false);

    private static SidecarOperationPolicy Mutation(string requiredApprovalField) =>
        new(RiskClass.Mutation, requiredApprovalField, true);

    private static bool HasTrueBoolean(JsonElement arguments, string propertyName)
    {
        return arguments.ValueKind == JsonValueKind.Object
            && arguments.TryGetProperty(propertyName, out var value)
            && value.ValueKind == JsonValueKind.True;
    }

    private static void InspectElement(JsonElement element, string path)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (ForbiddenResponseKeys.Contains(property.Name))
                {
                    throw new InvalidOperationException(
                        $"Sidecar response contains forbidden secret-like field at {path}.{property.Name}.");
                }

                InspectElement(property.Value, $"{path}.{property.Name}");
            }

            return;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var item in element.EnumerateArray())
            {
                InspectElement(item, $"{path}[{index}]");
                index++;
            }
        }
    }
}

internal enum RiskClass
{
    ReadOnly,
    Mutation
}

internal sealed record SidecarOperationPolicy(
    [property: JsonPropertyName("risk_class")] RiskClass RiskClass,
    [property: JsonPropertyName("required_approval_field")] string? RequiredApprovalField,
    [property: JsonPropertyName("requires_fresh_approval")] bool RequiresFreshApproval);

internal sealed record SidecarRpcRequest(
    [property: JsonPropertyName("protocol_version")] int ProtocolVersion,
    [property: JsonPropertyName("request_id")] string RequestId,
    [property: JsonPropertyName("operation")] string Operation,
    [property: JsonPropertyName("arguments")] JsonElement Arguments);

internal sealed record SidecarRpcResponse(
    [property: JsonPropertyName("protocol_version")] int ProtocolVersion,
    [property: JsonPropertyName("request_id")] string RequestId,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("accepted")] bool Accepted,
    [property: JsonPropertyName("policy")] SidecarOperationPolicy? Policy,
    [property: JsonPropertyName("error")] SidecarRpcError? Error,
    [property: JsonPropertyName("secrets_included")] bool SecretsIncluded)
{
    internal static SidecarRpcResponse Allow(string requestId, SidecarOperationPolicy policy) =>
        new(SidecarRpcContracts.ProtocolVersion, requestId, true, true, policy, null, false);

    internal static SidecarRpcResponse Rejected(string requestId, string code, string message) =>
        new(
            SidecarRpcContracts.ProtocolVersion,
            requestId,
            false,
            false,
            null,
            new SidecarRpcError(code, message),
            false);
}

internal sealed record SidecarRpcError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);
