using System.Security.Cryptography;
using System.Text.Json;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private static void Main()
    {
        const string sessionId = "cross-runtime-session";
        const string displayCode = "ABCD-EFGH";
        const string pollToken = "cross-runtime-poll-token";
        const string challenge = "cross-runtime-challenge";

        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var publicKey = key.ExportSubjectPublicKeyInfo();
        var canonical = DeviceProofCrypto.BuildCanonical(sessionId, displayCode, pollToken, challenge);
        var derSignature = DeviceProofCrypto.SignDerBase64(key, canonical);
        var p1363Signature = Convert.ToBase64String(key.SignData(
            System.Text.Encoding.UTF8.GetBytes(canonical),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            contract = DeviceProofCrypto.Contract,
            session_id = sessionId,
            display_code = displayCode,
            poll_token = pollToken,
            challenge,
            canonical,
            public_key_spki = Convert.ToBase64String(publicKey),
            public_key_fingerprint_sha256 = Convert.ToHexString(SHA256.HashData(publicKey)).ToLowerInvariant(),
            signature_der = derSignature,
            signature_ieee_p1363 = p1363Signature,
            secrets_included = false
        }));
    }
}
