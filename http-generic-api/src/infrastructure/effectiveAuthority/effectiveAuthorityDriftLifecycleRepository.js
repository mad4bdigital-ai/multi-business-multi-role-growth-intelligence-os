import {
  EffectiveAuthorityError,
  assertNoSecretEvidence,
} from "../../domain/effectiveAuthority/effectiveAuthority.js";
import {
  assertAuthorityDriftLifecycleState,
  normalizeAuthorityDriftLifecycleTransition,
} from "../../domain/effectiveAuthority/effectiveAuthorityDriftLifecycle.js";

function requirePool(pool) {
  if (!pool || typeof pool.execute !== "function") {
    throw new TypeError(
      "Effective authority drift lifecycle repository requires a SQL pool with execute()."
    );
  }
  return pool;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value, field, maximumBytes = 131072) {
  assertNoSecretEvidence(value);
  const json = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(json, "utf8") > maximumBytes) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_EVIDENCE_TOO_LARGE",
      `${field} exceeds the bounded evidence size.`,
      413
    );
  }
  return json;
}

function parseDetails(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_DETAILS_INVALID",
      "Drift event details_json is not valid JSON.",
      409
    );
  }
}

function mysqlDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_DRIFT_LIFECYCLE_INPUT_INVALID",
      "transitionedAt must be a valid timestamp.",
      400
    );
  }
  return parsed.toISOString().replace("T", " ").replace("Z", "");
}

function lifecycleError(code, message, status = 409, details = undefined) {
  return new EffectiveAuthorityError(code, message, status, details);
}

function assertShadowOnlyRow(row) {
  if (
    String(row?.enforcement_mode || "") !== "shadow_only" ||
    Number(row?.authority_granted || 0) !== 0 ||
    Number(row?.provider_call_made || 0) !== 0 ||
    Number(row?.credential_payload_read || 0) !== 0 ||
    Number(row?.external_write_made || 0) !== 0 ||
    Number(row?.secrets_included || 0) !== 0
  ) {
    throw lifecycleError(
      "AUTHORITY_DRIFT_LIFECYCLE_UNSAFE_EVIDENCE",
      "Drift lifecycle transition requires shadow-only no-authority evidence.",
      409
    );
  }
}

function lifecycleMatches(existing, transition) {
  return Boolean(
    existing &&
    existing.fromStatus === transition.fromStatus &&
    existing.toStatus === transition.toStatus &&
    existing.reasonCode === transition.reasonCode &&
    (existing.note ?? null) === transition.note &&
    existing.actor?.principalType === transition.actor.principalType &&
    existing.actor?.principalId === transition.actor.principalId
  );
}

export function createEffectiveAuthorityDriftLifecycleRepository({ resolvePool } = {}) {
  if (typeof resolvePool !== "function") {
    throw new TypeError(
      "Effective authority drift lifecycle repository requires resolvePool()."
    );
  }

  async function readDriftEvent(pool, driftEventId) {
    const [rows] = await pool.execute(
      `SELECT drift_event_id,status,resolved_at,details_json,enforcement_mode,
              authority_granted,provider_call_made,credential_payload_read,
              external_write_made,secrets_included
         FROM authority_projection_drift_events
        WHERE drift_event_id = ?
        LIMIT 1`,
      [driftEventId]
    );
    return rows?.[0] || null;
  }

  function buildResult(row, transition, { idempotent }) {
    assertShadowOnlyRow(row);
    const details = parseDetails(row.details_json);
    const lifecycle = details.lifecycle;
    if (!lifecycleMatches(lifecycle, transition)) {
      throw lifecycleError(
        "AUTHORITY_DRIFT_LIFECYCLE_READBACK_MISMATCH",
        "Drift lifecycle readback does not match the approved transition.",
        409
      );
    }
    if (String(row.status) !== transition.toStatus || !row.resolved_at) {
      throw lifecycleError(
        "AUTHORITY_DRIFT_LIFECYCLE_READBACK_MISMATCH",
        "Drift lifecycle status or resolved_at readback mismatch.",
        409
      );
    }
    return Object.freeze({
      driftEventId: transition.driftEventId,
      status: transition.toStatus,
      reasonCode: transition.reasonCode,
      actor: Object.freeze({ ...transition.actor }),
      transitionedAt: lifecycle.transitionedAt,
      idempotent,
      readbackVerified: true,
      enforcementMode: "shadow_only",
      authorityGranted: false,
      providerCalls: false,
      credentialPayloadReads: false,
      externalWrites: false,
      secretsIncluded: false,
    });
  }

  async function transitionDriftEvent(input) {
    const transition = normalizeAuthorityDriftLifecycleTransition(input);
    const pool = requirePool(await resolvePool());
    const current = await readDriftEvent(pool, transition.driftEventId);
    if (!current) {
      throw lifecycleError(
        "AUTHORITY_DRIFT_EVENT_NOT_FOUND",
        "Drift event was not found.",
        404,
        { driftEventId: transition.driftEventId }
      );
    }
    assertShadowOnlyRow(current);

    const action = assertAuthorityDriftLifecycleState(current.status, transition);
    if (action === "idempotent") {
      const details = parseDetails(current.details_json);
      if (!lifecycleMatches(details.lifecycle, transition)) {
        throw lifecycleError(
          "AUTHORITY_DRIFT_LIFECYCLE_REPLAY_CONFLICT",
          "Drift lifecycle replay does not match the persisted transition.",
          409
        );
      }
      return buildResult(current, transition, { idempotent: true });
    }

    const currentDetails = parseDetails(current.details_json);
    const updatedDetails = {
      ...currentDetails,
      lifecycle: {
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        reasonCode: transition.reasonCode,
        note: transition.note,
        actor: { ...transition.actor },
        transitionedAt: transition.transitionedAt,
        enforcementMode: "shadow_only",
        authorityGranted: false,
        providerCalls: false,
        credentialPayloadReads: false,
        externalWrites: false,
        secretsIncluded: false,
      },
    };
    const detailsJson = canonicalJson(updatedDetails, "drift lifecycle details");
    const [updateResult] = await pool.execute(
      `UPDATE authority_projection_drift_events
          SET status = ?, resolved_at = ?, details_json = ?
        WHERE drift_event_id = ?
          AND status = 'open'
          AND enforcement_mode = 'shadow_only'
          AND authority_granted = 0
          AND provider_call_made = 0
          AND credential_payload_read = 0
          AND external_write_made = 0
          AND secrets_included = 0`,
      [
        transition.toStatus,
        mysqlDate(transition.transitionedAt),
        detailsJson,
        transition.driftEventId,
      ]
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      throw lifecycleError(
        "AUTHORITY_DRIFT_LIFECYCLE_CONCURRENT_UPDATE",
        "Drift lifecycle transition lost the optimistic status guard.",
        409
      );
    }

    const readback = await readDriftEvent(pool, transition.driftEventId);
    if (!readback) {
      throw lifecycleError(
        "AUTHORITY_DRIFT_LIFECYCLE_READBACK_MISMATCH",
        "Drift event disappeared during same-cycle readback.",
        409
      );
    }
    return buildResult(readback, transition, { idempotent: false });
  }

  return Object.freeze({ transitionDriftEvent });
}
