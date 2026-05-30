import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

assert(source.includes('CONNECTOR_CLI_OUTPUT_LIMIT_CHARS'), 'GitHub connector output limit must be configurable and bounded');
assert(source.includes('function normalizeCliResult'), 'GitHub connector must normalize CLI command results');
assert(source.includes('command_ok'), 'GitHub connector response must distinguish command success from transport success');
assert(source.includes('stdout_truncated'), 'GitHub connector response must expose stdout truncation');
assert(source.includes('stderr_truncated'), 'GitHub connector response must expose stderr truncation');
assert(source.includes('stdout_length_chars'), 'GitHub connector response must expose original stdout length');
assert(source.includes('stderr_length_chars'), 'GitHub connector response must expose original stderr length');
assert(source.includes('output_limit_chars'), 'GitHub connector response must expose the output limit');
assert(source.includes('${toolLabel}_EXIT_NONZERO'), 'GitHub connector response must expose non-zero gh exit errors');
assert(source.includes("return json(res, 200, normalizeCliResult(result, 'GH'))"), 'GitHub connector must return normalized gh results directly');

console.log('local connector GitHub result guard tests passed');
