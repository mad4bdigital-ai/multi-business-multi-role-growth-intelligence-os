using System.Security.Cryptography;
using System.Text.Json;
using Mad4B.LocalManager.Windows;
static void Assert(bool result,string message) { if(!result) throw new Exception(message); }
static void Reject(Action action) { try { action(); } catch(InvalidOperationException) { return; } throw new Exception("Unsafe update accepted."); }
var staging=LocalManagerEnvironment.Name=="staging";
Assert(LocalManagerEnvironment.BaseUrl==(staging?"https://dev.mad4b.com":"https://auth.mad4b.com"),"Wrong origin");
Assert(LocalManagerEnvironment.StorageFolder==(staging?"LocalManager-Staging":"LocalManager"),"Credential isolation failed");
const string prefix="https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/";
var own=prefix+(staging?"local-manager-windows-staging":"local-manager-windows-latest")+"/setup.exe";
var other=prefix+(staging?"local-manager-windows-latest":"local-manager-windows-staging")+"/setup.exe";
Assert(LocalManagerUpdatePolicy.ValidateArtifact(own,LocalManagerEnvironment.Name).AbsoluteUri==own,"Own release rejected");
Reject(()=>LocalManagerUpdatePolicy.ValidateArtifact(other,LocalManagerEnvironment.Name));
Reject(()=>LocalManagerUpdatePolicy.ValidateArtifact(own,staging?"production":"staging"));
Reject(()=>LocalManagerUpdatePolicy.ValidateArtifact(own.Replace("github.com","github.com.example.org"),LocalManagerEnvironment.Name));
Reject(()=>LocalManagerUpdatePolicy.ValidateArtifact(own+"?redirect=other",LocalManagerEnvironment.Name));
Reject(()=>LocalManagerUpdatePolicy.ValidateHash(""));
Reject(()=>LocalManagerUpdatePolicy.ValidateHash(new string('a',63)));
var handoff=LocalManagerUpdateHandoff.BuildScript(@"C:\updates\new.exe",@"C:\Apps\LocalManager.exe",1234);
Assert(handoff.Contains(@"set ""STAGED=C:\Apps\LocalManager.exe.next"""),"Update is not staged.");
Assert(handoff.Contains(@"set ""BACKUP=C:\Apps\LocalManager.exe.previous"""),"Previous version is not retained.");
Assert(handoff.Contains(@"fc /b ""%INSTALLER%"" ""%STAGED%"""),"Staged bytes are not verified.");
Assert(handoff.Contains(@"--update-self-test"),"Updated executable is not self-tested.");
Assert(handoff.Contains(@"move /y ""%BACKUP%"" ""%APP%"""),"Rollback path is missing.");
Assert(!handoff.Contains(@"copy /y ""%INSTALLER%"" ""%APP%"""),"Direct executable overwrite remains.");
var path=Path.GetTempFileName();
try {
    await File.WriteAllTextAsync(path,"fixture executable bytes");
    var hash=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)));
    using var document=JsonDocument.Parse(JsonSerializer.Serialize(new {Hash=hash,Algorithm="SHA256"}));
    Assert(LocalManagerUpdatePolicy.ReadHash(document.RootElement)==hash,"Checksum format rejected");
    await LocalManagerUpdatePolicy.VerifyFileAsync(path,hash);
    await File.AppendAllTextAsync(path,"tampered");
    var rejected=false;
    try { await LocalManagerUpdatePolicy.VerifyFileAsync(path,hash); } catch(InvalidOperationException) { rejected=true; }
    Assert(rejected,"Corrupted update accepted");
} finally { File.Delete(path); }
Console.WriteLine($"Local Manager {LocalManagerEnvironment.Name}: profile isolation and update integrity passed.");
