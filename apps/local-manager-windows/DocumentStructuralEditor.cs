using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace Mad4B.LocalManager.Windows;

// Pure, bounded structural OOXML transform. Does NOT write the user's file:
// the separate OS-private, consented atomic writer must perform that step.
internal static class DocumentStructuralEditor
{
    private const int MaxPackageBytes = 8 * 1024 * 1024;
    private const long MaxExpandedBytes = 24 * 1024 * 1024;
    private const int MaxEntries = 200;
    private static readonly XNamespace Word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace Sheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    internal static byte[] ReplaceDocxRun(
        byte[] input, string expectedSha256, string oldText, string newText)
    {
        ValidateInput(input, expectedSha256, oldText, newText);
        return Transform(input, "word/document.xml", doc =>
        {
            if (doc.Root?.Name != Word + "document")
                throw new InvalidDataException("Word XML root is invalid.");
            var matches = doc.Descendants(Word + "t").Where(el => el.Value == oldText).Take(2).ToArray();
            if (matches.Length != 1)
                throw new InvalidDataException("Expected one exact Word text run; split runs cannot be edited.");
            matches[0].Value = newText;
        }, requiredMarker: "word/document.xml");
    }

    internal static byte[] ReplaceXlsxInlineCell(
        byte[] input, string expectedSha256, string sheetPath, string cellAddress,
        string expectedText, string newText)
    {
        ValidateInput(input, expectedSha256, expectedText, newText);
        if (string.IsNullOrEmpty(sheetPath) ||
            !Regex.IsMatch(sheetPath, @"^xl/worksheets/sheet[1-9][0-9]{0,2}\.xml$", RegexOptions.CultureInvariant) ||
            !Regex.IsMatch(cellAddress ?? "", @"^[A-Z]{1,3}[1-9][0-9]{0,6}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("Exact worksheet path and A1 address are required.");

        return Transform(input, sheetPath, doc =>
        {
            if (doc.Root?.Name != Sheet + "worksheet")
                throw new InvalidDataException("Spreadsheet XML root is invalid.");
            var cells = doc.Descendants(Sheet + "c")
                .Where(el => (string?)el.Attribute("r") == cellAddress).Take(2).ToArray();
            if (cells.Length != 1 || (string?)cells[0].Attribute("t") != "inlineStr" ||
                cells[0].Element(Sheet + "f") != null)
                throw new InvalidDataException("Only one existing inline-string cell without formula is editable.");
            var textRuns = cells[0].Element(Sheet + "is")?.Elements(Sheet + "t").ToArray();
            if (textRuns is null || textRuns.Length != 1 || textRuns[0].Value != expectedText)
                throw new InvalidDataException("Cell text is split, changed, or missing.");
            textRuns[0].Value = newText;
        }, requiredMarker: "xl/workbook.xml");
    }

    internal static void RejectPdfStructuralEdit()
        => throw new NotSupportedException("PDF needs a separately certified parser and transactional adapter.");

    private static void ValidateInput(byte[] input, string expectedSha256, string oldText, string newText)
    {
        if (input is null || input.Length < 22 || input.Length > MaxPackageBytes ||
            string.IsNullOrEmpty(expectedSha256) ||
            !Regex.IsMatch(expectedSha256, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant) ||
            !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(expectedSha256), SHA256.HashData(input)))
            throw new InvalidDataException("Document size or exact SHA-256 mismatch.");
        if (string.IsNullOrEmpty(oldText) || oldText.Length > 2048 ||
            newText is null || newText.Length > 2048 ||
            newText.Any(ch => !XmlConvert.IsXmlChar(ch)))
            throw new InvalidDataException("Text is absent, too long, or invalid XML.");
    }

    private static byte[] Transform(byte[] input, string target,
        Action<XDocument> update, string requiredMarker)
    {
        using var src = new MemoryStream(input, writable: false);
        using var zipped = new ZipArchive(src, ZipArchiveMode.Read, leaveOpen: true);
        if (zipped.Entries.Count < 3 || zipped.Entries.Count > MaxEntries ||
            !zipped.Entries.Any(e => e.FullName == "[Content_Types].xml") ||
            !zipped.Entries.Any(e => e.FullName == requiredMarker))
            throw new InvalidDataException("OOXML package required parts are missing.");

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long expanded = 0;
        foreach (var entry in zipped.Entries)
        {
            var name = entry.FullName;
            if (string.IsNullOrWhiteSpace(name) || name.StartsWith('/') ||
                name.Contains('\\') || name.Contains(':') ||
                name.Split('/').Any(p => p is "." or "..") || !paths.Add(name) ||
                entry.Length < 0 || entry.Length > MaxPackageBytes ||
                entry.CompressedLength < 0 || entry.CompressedLength > MaxPackageBytes ||
                (expanded += entry.Length) > MaxExpandedBytes)
                throw new InvalidDataException("Unsafe ZIP entries or expansion limit exceeded.");
            // ZIP Unix symlink entries must never be followed or transformed.
            if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                throw new InvalidDataException("Symlink entries are not permitted.");
        }
        var oldPart = zipped.GetEntry(target)
            ?? throw new InvalidDataException("Target XML part is absent.");
        if (oldPart.Length > 4 * 1024 * 1024)
            throw new InvalidDataException("XML part exceeds the allowed size.");

        XDocument xml;
        using (var part = oldPart.Open())
        using (var reader = XmlReader.Create(part, new XmlReaderSettings {
            DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
            MaxCharactersInDocument = 4 * 1024 * 1024
        }))
            xml = XDocument.Load(reader, LoadOptions.PreserveWhitespace);

        update(xml);
        using var output = new MemoryStream();
        using (var dest = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var entry in zipped.Entries)
            {
                var next = dest.CreateEntry(entry.FullName, CompressionLevel.Optimal);
                next.LastWriteTime = entry.LastWriteTime;
                using var writer = next.Open();
                if (entry.FullName == target)
                {
                    using var temp = new MemoryStream();
                    using (var xmlWriter = XmlWriter.Create(temp, new XmlWriterSettings {
                        Encoding = new UTF8Encoding(false), CloseOutput = false
                    })) xml.Save(xmlWriter);
                    if (temp.Length > 4 * 1024 * 1024)
                        throw new InvalidDataException("Resulting XML part exceeds size budget.");
                    temp.Position = 0;
                    temp.CopyTo(writer);
                }
                else using (var reader = entry.Open()) reader.CopyTo(writer);
            }
        }
        if (output.Length > MaxPackageBytes)
            throw new InvalidDataException("Edited package exceeds size budget.");
        return output.ToArray();
    }
}
