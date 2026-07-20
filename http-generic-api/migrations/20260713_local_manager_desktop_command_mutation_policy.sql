-- Local Manager desktop command mutation descriptor contract.
-- Declares local approval and same-cycle status readback for state-changing
-- desktop commands. No device command, provider call, or external write is run.

UPDATE `admin_platform_endpoint_tools`
SET
  `description` = 'Queue a foreground desktop action for a linked Local Manager device. State-changing commands require explicit local confirmation where requested and same-cycle command-status readback. Connector repair runs inside the Windows app through the signed installer coordinator and UAC; it must not open a browser download.',
  `tags` = 'local_manager,device,desktop,state_changing,mutation_policy_required,approval_required,readback,same_cycle_readback,local_consent_required,audited,gpt_remote,connector_repair,app_managed_installer,interactive_user,no_repo_mutation,no_secrets',
  `updated_at` = CURRENT_TIMESTAMP
WHERE `tool_key` = 'local_manager_desktop_command_enqueue';
