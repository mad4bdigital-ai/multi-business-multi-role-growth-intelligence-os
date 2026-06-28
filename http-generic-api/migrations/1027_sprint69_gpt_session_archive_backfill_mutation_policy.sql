-- Sprint 69: GPT session archive backfill mutation policy descriptor repair.
-- Safety: registry metadata only. No archive execution, provider call, external send,
-- credential access, destructive SQL, transcript content access, or secret material.

UPDATE admin_platform_endpoint_tools
   SET tags='release,session-archive,backfill,jsonl,drive-writeback,read_write,admin,no_secrets,dry_run_default_true,dry_run_default,readback',
       updated_at=CURRENT_TIMESTAMP
 WHERE tool_key='gpt_session_archive_backfill'
   AND is_enabled=1;
