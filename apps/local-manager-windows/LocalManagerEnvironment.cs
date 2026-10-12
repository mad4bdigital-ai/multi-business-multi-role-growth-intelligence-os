namespace Mad4B.LocalManager.Windows;

// Selected at build time, never through a caller-provided URL.
internal static class LocalManagerEnvironment
{
#if LOCAL_MANAGER_STAGING
    internal const string Name = "staging";
    internal const string BaseUrl = "https://dev.mad4b.com";
    internal const string StorageFolder = "LocalManager-Staging";
    internal const string Suffix = ".Staging";
    internal const string DisplaySuffix = " (Staging)";
#else
    internal const string Name = "production";
    internal const string BaseUrl = "https://auth.mad4b.com";
    internal const string StorageFolder = "LocalManager";
    internal const string Suffix = "";
    internal const string DisplaySuffix = "";
#endif
}
