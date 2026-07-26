import assert from 'node:assert/strict';
import fs from 'node:fs';

const desktopRoutes = fs.readFileSync(new URL('./routes/localManagerDesktopCommandRoutes.js', import.meta.url), 'utf8');
const program = fs.readFileSync(new URL('../apps/local-manager-windows/Program.cs', import.meta.url), 'utf8');
const aliasMigration = fs.readFileSync(new URL('./migrations/143_sprint64_local_manager_desktop_device_aliases.sql', import.meta.url), 'utf8');

assert(desktopRoutes.includes('codex_exec_readonly'));
assert(desktopRoutes.includes('codex_readonly_sandbox_required'));
assert(desktopRoutes.includes('codex_prompt_required'));
assert(desktopRoutes.includes('codex_command_path_blocked'));
assert(desktopRoutes.includes('sandbox=read-only'));
assert(desktopRoutes.includes('secrets_included = false'));
assert(desktopRoutes.includes('resolveDesktopCommandDeviceIds'));
assert(desktopRoutes.includes('local_connector_device_aliases'));
assert(desktopRoutes.includes('device_id IN (${devicePlaceholders})'));

assert(aliasMigration.includes("`device_id` = 'essam-pc'"));
assert(aliasMigration.includes("'ESSAM'"));
assert(aliasMigration.includes("'Essam'"));
assert(aliasMigration.includes("'essam-pc'"));
assert(aliasMigration.includes('ON DUPLICATE KEY UPDATE'));

assert(program.includes('ExecuteCodexReadOnlyCommandAsync'));
assert(program.includes('codex_exec_readonly'));
assert(program.includes('process.StartInfo.ArgumentList'));
assert(program.includes('ArgumentList.Add("exec")'));
assert(program.includes('ArgumentList.Add("--sandbox")'));
assert(program.includes('ArgumentList.Add("read-only")'));
assert(program.includes('ArgumentList.Add("--ephemeral")'));
assert(program.includes('ArgumentList.Add("-o")'));
assert(program.includes('RedactLocalCommandOutput'));
assert(program.includes('TailText'));
assert(program.includes('auto_mutate_repo = false'));
assert(program.includes('secrets_included = false'));
assert(!program.includes('--dangerously-bypass-approvals-and-sandbox'));
assert(!program.includes('danger-full-access'));
assert(!program.includes('git push'));
assert(!program.includes('git commit'));
assert(!program.includes('apply_patch'));

console.log('local manager codex read-only contract tests passed');
