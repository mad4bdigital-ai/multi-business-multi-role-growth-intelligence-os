namespace Mad4B.LocalManager.Windows;

internal static class LocalManagerUpdateHandoff
{
    internal static string BuildScript(string installerPath, string appPath, int currentPid)
    {
        static string Clean(string value) => String.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException("Updater path is required.")
            : value.Replace("\"", String.Empty).Replace("\r", String.Empty).Replace("\n", String.Empty);

        var installer = Clean(installerPath);
        var app = Clean(appPath);
        var staged = app + ".next";
        var backup = app + ".previous";

        return string.Join("\r\n", new[]
        {
            "@echo off",
            "setlocal EnableExtensions",
            $"set \"INSTALLER={installer}\"",
            $"set \"APP={app}\"",
            $"set \"STAGED={staged}\"",
            $"set \"BACKUP={backup}\"",
            $"set \"PID={currentPid}\"",
            "echo Updating Mad4B Local Manager...",
            "timeout /t 1 /nobreak >nul",
            "taskkill /PID %PID% /T /F >nul 2>nul",
            "for /l %%i in (1,1,30) do ( tasklist /fi \"PID eq %PID%\" | find \"%PID%\" >nul || goto app_stopped & timeout /t 1 /nobreak >nul )",
            ":app_stopped",
            "del /q \"%STAGED%\" >nul 2>nul",
            "copy /y \"%INSTALLER%\" \"%STAGED%\" >nul",
            "if errorlevel 1 goto stage_failed",
            "fc /b \"%INSTALLER%\" \"%STAGED%\" >nul",
            "if errorlevel 1 goto stage_failed",
            "del /q \"%BACKUP%\" >nul 2>nul",
            "move /y \"%APP%\" \"%BACKUP%\" >nul",
            "if errorlevel 1 goto backup_failed",
            "move /y \"%STAGED%\" \"%APP%\" >nul",
            "if errorlevel 1 goto replace_failed",
            "\"%APP%\" --update-self-test",
            "if errorlevel 1 goto self_test_failed",
            "start \"\" \"%APP%\"",
            "exit /b 0",
            ":self_test_failed",
            "del /q \"%APP%\" >nul 2>nul",
            "move /y \"%BACKUP%\" \"%APP%\" >nul",
            "start \"\" \"%APP%\"",
            "exit /b 1",
            ":replace_failed",
            "move /y \"%BACKUP%\" \"%APP%\" >nul",
            "del /q \"%STAGED%\" >nul 2>nul",
            "start \"\" \"%APP%\"",
            "exit /b 1",
            ":backup_failed",
            "del /q \"%STAGED%\" >nul 2>nul",
            "start \"\" \"%APP%\"",
            "exit /b 1",
            ":stage_failed",
            "del /q \"%STAGED%\" >nul 2>nul",
            "exit /b 1",
        }) + "\r\n";
    }
}
