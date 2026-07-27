import assert from "node:assert/strict";
import { createEffectiveAuthorityDriftLifecycleService } from "./src/application/effectiveAuthority/effectiveAuthorityDriftLifecycleService.js";
import { createEffectiveAuthorityDriftLifecycleRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityDriftLifecycleRepository.js";

function safeRow(overrides = {}) {
  return {
    drift_event_id: "drift-1",
    status: "open",
    resolved_at: null,
    details_json: JSON.stringify({ issueCodes: ["AUTHORITY_AUTHORIZED_NOT_PROJECTED"] }),
    enforcement_mode: "shadow_only",
    authority_granted: 0,
    provider_call_made: 0,
    credential_payload_read: 0,
    external_write_made: 0,
    secrets_included: 0,
    ...overrides,
  };
}

function createPool(initialRow, { forceConflict = false } = {}) {
  let row = initialRow ? { ...initialRow } : null;
  const calls = [];
  return {
    calls,
    get row() {
      return row ? { ...row } : null;
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT drift_event_id")) {
        return [row ? [{ ...row }] : []];
      }
      if (sql.includes("UPDATE authority_projection_drift_events")) {
        if (forceConflict || !row || row.status !== "open") {
          return [{ affectedRows: 0 }];
        }
        const [status, resolvedAt, detailsJson, driftEventId] = params;
        if (driftEventId !== row.drift_event_id) return [{ affectedRows: 0 }];
        row = {
          ...row,
          status,
          resolved_at: resolvedAt,
          details_json: detailsJson,
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in drift lifecycle test: ${sql}`);
    },
  };
}

const actor = {
  principalType: "platform_admin",
  principalId: "admin-1",
};
const transitionedAt = new Date("2026-07-27T00:00:00.000Z");
const pool = createPool(safeRow());
const repository = createEffectiveAuthorityDriftLifecycleRepository({
  resolvePool: async () => pool,
});
const service = createEffectiveAuthorityDriftLifecycleService({
  repository,
  now: () => transitionedAt,
});

const resolved = await service.transition({
  driftEventId: "drift-1",
  toStatus: "resolved",
  reasonCode: "DRIFT_REMEDIATED",
  note: "Projection and authority evidence are aligned.",
  actor,
});
assert.deepEqual(resolved, {
  driftEventId: "drift-1",
  status: "resolved",
  reasonCode: "DRIFT_REMEDIATED",
  actor,
  transitionedAt: transitionedAt.toISOString(),
  idempotent: false,
  readbackVerified: true,
  enforcementMode: "shadow_only",
  authorityGranted: false,
  providerCalls: false,
  credentialPayloadReads: false,
  externalWrites: false,
  secretsIncluded: false,
});
assert.equal(pool.row.status, "resolved");
assert.ok(pool.row.resolved_at);
assert.equal(JSON.parse(pool.row.details_json).lifecycle.reasonCode, "DRIFT_REMEDIATED");

const replay = await service.transition({
  driftEventId: "drift-1",
  toStatus: "resolved",
  reasonCode: "drift_remediated",
  note: "Projection and authority evidence are aligned.",
  actor,
});
assert.equal(replay.idempotent, true);
assert.equal(replay.readbackVerified, true);

await assert.rejects(
  () =>
    service.transition({
      driftEventId: "drift-1",
      toStatus: "resolved",
      reasonCode: "DIFFERENT_REASON",
      note: "Projection and authority evidence are aligned.",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_REPLAY_CONFLICT"
);

await assert.rejects(
  () =>
    service.transition({
      driftEventId: "drift-1",
      toStatus: "ignored",
      reasonCode: "FALSE_POSITIVE",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_TRANSITION_INVALID"
);

const ignoredPool = createPool(safeRow({ drift_event_id: "drift-ignored" }));
const ignoredService = createEffectiveAuthorityDriftLifecycleService({
  repository: createEffectiveAuthorityDriftLifecycleRepository({
    resolvePool: async () => ignoredPool,
  }),
  now: () => transitionedAt,
});
const ignored = await ignoredService.transition({
  driftEventId: "drift-ignored",
  toStatus: "ignored",
  reasonCode: "APPROVED_FALSE_POSITIVE",
  actor,
});
assert.equal(ignored.status, "ignored");
assert.equal(ignored.readbackVerified, true);

const missingService = createEffectiveAuthorityDriftLifecycleService({
  repository: createEffectiveAuthorityDriftLifecycleRepository({
    resolvePool: async () => createPool(null),
  }),
  now: () => transitionedAt,
});
await assert.rejects(
  () =>
    missingService.transition({
      driftEventId: "missing",
      toStatus: "resolved",
      reasonCode: "DRIFT_REMEDIATED",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_EVENT_NOT_FOUND" && error.status === 404
);

const unsafeService = createEffectiveAuthorityDriftLifecycleService({
  repository: createEffectiveAuthorityDriftLifecycleRepository({
    resolvePool: async () => createPool(safeRow({ authority_granted: 1 })),
  }),
  now: () => transitionedAt,
});
await assert.rejects(
  () =>
    unsafeService.transition({
      driftEventId: "drift-1",
      toStatus: "resolved",
      reasonCode: "DRIFT_REMEDIATED",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_UNSAFE_EVIDENCE"
);

const conflictPool = createPool(safeRow(), { forceConflict: true });
const conflictService = createEffectiveAuthorityDriftLifecycleService({
  repository: createEffectiveAuthorityDriftLifecycleRepository({
    resolvePool: async () => conflictPool,
  }),
  now: () => transitionedAt,
});
await assert.rejects(
  () =>
    conflictService.transition({
      driftEventId: "drift-1",
      toStatus: "resolved",
      reasonCode: "DRIFT_REMEDIATED",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_CONCURRENT_UPDATE"
);

await assert.rejects(
  () =>
    service.transition({
      driftEventId: "drift-1",
      toStatus: "closed",
      reasonCode: "DRIFT_REMEDIATED",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_TARGET_INVALID"
);

await assert.rejects(
  () =>
    service.transition({
      driftEventId: "drift-1",
      toStatus: "resolved",
      reasonCode: "not valid!",
      actor,
    }),
  (error) => error.code === "AUTHORITY_DRIFT_LIFECYCLE_REASON_INVALID"
);

console.log("effective authority drift lifecycle tests passed");
