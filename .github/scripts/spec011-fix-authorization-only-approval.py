from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".github" / "workflows" / "spec011-ephemeral-checkout-production-dry-run.yml"
WORKFLOW = ROOT / ".github" / "workflows" / "spec011-fix-authorization-only-approval.yml"
TRIGGER = ROOT / ".github" / "spec011-fix-authorization-only-approval-trigger.json"
SELF = Path(__file__).resolve()

source = TARGET.read_text(encoding="utf-8")

request_needle = '''          async function request(pathname, body) {
            const response = await fetch(`${BASE}${pathname}`, {
              method: 'POST',
              redirect: 'error',
              headers: {
                Authorization: `Bearer ${KEY}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(180000),
            });
            const text = await response.text();
            let payload;
            try { payload = text ? JSON.parse(text) : null; }
            catch { payload = { raw_preview: text.slice(0, 500) }; }
            const result = { status: response.status, http_ok: response.ok, payload };
            console.log(JSON.stringify(sanitize(result), null, 2));
            if (!response.ok || payload?.ok === false) {
              const error = new Error(`Governed runtime call failed for ${pathname} with HTTP ${response.status}`);
              error.code = payload?.error?.code || 'governed_runtime_call_failed';
              throw error;
            }
            return payload;
          }
'''

request_replacement = request_needle + '''
          async function requestGet(pathname) {
            const response = await fetch(`${BASE}${pathname}`, {
              method: 'GET',
              redirect: 'error',
              headers: {
                Authorization: `Bearer ${KEY}`,
                Accept: 'application/json',
              },
              signal: AbortSignal.timeout(180000),
            });
            const text = await response.text();
            let payload;
            try { payload = text ? JSON.parse(text) : null; }
            catch { payload = { raw_preview: text.slice(0, 500) }; }
            const result = { status: response.status, http_ok: response.ok, payload };
            console.log(JSON.stringify(sanitize(result), null, 2));
            if (!response.ok || payload?.ok === false) {
              const error = new Error(`Governed runtime GET failed for ${pathname} with HTTP ${response.status}`);
              error.code = payload?.error?.code || 'governed_runtime_get_failed';
              throw error;
            }
            return payload;
          }

          async function resolveAdminTool(toolName) {
            let cursor = null;
            for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
              const params = new URLSearchParams({ limit: '200' });
              if (cursor) params.set('cursor', cursor);
              const catalog = await requestGet(`/gpt/tools?${params.toString()}`);
              const tools = Array.isArray(catalog?.tools) ? catalog.tools : [];
              const match = tools.find((tool) => String(tool?.name || tool?.tool_key || '') === toolName);
              if (match) return match;
              cursor = catalog?.page?.next_cursor || catalog?.next_cursor || null;
              if (!cursor) break;
            }
            throw new Error(`Admin tool catalog does not expose ${toolName}`);
          }

          function buildApprovalToolArgs(tool, envelopeId) {
            const schema = parsedValue(tool?.inputSchema ?? tool?.input_schema ?? tool?.schema) || {};
            const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
            const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
            const note = 'Approve the no-SQL authorization-bootstrap envelope for the reviewed Spec 011 ephemeral checkout migration.';
            const known = {
              envelope_id: envelopeId,
              approved_by: 'github_actions',
              authorized_by: 'github_actions',
              approver: 'github_actions',
              decision: 'approve',
              approval_decision: 'approve',
              decision_note: note,
              approval_note: note,
              reason: note,
              ttl_minutes: 30,
            };
            const args = {};
            for (const [key, descriptor] of Object.entries(properties)) {
              if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'const')) {
                args[key] = descriptor.const;
              } else if (Object.prototype.hasOwnProperty.call(known, key)) {
                args[key] = known[key];
              } else if (required.has(key) && Array.isArray(descriptor?.enum)) {
                const preferred = descriptor.enum.find((value) => ['approve', 'approved'].includes(String(value).toLowerCase()));
                if (preferred !== undefined) args[key] = preferred;
              }
            }
            for (const key of required) {
              assert.ok(Object.prototype.hasOwnProperty.call(args, key), `Unsupported required approval-tool field: ${key}`);
            }
            assert.equal(args.envelope_id, envelopeId, 'Approval tool schema must bind envelope_id');
            return args;
          }
'''

approval_needle = '''          if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
            const approval = await request('/gpt/tools/call', {
              name: 'capability_resolution_envelope_apply_authorize',
              tool_args: {
                envelope_id: envelope.envelope_id,
                authorized_by: 'github_actions',
                decision_note: 'Approve the no-SQL authorization-bootstrap envelope for the reviewed Spec 011 ephemeral checkout migration.',
                ttl_minutes: 30,
              },
            });
            envelope = findObjectWithKey(approval, 'envelope_id') || envelope;
          }
'''

approval_replacement = '''          if (envelope.approval_required === true || envelope.envelope_status === 'ready_requires_approval') {
            const approvalTool = await resolveAdminTool('capability_resolution_envelope_approve');
            const approvalArgs = buildApprovalToolArgs(approvalTool, envelope.envelope_id);
            const approval = await request('/gpt/tools/call', {
              name: 'capability_resolution_envelope_approve',
              tool_args: approvalArgs,
            });
            const approvedEnvelope = findObjectWithKey(approval, 'envelope_id');
            assert.equal(approvedEnvelope?.envelope_id, envelope.envelope_id, 'Approval readback envelope mismatch');
            assert.notEqual(approvedEnvelope?.apply_allowed, true, 'Authorization-only approval must not grant migration apply');
            assert.ok(
              approvedEnvelope?.envelope_status === 'ready_for_dispatch'
                || approvedEnvelope?.approval_status === 'approved'
                || approvedEnvelope?.approved === true,
              `Approval did not produce an approved dispatch envelope: ${approvedEnvelope?.envelope_status || 'unknown'}`,
            );
            envelope = { ...envelope, ...approvedEnvelope };
          }
'''

if source.count(request_needle) != 1:
    raise SystemExit(f"request helper contract matched {source.count(request_needle)} times")
if source.count(approval_needle) != 1:
    raise SystemExit(f"approval block contract matched {source.count(approval_needle)} times")

source = source.replace(request_needle, request_replacement)
source = source.replace(approval_needle, approval_replacement)
TARGET.write_text(source, encoding="utf-8")

for path in (WORKFLOW, TRIGGER, SELF):
    path.unlink()

print("Repaired Spec 011 authorization-only envelope approval flow")
