using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private static async Task Main()
    {
        var pipeName = $"mad4b-local-manager-cert-{Guid.NewGuid():N}";
        var server = new SidecarRpcServer(pipeName, TimeSpan.FromMilliseconds(250));
        var supervisor = new SidecarLifecycleSupervisor(server, DispatchAsync);
        supervisor.Start();

        await AssertSuccessfulRequestAsync(pipeName);
        await AssertRejectedRequestAsync(pipeName);
        await AssertStalledClientTimeoutAsync(pipeName);
        await AssertSupervisorRestartAsync();
        await AssertMutationConsentAsync();
        AssertStructuralEditors();
        AssertPdfStructuralEditor();

        var beforeShutdown = supervisor.GetStatus();
        Assert(beforeShutdown.Running, "supervisor must be running before shutdown");
        await supervisor.DisposeAsync();
        var afterShutdown = supervisor.GetStatus();
        Assert(!afterShutdown.Running, "supervisor must stop after shutdown");

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            certification = "local_manager_sidecar_named_pipe_live",
            checks = new[] { "success", "rejection", "timeout_recovery", "supervisor_restart", "shutdown", "os_private_mutation_consent", "one_shot", "principal_isolation", "expiry", "argument_binding" },
            secrets_included = false
        }));
    }



    private static byte[] BuildOoxml(params (string Name, string Xml)[] parts)
    {
        using var memory = new MemoryStream();
        using (var archive = new System.IO.Compression.ZipArchive(memory,
            System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, xml) in parts)
            {
                var item = archive.CreateEntry(name);
                using var writer = new StreamWriter(item.Open(), new UTF8Encoding(false));
                writer.Write(xml);
            }
        }
        return memory.ToArray();
    }

    private static void AssertPdfStructuralEditor()
    {
        using var document = new PdfSharp.Pdf.PdfDocument();
        document.AddPage();
        document.Info.Title = "Before PDF";
        using var source = new MemoryStream();
        document.Save(source, false);
        var bytes = source.ToArray();
        var sha = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
        var output = PdfStructuralEditor.ChangeTitleAndRotation(
            bytes, sha, "Before PDF", "After PDF", 1, 90);
        using var verify = PdfSharp.Pdf.IO.PdfReader.Open(
            new MemoryStream(output), PdfSharp.Pdf.IO.PdfDocumentOpenMode.ReadOnly);
        Assert(verify.Info.Title == "After PDF", "PDF must persist changed metadata");
        Assert(verify.Pages[0].Rotate == 90, "PDF must persist page rotation");
        Assert(verify.PageCount == 1, "PDF must preserve all pages");
        Assert(!bytes.SequenceEqual(output), "PDF source must not be mutated");
        var failedHash = false;
        try { PdfStructuralEditor.ChangeTitleAndRotation(
            bytes, new string('0', 64), "Before PDF", "Changed", 1, 90); }
        catch (InvalidDataException) { failedHash = true; }
        Assert(failedHash, "PDF optimistic SHA precondition must be mandatory");
        var failedPage = false;
        try { PdfStructuralEditor.ChangeTitleAndRotation(
            bytes, sha, "Before PDF", "Changed", 2, 90); }
        catch (InvalidDataException) { failedPage = true; }
        Assert(failedPage, "PDF editing must deny page indices outside the document");
        var failedMetadata = false;
        try { PdfStructuralEditor.ChangeTitleAndRotation(
            bytes, sha, "stale title", "Changed", 1, 90); }
        catch (InvalidDataException) { failedMetadata = true; }
        Assert(failedMetadata, "PDF metadata concurrent change must fail closed");
    }

    private static void AssertStructuralEditors()
    {
        var contentTypes = "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>";
        var word = "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
            "<w:body><w:p><w:r><w:t>Old value</w:t></w:r></w:p></w:body></w:document>";
        var input = BuildOoxml(
            ("[Content_Types].xml", contentTypes),
            ("word/document.xml", word),
            ("_rels/.rels", "<Relationships/>"));
        var checksum = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(input));
        var changed = DocumentStructuralEditor.ReplaceDocxRun(input, checksum, "Old value", "New & value");
        using (var stream = new MemoryStream(changed))
        using (var archive = new System.IO.Compression.ZipArchive(stream,
            System.IO.Compression.ZipArchiveMode.Read))
        using (var reader = new StreamReader(archive.GetEntry("word/document.xml")!.Open()))
        {
            var xml = reader.ReadToEnd();
            Assert(xml.Contains("New &amp; value"), "DOCX must escape XML content");
            Assert(!xml.Contains("Old value"), "DOCX must update exactly the intended run");
        }
        Assert(!input.SequenceEqual(changed), "DOCX source bytes must remain immutable");
        var digestRejected = false;
        try { DocumentStructuralEditor.ReplaceDocxRun(input, new string('0', 64), "Old value", "x"); }
        catch (InvalidDataException) { digestRejected = true; }
        Assert(digestRejected, "DOCX expected checksum must reject stale content");

        var sheet = "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
            "<sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Before</t></is></c>" +
            "<c r=\"B1\"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>";
        var xlsx = BuildOoxml(
            ("[Content_Types].xml", contentTypes),
            ("xl/workbook.xml", "<workbook/>"),
            ("xl/worksheets/sheet1.xml", sheet));
        var xsha = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(xlsx));
        var revised = DocumentStructuralEditor.ReplaceXlsxInlineCell(
            xlsx, xsha, "xl/worksheets/sheet1.xml", "A1", "Before", "After");
        using (var stream = new MemoryStream(revised))
        using (var archive = new System.IO.Compression.ZipArchive(stream,
            System.IO.Compression.ZipArchiveMode.Read))
        using (var reader = new StreamReader(archive.GetEntry("xl/worksheets/sheet1.xml")!.Open()))
        {
            var xml = reader.ReadToEnd();
            Assert(xml.Contains("After"), "XLSX inline cell must change");
            Assert(xml.Contains("<f>1+1</f>"), "XLSX unrelated formula must be preserved");
        }
        var formulaRejected = false;
        try {
            DocumentStructuralEditor.ReplaceXlsxInlineCell(xlsx, xsha,
                "xl/worksheets/sheet1.xml", "B1", "2", "3");
        } catch (InvalidDataException) { formulaRejected = true; }
        Assert(formulaRejected, "formula cells must not be rewritten as strings");
        var pdfRejected = false;
        try { DocumentStructuralEditor.RejectPdfStructuralEdit(); }
        catch (NotSupportedException) { pdfRejected = true; }
        Assert(pdfRejected, "uncertified PDF structural mutation must fail closed");
    }

    private static async Task AssertMutationConsentAsync()
    {
        var scopeOwner = "windows-sid-a";
        var clock = DateTimeOffset.UtcNow;
        var broker = new SidecarLocalConsentBroker(() => scopeOwner, () => clock);
        var pipe = $"mad4b-consent-cert-{Guid.NewGuid():N}";
        var server = new SidecarRpcServer(pipe, TimeSpan.FromSeconds(2), broker);
        await using var supervisor = new SidecarLifecycleSupervisor(server, DispatchAsync);
        supervisor.Start();

        var request = new
        {
            protocol_version = 1,
            request_id = "mutation-once",
            operation = "runtime.updateSettings",
            arguments = new { settings_update_approved = true, value = "test-only" }
        };
        var typed = JsonSerializer.Deserialize<SidecarRpcRequest>(
            JsonSerializer.Serialize(request), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        using (var blocked = await SendRequestAsync(pipe, request))
            Assert(blocked.RootElement.GetProperty("error").GetProperty("code").GetString() ==
                "os_private_consent_required", "client-provided approval boolean alone must not authorize mutation");
        Assert(!broker.ApproveLocally(typed, false), "unconfirmed local action cannot create consent");
        Assert(broker.ApproveLocally(typed, true), "explicit in-process consent should issue once");

        using (var passed = await SendRequestAsync(pipe, request))
            Assert(passed.RootElement.GetProperty("accepted").GetBoolean(),
                "locally approved exact request must reach dispatcher");
        using (var replay = await SendRequestAsync(pipe, request))
            Assert(replay.RootElement.GetProperty("error").GetProperty("code").GetString() ==
                "os_private_consent_required", "local consent must never be reusable");

        var scoped = new SidecarRpcRequest(1, "cross-principal", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true }));
        Assert(broker.ApproveLocally(scoped, true), "create principal-bound consent");
        scopeOwner = "windows-sid-b";
        Assert(!broker.Consume(scoped), "another OS principal must not consume issued grant");
        scopeOwner = "windows-sid-a";

        var expired = new SidecarRpcRequest(1, "expired", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true }));
        Assert(broker.ApproveLocally(expired, true), "create expiring consent");
        clock = clock.AddSeconds(91);
        Assert(!broker.Consume(expired), "90-second expiry must fail closed");

        var substituted = new SidecarRpcRequest(1, "exact-args", "runtime.updateSettings",
            JsonSerializer.SerializeToElement(new { settings_update_approved = true, value = "a" }));
        Assert(broker.ApproveLocally(substituted, true), "create argument-bound consent");
        Assert(!broker.Consume(substituted with
        {
            Arguments = JsonSerializer.SerializeToElement(new { settings_update_approved = true, value = "b" })
        }), "argument substitution must fail closed");

        broker.InvalidateAll(); // same behavior required on user logout / UI disposal.
        Assert(!broker.Consume(substituted), "logout/dispose revokes all pending grants");
    }

    private static Task<JsonElement> DispatchAsync(
        SidecarRpcRequest request,
        CancellationToken cancellationToken) =>
        Task.FromResult(JsonSerializer.SerializeToElement(new
        {
            operation = request.Operation,
            certified = true,
            secrets_included = false
        }));

    private static async Task AssertSuccessfulRequestAsync(string pipeName)
    {
        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-success",
                operation = "device.getStatus",
                arguments = new { }
            });
        Assert(response.RootElement.GetProperty("ok").GetBoolean(), "read-only request must succeed");
        Assert(response.RootElement.GetProperty("request_id").GetString() == "cert-success", "successful request id must round-trip");
    }

    private static async Task AssertRejectedRequestAsync(string pipeName)
    {
        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-reject",
                operation = "runtime.installModel",
                arguments = new { }
            });
        Assert(!response.RootElement.GetProperty("accepted").GetBoolean(), "mutation without approval must be rejected");
        Assert(
            response.RootElement.GetProperty("error").GetProperty("code").GetString() == "action_specific_approval_required",
            "rejection must preserve the approval error code");
    }

    private static async Task AssertStalledClientTimeoutAsync(string pipeName)
    {
        await using (var stalled = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous))
        {
            await stalled.ConnectAsync(2000);
            await Task.Delay(450);
        }

        using var response = await SendRequestAsync(
            pipeName,
            new
            {
                protocol_version = 1,
                request_id = "cert-after-timeout",
                operation = "device.getStatus",
                arguments = new { }
            });
        Assert(response.RootElement.GetProperty("ok").GetBoolean(), "server must accept a request after dropping a stalled client");
    }

    private static async Task AssertSupervisorRestartAsync()
    {
        var faultingServer = new FaultOnceServer();
        await using var supervisor = new SidecarLifecycleSupervisor(faultingServer, DispatchAsync);
        supervisor.Start();

        var timer = Stopwatch.StartNew();
        while (faultingServer.RunCount < 2 && timer.Elapsed < TimeSpan.FromSeconds(5))
        {
            await Task.Delay(50);
        }

        var status = supervisor.GetStatus();
        Assert(status.Running, "supervisor must continue after a server fault");
        Assert(status.RestartCount == 1, "supervisor must record exactly one injected restart");
        Assert(faultingServer.RunCount >= 2, "supervisor must invoke the server again after a fault");
    }

    private static async Task<JsonDocument> SendRequestAsync(string pipeName, object request)
    {
        const int maxAttempts = 3;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await SendRequestOnceAsync(pipeName, request);
            }
            catch (Exception error) when (attempt < maxAttempts && IsTransientPipeFailure(error))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100 * attempt));
            }
        }
    }

    private static async Task<JsonDocument> SendRequestOnceAsync(string pipeName, object request)
    {
        await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(2000);
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = true };
        await writer.WriteLineAsync(JsonSerializer.Serialize(request));
        var response = await reader.ReadLineAsync();
        Assert(!string.IsNullOrWhiteSpace(response), "sidecar must return a response");
        return JsonDocument.Parse(response!);
    }

    private static bool IsTransientPipeFailure(Exception error) =>
        error is IOException or TimeoutException;

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class FaultOnceServer : ISidecarRpcServer
    {
        internal int RunCount { get; private set; }

        public async Task RunAsync(
            Func<SidecarRpcRequest, CancellationToken, Task<JsonElement>> dispatch,
            CancellationToken cancellationToken)
        {
            RunCount++;
            if (RunCount == 1) throw new InvalidOperationException("injected certification fault");
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
    }
}
