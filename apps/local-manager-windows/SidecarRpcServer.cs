using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mad4B.LocalManager.Windows;

internal sealed class SidecarRpcServer
{
    private const int MaxRequestBytes = 256 * 1024;

    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    internal async Task RunAsync(
        Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> dispatch,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                SidecarRpcContracts.PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

            await pipe.WaitForConnectionAsync(cancellationToken);
            await HandleConnectionAsync(pipe, dispatch, cancellationToken);
        }
    }

    private async Task HandleConnectionAsync(
        Stream stream,
        Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> dispatch,
        CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(
            stream,
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096,
            leaveOpen: true);
        await using var writer = new StreamWriter(
            stream,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            bufferSize: 4096,
            leaveOpen: true)
        {
            AutoFlush = true
        };

        var requestLine = await ReadBoundedLineAsync(reader, cancellationToken);
        if (requestLine is null) return;

        SidecarRpcRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<SidecarRpcRequest>(requestLine, _json);
        }
        catch (JsonException)
        {
            await WriteResponseAsync(
                writer,
                SidecarRpcResponse.Rejected("", "invalid_sidecar_request", "Request must be valid JSON."));
            return;
        }

        if (request is null || string.IsNullOrWhiteSpace(request.RequestId) || string.IsNullOrWhiteSpace(request.Operation))
        {
            await WriteResponseAsync(
                writer,
                SidecarRpcResponse.Rejected(
                    request?.RequestId ?? "",
                    "invalid_sidecar_request",
                    "request_id and operation are required."));
            return;
        }

        var validation = SidecarRpcContracts.ValidateRequest(request);
        if (!validation.Accepted)
        {
            await WriteResponseAsync(writer, validation);
            return;
        }

        try
        {
            var result = await dispatch(request, cancellationToken);
            SidecarRpcContracts.AssertSecretSafeResponse(result);
            await WriteEnvelopeAsync(writer, request.RequestId, result);
        }
        catch (Exception error)
        {
            await WriteResponseAsync(
                writer,
                SidecarRpcResponse.Rejected(
                    request.RequestId,
                    "sidecar_operation_failed",
                    RedactError(error.Message)));
        }
    }

    private async Task<string?> ReadBoundedLineAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        var buffer = new char[4096];
        var value = new StringBuilder();

        while (!cancellationToken.IsCancellationRequested)
        {
            var read = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read == 0) return value.Length == 0 ? null : value.ToString();

            for (var index = 0; index < read; index++)
            {
                if (buffer[index] == '\n') return value.ToString().TrimEnd('\r');
                value.Append(buffer[index]);
                if (Encoding.UTF8.GetByteCount(value.ToString()) > MaxRequestBytes)
                {
                    throw new InvalidOperationException("Sidecar request exceeds the maximum size.");
                }
            }
        }

        return null;
    }

    private async Task WriteResponseAsync(StreamWriter writer, SidecarRpcResponse response)
    {
        await writer.WriteLineAsync(JsonSerializer.Serialize(response, _json));
    }

    private async Task WriteEnvelopeAsync(StreamWriter writer, string requestId, JsonElement result)
    {
        var envelope = new
        {
            protocol_version = SidecarRpcContracts.ProtocolVersion,
            request_id = requestId,
            ok = true,
            accepted = true,
            result,
            secrets_included = false
        };
        await writer.WriteLineAsync(JsonSerializer.Serialize(envelope, _json));
    }

    private static string RedactError(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "The sidecar operation failed.";
        var lowered = value.ToLowerInvariant();
        return lowered.Contains("token")
            || lowered.Contains("secret")
            || lowered.Contains("password")
            || lowered.Contains("authorization")
            ? "The sidecar operation failed without exposing sensitive details."
            : value;
    }
}
