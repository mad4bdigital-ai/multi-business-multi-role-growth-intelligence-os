// Credential-free Windows SCM service skeleton for STAGING ONLY.
// This assembly intentionally has no IPC, SQL, secrets, network or privileged
// operation handlers. It is not a DBA Broker and cannot accept owner tickets.
using System;
using System.ServiceProcess;
internal sealed class StagingBackupBrokerHost : ServiceBase {
  internal const string CanonicalServiceName = "Mad4B-Staging-Backup-Db-Broker";
  internal StagingBackupBrokerHost() {
    ServiceName = CanonicalServiceName;
    CanStop = true;
    CanShutdown = true;
    CanPauseAndContinue = false;
    AutoLog = false;
  }
  protected override void OnStart(string[] args) {
    // No work. Must not open a port, read credentials, spawn a child or
    // load the DBA broker core until separately authorized code exists.
    if (args != null && args.Length != 0)
      throw new InvalidOperationException("BROKER_HOST_START_ARGUMENTS_DENIED");
  }
  protected override void OnStop() { }
  private static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--self-test") {
      Console.WriteLine(
        "{\"contract\":\"mad4b.staging.backup-broker.os-service-host.v1\","+
        "\"mode\":\"inert_no_io\",\"service_name\":\""+
        CanonicalServiceName+"\",\"operational_broker\":false,"+
        "\"db_admin_authorized\":false,\"secrets_included\":false,"+
        "\"backup_executed\":false,\"production_mutation\":false}");
      return 0;
    }
    if (args.Length != 0 || Environment.UserInteractive) {
      Console.Error.WriteLine("BROKER_HOST_SERVICE_CONTROL_MANAGER_ONLY");
      return 2;
    }
    ServiceBase.Run(new StagingBackupBrokerHost());
    return 0;
  }
}
