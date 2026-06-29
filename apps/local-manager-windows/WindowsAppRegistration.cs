using System.Diagnostics;
using Microsoft.Win32;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class WindowsAppRegistration
{
    private const string UninstallRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Mad4B.LocalManager.Windows";
    private const string ProductName = "Mad4B Local Manager";
    private const string Publisher = "Mad4B Digital";

    internal static bool TryHandleCommandLine(string[] args, string executablePath)
    {
        if (!args.Any(arg => string.Equals(arg, "--uninstall", StringComparison.OrdinalIgnoreCase))) return false;
        var quiet = args.Any(arg => string.Equals(arg, "--quiet", StringComparison.OrdinalIgnoreCase));
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(UninstallRegistryPath, throwOnMissingSubKey: false);
            QueueSelfRemoval(executablePath);
            if (!quiet)
            {
                MessageBox.Show(
                    "Mad4B Local Manager was removed from Windows Installed Apps. Local application files are being deleted.",
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch (Exception ex)
        {
            if (!quiet)
            {
                MessageBox.Show(
                    "Mad4B Local Manager could not be fully uninstalled. " + ex.Message,
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
        return true;
    }

    internal static void EnsureRegistered(string installedExePath, string? productVersion)
    {
        var fullPath = Path.GetFullPath(installedExePath);
        if (!File.Exists(fullPath)) return;

        var version = (productVersion ?? "0.0.0").Split(new[] { '-', '+' }, 2)[0];
        var installRoot = Path.GetDirectoryName(fullPath) ?? throw new InvalidOperationException("Installed application folder was not resolved.");
        using var key = Registry.CurrentUser.CreateSubKey(UninstallRegistryPath, writable: true)
            ?? throw new InvalidOperationException("Windows uninstall registry key could not be created.");
        var quotedExe = "\"" + fullPath + "\"";
        var estimatedSizeKb = Math.Max(1L, new FileInfo(fullPath).Length / 1024L);

        key.SetValue("DisplayName", ProductName, RegistryValueKind.String);
        key.SetValue("DisplayVersion", version, RegistryValueKind.String);
        key.SetValue("Publisher", Publisher, RegistryValueKind.String);
        key.SetValue("DisplayIcon", fullPath + ",0", RegistryValueKind.String);
        key.SetValue("InstallLocation", installRoot, RegistryValueKind.String);
        key.SetValue("UninstallString", quotedExe + " --uninstall", RegistryValueKind.String);
        key.SetValue("QuietUninstallString", quotedExe + " --uninstall --quiet", RegistryValueKind.String);
        key.SetValue("URLInfoAbout", "https://auth.mad4b.com/app/local-manager", RegistryValueKind.String);
        key.SetValue("InstallDate", DateTime.UtcNow.ToString("yyyyMMdd"), RegistryValueKind.String);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, estimatedSizeKb), RegistryValueKind.DWord);
    }

    private static void QueueSelfRemoval(string executablePath)
    {
        var fullPath = Path.GetFullPath(executablePath);
        var installRoot = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(installRoot)) return;

        static string EscapePowerShellLiteral(string value) => value.Replace("'", "''", StringComparison.Ordinal);
        var command =
            "Start-Sleep -Milliseconds 1200; " +
            $"Remove-Item -LiteralPath '{EscapePowerShellLiteral(fullPath)}' -Force -ErrorAction SilentlyContinue; " +
            $"Remove-Item -LiteralPath '{EscapePowerShellLiteral(installRoot)}' -Recurse -Force -ErrorAction SilentlyContinue";
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-WindowStyle");
        startInfo.ArgumentList.Add("Hidden");
        startInfo.ArgumentList.Add("-Command");
        startInfo.ArgumentList.Add(command);
        Process.Start(startInfo);
    }
}
