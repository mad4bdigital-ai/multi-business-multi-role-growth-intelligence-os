-- Sprint 69: Declare bounded mutation policy for runtime verification and session archive smoke tools.
-- Safety: registry metadata only. No runtime verification run, archive smoke, provider call,
-- external send, credential access, transcript payload access, or secret material is executed.
-- Both tools already perform same-cycle readback; the descriptor now declares that policy explicitly.

UPDATE admin_platform_endpoint_tools
   SET tags='admin,runtime-verification,state_changing,readback,same_cycle_readback,no_secrets,api_control_plane',
       updated_at=CURRENT_TIMESTAMP
 WHERE tool_key='runtime_verification_run_create_api'
   AND is_enabled=1;

UPDATE admin_platform_endpoint_tools
   SET tags='release,session-archive,drive-writeback,activation-readback,smoke,rollover-smoke,read_write,readback,same_cycle_readback,cleanup_default_true,admin,no_secrets',
       updated_at=CURRENT_TIMESTAMP
 WHERE tool_key='release_session_archive_smoke'
   AND is_enabled=1;
