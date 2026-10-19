using System.Security.Cryptography;
using System.Drawing;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

// Staging-only local operator workflow. Never receives OAuth bearer or remote
// requests; original document is not modified. No arbitrary path is accepted
// by the OS-private MCP/Sidecar channels.
internal static class LocalDocumentEditForm
{
    internal static void ShowEditor(IWin32Window owner)
    {
        if (LocalManagerEnvironment.Name != "staging")
            throw new InvalidOperationException("Structural document editing is Staging-only.");

        using var sourcePicker = new OpenFileDialog {
            Title = "Choose a local DOCX, XLSX or PDF document",
            Filter = "Word / Excel / PDF (*.docx;*.xlsx;*.pdf)|*.docx;*.xlsx;*.pdf",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (sourcePicker.ShowDialog(owner) != DialogResult.OK) return;

        var source = Path.GetFullPath(sourcePicker.FileName);
        var extension = Path.GetExtension(source).ToLowerInvariant();
        if (extension is not (".docx" or ".xlsx" or ".pdf"))
            throw new InvalidOperationException("Only DOCX, XLSX and PDF files are supported.");

        // Read a source opened without following an attacker-supplied junction
        // in a remote RPC. This workflow is explicitly local and operator-driven.
        var attrs = File.GetAttributes(source);
        if ((attrs & FileAttributes.ReparsePoint) != 0 ||
            (attrs & FileAttributes.Directory) != 0)
            throw new InvalidOperationException("Reparse points and directories are not supported.");

        using var sourceStream = new FileStream(source, FileMode.Open, FileAccess.Read,
            FileShare.Read, 4096, FileOptions.SequentialScan);
        if (sourceStream.Length < 22 || sourceStream.Length > 8 * 1024 * 1024)
            throw new InvalidOperationException("Document exceeds the Staging size limit.");
        var original = new byte[(int)sourceStream.Length];
        sourceStream.ReadExactly(original);
        var expected = Convert.ToHexString(SHA256.HashData(original));

        using var editor = new Form {
            Text = "Local structural document edit (Staging)",
            StartPosition = FormStartPosition.CenterParent,
            Size = new Size(560, 370),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false,
        };
        var instructions = new Label {
            Text = extension == ".docx"
                ? "Replace ONE exact Word text run. Split runs are refused."
                : extension == ".xlsx" ? "Replace ONE existing inline-string cell. Formula cells are refused."
                : "Edit PDF title and optional page rotation. Signed and protected PDFs are refused.",
            Location = new Point(16, 14), Size = new Size(520, 45),
        };
        var sheetLabel = new Label { Text = extension == ".pdf" ? "Page number (0 = none) / Rotation degrees (0, 90, 180, 270)" : "Worksheet XML path / Cell (Excel only)", Location = new Point(16, 65),
            Size = new Size(520, 21) };
        var sheet = new TextBox { Text = extension == ".pdf" ? "0" : "xl/worksheets/sheet1.xml", Location = new Point(16, 88),
            Width = 350, Enabled = extension != ".docx", MaxLength = 80 };
        var cell = new TextBox { Text = extension == ".pdf" ? "0" : "A1", Location = new Point(382, 88), Width = 140,
            Enabled = extension != ".docx", MaxLength = 12 };
        var oldLabel = new Label { Text = extension == ".pdf" ? "Existing PDF title (blank if none)" : "Exact existing text", Location = new Point(16, 126),
            Size = new Size(520, 22) };
        var oldText = new TextBox { Location = new Point(16, 150), Width = 506, MaxLength = 2048 };
        var newLabel = new Label { Text = extension == ".pdf" ? "New PDF title" : "New text", Location = new Point(16, 190),
            Size = new Size(520, 22) };
        var newText = new TextBox { Location = new Point(16, 214), Width = 506, MaxLength = 2048 };
        var apply = new Button { Text = "Prepare local copy", DialogResult = DialogResult.OK,
            Location = new Point(310, 265), Size = new Size(210, 42) };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel,
            Location = new Point(16, 265), Size = new Size(120, 42) };
        editor.Controls.AddRange(new Control[] { instructions, sheetLabel, sheet, cell,
            oldLabel, oldText, newLabel, newText, apply, cancel });
        editor.AcceptButton = apply; editor.CancelButton = cancel;
        if (editor.ShowDialog(owner) != DialogResult.OK) return;

        byte[] updated;
        try
        {
            updated = extension == ".docx"
                ? DocumentStructuralEditor.ReplaceDocxRun(
                    original, expected, oldText.Text, newText.Text)
                : extension == ".xlsx"
                    ? DocumentStructuralEditor.ReplaceXlsxInlineCell(
                        original, expected, sheet.Text, cell.Text, oldText.Text, newText.Text)
                    : PdfStructuralEditor.ChangeTitleAndRotation(
                        original, expected, oldText.Text, newText.Text,
                        int.Parse(sheet.Text), int.Parse(cell.Text));
        }
        catch (Exception ex) when (ex is InvalidDataException or NotSupportedException or FormatException or OverflowException or InvalidOperationException)
        {
            MessageBox.Show(owner, "The document cannot be edited with the restricted structural editor. " +
                "Only an exact unambiguous edit is accepted.", "Edit refused",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var newDigest = Convert.ToHexString(SHA256.HashData(updated));
        if (MessageBox.Show(owner,
            "Review and save an additional local copy. The original file will stay unchanged.\n" +
            "Source SHA256: " + expected + "\nResult SHA256: " + newDigest,
            "Approve the exact local edit", MessageBoxButtons.OKCancel,
            MessageBoxIcon.Question) != DialogResult.OK) return;

        using var outputPicker = new SaveFileDialog {
            Title = "Save a new edited copy (original is preserved)",
            Filter = extension == ".docx" ? "Word document (*.docx)|*.docx"
                   : extension == ".xlsx" ? "Excel workbook (*.xlsx)|*.xlsx"
                   : "PDF document (*.pdf)|*.pdf",
            AddExtension = true, OverwritePrompt = true,
            FileName = Path.GetFileNameWithoutExtension(source) + ".edited" + extension,
        };
        if (outputPicker.ShowDialog(owner) != DialogResult.OK) return;
        var output = Path.GetFullPath(outputPicker.FileName);
        if (!String.Equals(Path.GetExtension(output), extension, StringComparison.OrdinalIgnoreCase) ||
            String.Equals(output, source, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The destination must be a distinct document of the same type.");
        var parent = new DirectoryInfo(Path.GetDirectoryName(output)!);
        if (!parent.Exists || (parent.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Reparse-point destination folders are not allowed.");

        // Revalidate the source before creating the new copy.
        using (var check = new FileStream(source, FileMode.Open, FileAccess.Read,
                   FileShare.Read, 4096, FileOptions.SequentialScan))
        {
            if (check.Length != original.Length ||
                !CryptographicOperations.FixedTimeEquals(
                    SHA256.HashData(check), SHA256.HashData(original)))
                throw new InvalidOperationException("Source document changed during review.");
        }

        // CreateNew never overwrites an existing file, regardless of picker UI.
        using (var save = new FileStream(output, FileMode.CreateNew, FileAccess.Write,
                   FileShare.None, 4096, FileOptions.WriteThrough))
        {
            save.Write(updated);
            save.Flush(flushToDisk: true);
        }
        MessageBox.Show(owner, "An edited local copy was created. No original was overwritten.",
            "Staging document edit", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
