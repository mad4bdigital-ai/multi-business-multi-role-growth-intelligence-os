using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed record DesktopCommandPollBackoffState(DateTimeOffset BackoffUntilUtc, int FailureCount);

internal sealed class DesktopCommandPollBackoffStore
{
    private const int MaxBackoffSeconds = 300;
    private readonly string _statePath;

    public DesktopCommandPollBackoffStore(string installRoot)
    {
        _statePath = Path.Combine(installRoot, "desktop-command-poll-backoff.json");
    }

    public DesktopCommandPollBackoffState? Load(DateTimeOffset now)
    {
        try
        {
            if (!File.Exists(_statePath)) return null;
            using var document = JsonDocument.Parse(File.ReadAllText(_statePath, Encoding.UTF8));
            var root = document.RootElement;
            if (!root.TryGetProperty("backoff_until_utc", out var untilProperty)
                || untilProperty.ValueKind != JsonValueKind.String
                || !DateTimeOffset.TryParse(untilProperty.GetString(), out var persistedUntil))
            {
                Clear();
                return null;
            }

            if (persistedUntil <= now)
            {
                Clear();
                return null;
            }

            var boundedUntil = persistedUntil > now.AddSeconds(MaxBackoffSeconds)
                ? now.AddSeconds(MaxBackoffSeconds)
                : persistedUntil;
            var failureCount = 1;
            if (root.TryGetProperty("failure_count", out var countProperty)
                && countProperty.TryGetInt32(out var parsedCount))
            {
                failureCount = Math.Clamp(parsedCount, 1, 10);
            }

            return new DesktopCommandPollBackoffState(boundedUntil, failureCount);
        }
        catch
        {
            Clear();
            return null;
        }
    }

    public void Save(DateTimeOffset backoffUntilUtc, int failureCount)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_statePath)!);
            var now = DateTimeOffset.UtcNow;
            var boundedUntil = backoffUntilUtc > now.AddSeconds(MaxBackoffSeconds)
                ? now.AddSeconds(MaxBackoffSeconds)
                : backoffUntilUtc;
            var payload = JsonSerializer.Serialize(new
            {
                contract = "mad4b.local-manager-desktop-poll-backoff.v1",
                backoff_until_utc = boundedUntil.ToUniversalTime().ToString("O"),
                failure_count = Math.Clamp(failureCount, 1, 10),
                secrets_included = false
            });
            var temporary = _statePath + ".tmp";
            File.WriteAllText(temporary, payload, Encoding.UTF8);
            File.Move(temporary, _statePath, true);
        }
        catch
        {
            // Backoff state is secret-free local scheduling metadata. Filesystem
            // failure must not expose credentials or authorize any command.
        }
    }

    public void Clear()
    {
        try
        {
            if (File.Exists(_statePath)) File.Delete(_statePath);
        }
        catch { }
    }
}
