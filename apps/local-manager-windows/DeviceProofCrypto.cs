using System.Security.Cryptography;
using System.Text;

namespace Mad4B.LocalManager.Windows;

internal static class DeviceProofCrypto
{
    internal const string Contract = "mad4b.local-manager.device-proof.v1";

    internal static string BuildCanonical(
        string sessionId,
        string deviceCode,
        string pollToken,
        string challenge)
    {
        var pollTokenHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(pollToken))).ToLowerInvariant();
        return string.Join(
            "\n",
            Contract,
            sessionId,
            deviceCode.Trim().ToUpperInvariant(),
            pollTokenHash,
            challenge);
    }

    internal static string SignDerBase64(ECDsa key, string canonical)
    {
        var signature = key.SignData(
            Encoding.UTF8.GetBytes(canonical),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);
        return Convert.ToBase64String(signature);
    }
}
