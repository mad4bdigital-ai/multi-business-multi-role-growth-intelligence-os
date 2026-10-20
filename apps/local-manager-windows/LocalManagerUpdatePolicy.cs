using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mad4B.LocalManager.Windows;

internal static class LocalManagerUpdatePolicy
{
    internal static Uri ValidateArtifact(string? value, string? environment)
    {
        if (environment != LocalManagerEnvironment.Name)
            throw new InvalidOperationException("Update metadata does not match this application environment.");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || uri.Host != "github.com" || !uri.IsDefaultPort
            || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("Update artifact origin is not allowed.");
        const string prefix = "/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/";
        var channel = LocalManagerEnvironment.Name == "staging" ? "local-manager-windows-staging" : "local-manager-windows-latest";
        if (!uri.AbsolutePath.StartsWith(prefix + channel + "/", StringComparison.Ordinal)
            || !uri.AbsolutePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Update artifact does not match this release channel.");
        return uri;
    }
    internal static string ValidateHash(string? hash)
    {
        if (hash is null || !Regex.IsMatch(hash, "\\A[a-fA-F0-9]{64}\\z"))
            throw new InvalidOperationException("A valid SHA256 checksum is required before installing an update.");
        return hash;
    }
    internal static string ReadHash(JsonElement checksum)
    {
        foreach (var property in checksum.EnumerateObject())
            if (property.Name.Equals("Hash", StringComparison.OrdinalIgnoreCase)) return ValidateHash(property.Value.GetString());
        throw new InvalidOperationException("Release checksum metadata is missing its hash.");
    }
    internal static async Task VerifyFileAsync(string path, string expectedHash)
    {
        ValidateHash(expectedHash);
        await using var stream = File.OpenRead(path);
        var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream));
        if (!actual.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Downloaded update failed SHA256 verification. The existing application was not replaced.");
    }
}
