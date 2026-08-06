const fs = require('node:fs');

const target = '.github/scripts/pr6429-ddl-shared-gate-boundary-fix.cjs';
let source = fs.readFileSync(target, 'utf8');
const startMarker = '  const newBoundary = String.raw`';
const endMarker = '`;\n  workflow = workflow.slice(0, startIndex)';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error('newBoundary template markers not found');
const bodyStart = start + startMarker.length;
const body = source.slice(bodyStart, end);
if (!body.includes('${{ github.event.pull_request.base.sha }}')) throw new Error('GitHub expression marker missing');
const escaped = body.replaceAll('${', '\\${');
source = source.slice(0, bodyStart) + escaped + source.slice(end);
fs.writeFileSync(target, source);
console.log(JSON.stringify({ ok: true, escaped_template_expressions: (body.match(/\$\{/g) || []).length }));
