using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal sealed class DeviceIdentityStore
{
    private const string EntropyValue = "mad4b-local-manager-device-token-v1";

    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    internal DeviceIdentityStore(string? installRoot = null)
    {
        InstallRoot = installRoot ?? DefaultInstallRoot;
    }

    internal static string DefaultInstallRoot =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Mad4B",
            "LocalManager");

    internal string InstallRoot { get; }

    internal string LinkStatusPath => Path.Combine(InstallRoot, "device-link-status.json");

    internal string ProtectedTokenPath => Path.Combine(InstallRoot, "device-token.dpapi");

    internal bool TokenFileExists => File.Exists(ProtectedTokenPath);

    internal void Save(string token, string? deviceId, string? status)
    {
        Directory.CreateDirectory(InstallRoot);
        var plaintext = Encoding.UTF8.GetBytes(token);
        var entropy = Encoding.UTF8.GetBytes(EntropyValue);
        var protectedBytes = ProtectedData.Protect(plaintext, entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(ProtectedTokenPath, protectedBytes);
        File.WriteAllText(LinkStatusPath, JsonSerializer.Serialize(new
        {
            linked = true,
            linked_at = DateTimeOffset.UtcNow,
            device_id = deviceId,
            status,
            token_persisted = true,
            token_storage = "Windows DPAPI CurrentUser",
            token_file = ProtectedTokenPath,
            secrets_included = false
        }, _json));
    }

    internal string? Load(out string? error)
    {
        error = null;
        try
        {
            if (!TokenFileExists) return null;
            var protectedBytes = File.ReadAllBytes(ProtectedTokenPath);
            var entropy = Encoding.UTF8.GetBytes(EntropyValue);
            var plaintext = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return null;
        }
    }

    internal void Delete()
    {
        if (TokenFileExists) File.Delete(ProtectedTokenPath);
        if (File.Exists(LinkStatusPath)) File.Delete(LinkStatusPath);
    }
}
