import crypto from "node:crypto";

const SHA256_RE = /^[a-f0-9]{64}$/u;
const KEY_CONTEXT = "mad4b.staging-gateway.execution-artifact.v1";

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { secrets_included: false };
  return error;
}

function encryptionKey(env) {
  const source = String(env?.TOKEN_ENCRYPTION_KEY || "");
  if (!SHA256_RE.test(source)) throw fail("staging_gateway_artifact_key_unavailable", "Server artifact encryption key is required.", 503);
  return crypto.createHmac("sha256", Buffer.from(source, "hex")).update(KEY_CONTEXT).digest();
}

export function sealStagingGatewayArtifact(artifact, { env = process.env, planId } = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(`${KEY_CONTEXT}:${planId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(artifact), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

export function openStagingGatewayArtifact(sealed, { env = process.env, planId } = {}) {
  try {
    const data = JSON.parse(String(sealed));
    if (data.v !== 1) throw new Error("version");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(data.iv, "base64"));
    decipher.setAAD(Buffer.from(`${KEY_CONTEXT}:${planId}`));
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  } catch {
    throw fail("staging_gateway_artifact_integrity_failed", "Stored Staging Gateway artifact failed authentication.");
  }
}

export async function saveStagingGatewayExecutionPlan(pool, plan, bundle, { env = process.env } = {}) {
  if (!pool?.getConnection) throw fail("staging_gateway_plan_store_unavailable", "Durable execution plan store is required.", 503);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO staging_activation_gateway_execution_artifacts (artifact_ref, encrypted_artifact) VALUES (?, ?)`,
      [plan.bundle_ref, sealStagingGatewayArtifact({ bundle }, { env, planId: plan.plan_id })],
    );
    await connection.query(
      `INSERT INTO staging_activation_gateway_execution_plans
       (plan_id, plan_sha256, plan_body_json, environment_convergence_plan_sha256, expected_source_commit,
        expected_policy_hash, resource_binding_id, workspace_id, bundle_sha256,
        secret_set_sha256, trust_key_id, trust_public_key_sha256, bundle_ref,
        status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [plan.plan_id, plan.plan_sha256, JSON.stringify(plan._planBody), plan.environment_convergence_plan_sha256,
        plan.expected_source_commit, plan.expected_policy_hash, plan.resource_binding.binding_id,
        plan.workspace.workspace_id, plan.bundle_sha256, plan.secret_set_sha256,
        plan.trust_key_id, plan.trust_public_key_sha256, plan.bundle_ref, plan.expires_at],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function loadStagingGatewayExecutionPlan(pool, { planId, planSha256, convergencePlanSha256, env = process.env } = {}) {
  if (!pool?.query) throw fail("staging_gateway_plan_store_unavailable", "Durable execution plan store is required.", 503);
  const [rows] = await pool.query(
    `SELECT p.*, a.encrypted_artifact
       FROM staging_activation_gateway_execution_plans p
       JOIN staging_activation_gateway_execution_artifacts a ON a.artifact_ref=p.bundle_ref
      WHERE p.plan_id=? AND p.plan_sha256=? AND p.environment_convergence_plan_sha256=?
        AND p.status='ready' AND p.expires_at>NOW() LIMIT 1`,
    [planId, planSha256, convergencePlanSha256],
  );
  const row = rows?.[0];
  if (!row) throw fail("staging_activation_gateway_stale_plan", "Execution plan is missing, expired, claimed, or bound to a different convergence plan.");
  const artifact = openStagingGatewayArtifact(row.encrypted_artifact, { env, planId });
  return { row, bundle: artifact.bundle };
}

export async function claimStagingGatewayExecutionPlan(pool, { planId, planSha256, convergencePlanSha256 } = {}) {
  const [result] = await pool.query(
    `UPDATE staging_activation_gateway_execution_plans
        SET status='claimed', claimed_at=NOW()
      WHERE plan_id=? AND plan_sha256=? AND environment_convergence_plan_sha256=?
        AND status='ready' AND expires_at>NOW()`,
    [planId, planSha256, convergencePlanSha256],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw fail("staging_activation_gateway_plan_replay_blocked", "Execution plan is stale or has already been claimed.");
}

export async function transitionStagingGatewayExecutionPlan(pool, planId, from, to) {
  const [result] = await pool.query(
    `UPDATE staging_activation_gateway_execution_plans SET status=?, completed_at=IF(? IN ('succeeded','failed'),NOW(),NULL) WHERE plan_id=? AND status=?`,
    [to, to, planId, from],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw fail("staging_activation_gateway_plan_transition_failed", "Execution plan transition failed.", 500);
}
