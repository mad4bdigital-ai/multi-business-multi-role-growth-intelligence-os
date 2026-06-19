import assert from "node:assert/strict";
import { atomicallyConsumeCredentialIntakeSession } from "./credentialIntakeSingleUse.js";

function buildPool(initialSession) {
  const state = {
    session: { ...initialSession },
    commits: 0,
    rollbacks: 0,
    releases: 0,
  };
  let lockTail = Promise.resolve();

  async function acquireLock() {
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const previous = lockTail;
    lockTail = current;
    await previous;
    return release;
  }

  return {
    state,
    async getConnection() {
      let releaseLock = null;
      return {
        async beginTransaction() {},
        async query(sql, params = []) {
          const normalized = String(sql).replace(/\s+/g, " ").trim();
          if (normalized.includes("FROM credential_intake_sessions") && normalized.includes("FOR UPDATE")) {
            releaseLock = await acquireLock();
            return [[{ ...state.session }]];
          }
          if (normalized.startsWith("UPDATE credential_intake_sessions") && normalized.includes("status = 'used'")) {
            if (state.session.session_id !== params[1] || state.session.status !== "pending") {
              return [{ affectedRows: 0 }];
            }
            state.session.status = "used";
            state.session.connection_id = params[0];
            return [{ affectedRows: 1 }];
          }
          if (normalized.startsWith("UPDATE credential_intake_sessions") && normalized.includes("status = 'expired'")) {
            if (state.session.session_id !== params[0] || state.session.status !== "pending") {
              return [{ affectedRows: 0 }];
            }
            state.session.status = "expired";
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
        async commit() {
          state.commits += 1;
          releaseLock?.();
          releaseLock = null;
        },
        async rollback() {
          state.rollbacks += 1;
          releaseLock?.();
          releaseLock = null;
        },
        release() {
          state.releases += 1;
          releaseLock?.();
          releaseLock = null;
        },
      };
    },
  };
}

const future = new Date(Date.now() + 60_000).toISOString();
const concurrentPool = buildPool({
  session_id: "session-concurrent",
  token_hash: "token-hash",
  status: "pending",
  expires_at: future,
});
let createCount = 0;
const consume = () => atomicallyConsumeCredentialIntakeSession({
  pool: concurrentPool,
  tokenHash: "token-hash",
  createConnection: async () => {
    createCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { connectionId: `connection-${createCount}` };
  },
});

const concurrentResults = await Promise.all([consume(), consume()]);
const successes = concurrentResults.filter((result) => result.ok);
const rejectedReuse = concurrentResults.filter((result) => !result.ok && result.status === 410);
assert.equal(successes.length, 1, "exactly one concurrent request must consume the session");
assert.equal(rejectedReuse.length, 1, "the competing request must observe the used session");
assert.equal(rejectedReuse[0].error, "credential_intake_session_used");
assert.equal(createCount, 1, "only one connection may be created");
assert.equal(concurrentPool.state.session.status, "used");
assert.equal(concurrentPool.state.commits, 1);
assert.equal(concurrentPool.state.rollbacks, 1);
assert.equal(concurrentPool.state.releases, 2);

const rollbackPool = buildPool({
  session_id: "session-rollback",
  token_hash: "rollback-hash",
  status: "pending",
  expires_at: future,
});
await assert.rejects(
  atomicallyConsumeCredentialIntakeSession({
    pool: rollbackPool,
    tokenHash: "rollback-hash",
    createConnection: async () => {
      const error = new Error("simulated connection insert failure");
      error.code = "simulated_insert_failure";
      throw error;
    },
  }),
  /simulated connection insert failure/,
);
assert.equal(rollbackPool.state.session.status, "pending", "rollback must preserve retryability");
assert.equal(rollbackPool.state.commits, 0);
assert.equal(rollbackPool.state.rollbacks, 1);
assert.equal(rollbackPool.state.releases, 1);

console.log("credential intake atomic single-use tests passed");
