import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktopRoutes = readFileSync(new URL('./routes/localManagerDesktopCommandRoutes.js', import.meta.url), 'utf8');
const program = readFileSync(new URL('../apps/local-manager-windows/Program.cs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/235_sprint68_local_manager_chatgpt_url_capture_action.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const runner = readFileSync(new URL('./scripts/governed-migration-runner.mjs', import.meta.url), 'utf8');

assert.ok(desktopRoutes.includes('capture_chatgpt_current_url'));
assert.ok(desktopRoutes.includes('chatgpt_capture_session_required'));
assert.ok(desktopRoutes.includes('activation_session_context.current_session_id'));
assert.ok(desktopRoutes.includes('Capture the active ChatGPT conversation URL'));
assert.ok(desktopRoutes.includes('do not return page content, cookies, tokens, or secrets'));
assert.ok(desktopRoutes.includes('clean.session_id'));
assert.ok(desktopRoutes.includes('clean.capture_endpoint'));
assert.ok(desktopRoutes.includes('secrets_included = false'));

assert.ok(program.includes('CaptureChatGptCurrentUrlCommandAsync'));
assert.ok(program.includes('capture_chatgpt_current_url'));
assert.ok(program.includes('PromptForChatGptUrl'));
assert.ok(program.includes('LooksLikeChatGptConversationUrl'));
assert.ok(program.includes('Clipboard.ContainsText'));
assert.ok(program.includes('current_url = currentUrl'));
assert.ok(program.includes('next_tool = "gpt_session_conversation_ref_capture_current"'));
assert.ok(program.includes('page_content_included = false'));
assert.ok(program.includes('cookies_included = false'));
assert.ok(program.includes('secrets_included = false'));
assert.ok(program.includes('/share/'));
assert.ok(program.includes('/c/'));

assert.ok(migration.includes('capture_chatgpt_current_url'));
assert.ok(migration.includes('local_manager_desktop_command_enqueue'));
assert.ok(migration.includes('chatgpt_url_capture'));
assert.ok(migration.includes('no raw transcript/page content capture'));
assert.match(migration, /JSON_SET\(\r?\n  `input_schema`,/);
assert.doesNotMatch(migration, /CAST\(`input_schema` AS JSON\)/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes('235_sprint68_local_manager_chatgpt_url_capture_action.sql'));

console.log('local manager ChatGPT URL capture contract tests passed');
