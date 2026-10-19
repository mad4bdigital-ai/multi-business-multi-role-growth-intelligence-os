using System.Security.Cryptography;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Mad4B.LocalManager.Windows;

// Bounded in-memory structural PDF edits, not content-stream text replacement.
// All writes are local user-confirmed NEW files. Owner-password/encrypted and
// signed/interactive PDF documents are excluded rather than weakened.
internal static class PdfStructuralEditor
{
    private const int MaximumPdfBytes = 8 * 1024 * 1024;
    private const int MaximumPages = 1000;

    internal static byte[] ChangeTitleAndRotation(
        byte[] source, string expectedSha256, string expectedTitle, string replacementTitle,
        int pageNumber, int rotationDegrees)
    {
        if (source is null || source.Length < 16 || source.Length > MaximumPdfBytes ||
            !source.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ||
            string.IsNullOrEmpty(expectedSha256) ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                expectedSha256, "^[a-fA-F0-9]{64}$") ||
            !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(source), Convert.FromHexString(expectedSha256)))
            throw new InvalidDataException("Source is not a bounded PDF with the expected digest.");
        if (expectedTitle is null || replacementTitle is null ||
            expectedTitle.Length > 1024 || replacementTitle.Length > 1024 ||
            replacementTitle.Any(char.IsControl))
            throw new InvalidDataException("PDF title is invalid.");
        if ((pageNumber == 0 && rotationDegrees != 0) ||
            (pageNumber != 0 && rotationDegrees is not (0 or 90 or 180 or 270)))
            throw new InvalidDataException("Invalid PDF page rotation.");
        // Conservative protection: do not edit potentially signed, interactive
        // or encrypted documents in the first staged implementation. The PDF
        // parser enforces owner permissions when opening in Modify mode.
        var header = System.Text.Encoding.Latin1.GetString(source);
        if (header.Contains("/ByteRange", StringComparison.Ordinal) ||
            header.Contains("/Encrypt", StringComparison.Ordinal) ||
            header.Contains("/AcroForm", StringComparison.Ordinal))
            throw new NotSupportedException("Protected, signed and form PDFs are not editable.");
        using var input = new MemoryStream(source, writable: false);
        using var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        if (document.PageCount < 1 || document.PageCount > MaximumPages ||
            (pageNumber != 0 && (pageNumber < 1 || pageNumber > document.PageCount)))
            throw new InvalidDataException("Page selection exceeds PDF limits.");
        if (!string.Equals(document.Info.Title, expectedTitle, StringComparison.Ordinal))
            throw new InvalidDataException("PDF title changed since the preview.");
        document.Info.Title = replacementTitle;
        if (pageNumber > 0) document.Pages[pageNumber - 1].Rotate = rotationDegrees;
        // PDFsharp invalidates its mutable object graph after Save.
        // Record the expected page count before writing the stream.
        var originalPageCount = document.PageCount;
        using var output = new MemoryStream();
        document.Save(output, false);
        if (output.Length > MaximumPdfBytes)
            throw new InvalidDataException("Result PDF exceeded the size limit.");
        // Reparse output to ensure structural validity; no acceptance on magic alone.
        output.Position = 0;
        using var verification = PdfReader.Open(output, PdfDocumentOpenMode.Import);
        if (verification.PageCount != originalPageCount ||
            verification.Info.Title != replacementTitle ||
            (pageNumber > 0 && verification.Pages[pageNumber - 1].Rotate != rotationDegrees))
            throw new InvalidDataException("PDF structural roundtrip verification failed.");
        return output.ToArray();
    }
}
