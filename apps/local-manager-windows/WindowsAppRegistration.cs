using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class WindowsAppRegistration
{
    private const string UninstallRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Mad4B.LocalManager.Windows";
    private const string AppPathsRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\App Paths\Mad4B-Local-Manager.exe";
    private const string ProductName = "Mad4B Local Manager";
    private const string Publisher = "Mad4B Digital";
    private const string ShortcutFileName = "Mad4B Local Manager.lnk";

    internal static bool TryHandleCommandLine(string[] args, string executablePath)
    {
        if (!args.Any(arg => string.Equals(arg, "--uninstall", StringComparison.OrdinalIgnoreCase))) return false;
        var quiet = args.Any(arg => string.Equals(arg, "--quiet", StringComparison.OrdinalIgnoreCase));
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(UninstallRegistryPath, throwOnMissingSubKey: false);
            Registry.CurrentUser.DeleteSubKeyTree(AppPathsRegistryPath, throwOnMissingSubKey: false);
            DeleteShortcut(Environment.SpecialFolder.Programs);
            DeleteShortcut(Environment.SpecialFolder.Startup);
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

        using var appPathKey = Registry.CurrentUser.CreateSubKey(AppPathsRegistryPath, writable: true)
            ?? throw new InvalidOperationException("Windows App Paths registry key could not be created.");
        appPathKey.SetValue("", fullPath, RegistryValueKind.String);
        appPathKey.SetValue("Path", installRoot, RegistryValueKind.String);

        CreateShortcut(Environment.SpecialFolder.Programs, fullPath, installRoot, "Open Mad4B Local Manager");
        CreateShortcut(Environment.SpecialFolder.Startup, fullPath, installRoot, "Start Mad4B Local Manager when signing in");
    }

    private static void CreateShortcut(Environment.SpecialFolder folder, string targetPath, string workingDirectory, string description)
    {
        var folderPath = Environment.GetFolderPath(folder);
        if (string.IsNullOrWhiteSpace(folderPath))
        {
            throw new InvalidOperationException($"Windows folder {folder} could not be resolved.");
        }

        Directory.CreateDirectory(folderPath);
        var shortcutPath = Path.Combine(folderPath, ShortcutFileName);
        var shellType = Type.GetTypeFromProgID("WScript.Shell")
            ?? throw new InvalidOperationException("Windows Script Host shortcut service is unavailable.");
        object? shell = null;
        object? shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType)
                ?? throw new InvalidOperationException("Windows Script Host shortcut service could not be created.");
            shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                binder: null,
                target: shell,
                args: new object[] { shortcutPath });
            if (shortcut is null) throw new InvalidOperationException("Windows shortcut object could not be created.");

            var shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath + ",0" });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            shortcutType.InvokeMember("WindowStyle", BindingFlags.SetProperty, null, shortcut, new object[] { 1 });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, Array.Empty<object>());
        }
        finally
        {
            if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void DeleteShortcut(Environment.SpecialFolder folder)
    {
        var folderPath = Environment.GetFolderPath(folder);
        if (string.IsNullOrWhiteSpace(folderPath)) return;
        var shortcutPath = Path.Combine(folderPath, ShortcutFileName);
        if (File.Exists(shortcutPath)) File.Delete(shortcutPath);
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
