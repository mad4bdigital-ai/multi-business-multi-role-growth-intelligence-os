using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed record DesktopCommandPollBackoffState(DateTimeOffset BackoffUntilUtc, int FailureCount);

internal sealed class DesktopCommandPollBackoffStore
{
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

            // A server Retry-After deadline is a lower bound, including across restart.
            var boundedUntil = persistedUntil;
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

    public bool Save(DateTimeOffset backoffUntilUtc, int failureCount)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_statePath)!);
            var boundedUntil = backoffUntilUtc;
            var payload = JsonSerializer.Serialize(new
            {
                contract = "mad4b.local-manager-desktop-poll-backoff.v1",
                backoff_until_utc = boundedUntil.ToUniversalTime().ToString("O"),
                failure_count = Math.Clamp(failureCount, 1, 10),
                secrets_included = false
            });
            var temporary = _statePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, payload, Encoding.UTF8);
            try { File.Move(temporary, _statePath, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return true;
        }
        catch
        {
            // Keep the in-memory deadline, but do not claim restart durability.
            return false;
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

