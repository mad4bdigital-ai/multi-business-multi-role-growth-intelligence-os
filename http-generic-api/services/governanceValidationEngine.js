import { getPool } from "../db.js";
import crypto from "node:crypto";
import { validateByJsonSchema } from "../schemaValidation.js";
import { getCanonicalSurfaceMetadata } from "../surfaceMetadata.js";
import { resolveRuntimeWorkflow } from "../runtimeWorkflowResolver.js";

/**
 * Generates a unique validation ID.
 * @returns {string} A unique validation ID.
 */
function createValidationId() {
  return `validation_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Fetches agent skills from the database.
 * @param {string} agentId - The ID of the agent.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of agent skills.
 */
async function getAgentSkills(agentId) {
  const [rows] = await getPool().query(
    "SELECT skill_id FROM `agent_skill_grants` WHERE agent_id = ? AND status = 'active'",
    [agentId]
  );
  return rows;
}

/**
 * Fetches workflow details from the database.
 * @param {string} workflowKey - The key of the workflow.
 * @returns {Promise<Object|null>} A promise that resolves to the workflow row or null.
 */
async function getWorkflowDetails(workflowKey, workflowId = null) {
  return resolveRuntimeWorkflow({
    workflow_id: workflowId,
    workflow_key: workflowKey,
  });
}

/**
 * Fetches route details from the database.
 * @param {string} routeId - The ID of the route.
 * @returns {Promise<Object|null>} A promise that resolves to the route row or null.
 */
async function getRouteDetails(routeId) {
  const [rows] = await getPool().query(
    "SELECT * FROM `task_routes` WHERE route_id = ? LIMIT 1",
    [routeId]
  );
  return rows[0] || null;
}

/**
 * Performs pre-execution validation.
 * @param {Object} runContext - Context for the current execution run.
 * @param {string} runContext.agent_id - The ID of the agent attempting execution.
 * @param {string} runContext.workflow_key - The key of the workflow to be executed.
 * @param {Object} runContext.input_payload - The input payload for the execution.
 * @param {Object} runContext.memory_schema - The overall memory schema for validation.
 * @returns {Promise<Object>} Validation result.
 */
async function validatePreExecution(runContext) {
  const validationId = createValidationId();
  const { agent_id, workflow_id, workflow_key, input_payload, memory_schema } = runContext;
  const errors = [];
  const workflowResolution = workflow_id || workflow_key
    ? await getWorkflowDetails(workflow_key, workflow_id)
    : null;
  const workflowDetails = workflowResolution?.ok ? workflowResolution.workflow : null;

  // 1. Agent Skill Grants Check
  if (agent_id) {
    const agentSkills = await getAgentSkills(agent_id);
    if (workflowDetails && !agentSkills.some(s => s.skill_id === workflowDetails.required_skill)) {
      errors.push({
        code: "agent_skill_missing",
        message: `Agent ${agent_id} lacks required skill for workflow ${workflow_key}.`
      });
    }
  }

  // 2. Input Payload Schema Validation against memory_schema.json
  if (input_payload && memory_schema) {
    const schemaValidationResult = validateByJsonSchema(memory_schema, input_payload, "input_payload_validation");
    if (!schemaValidationResult.isValid) {
      errors.push({
        code: "input_schema_mismatch",
        message: "Input payload does not conform to memory schema.",
        details: schemaValidationResult.errors
      });
    }
  }

  // 3. Workflow and Route Authority Check (simplified, assumes workflow_key implies route)
  if (workflow_id || workflow_key) {
    if (!workflowResolution?.ok) {
      errors.push({
        code: workflowResolution?.resolution?.code || "workflow_authority_invalid",
        message: workflowResolution?.resolution?.message || `Workflow ${workflow_key} is not active or not found.`
      });
    }
    // Further checks could involve task_routes if a route_id is present in workflowDetails
  }

  if (errors.length > 0) {
    return { ok: false, status: "blocked", reason: "pre_execution_validation_failed", details: errors, validation_id: validationId };
  }
  return { ok: true, status: "validated", reason: "pre_execution_passed", validation_id: validationId };
}

/**
 * Performs pre-write validation based on Governed Mutation Playbook.
 * @param {Object} mutationContext - Context for the mutation.
 * @param {string} mutationContext.target_table - The name of the target database table.
 * @param {Object} mutationContext.payload - The data to be written.
 * @param {string} mutationContext.mutation_type - Type of mutation (e.g., 'append', 'update').
 * @param {Object} mutationContext.schema - The schema for the target table.
 * @returns {Promise<Object>} Validation result.
 */
async function validatePreWrite(mutationContext) {
  const validationId = createValidationId();
  const { target_table, payload, mutation_type, schema } = mutationContext;
  const errors = [];

  // 1. Schema/Header Validation (using JSON Schema for payload against table schema)
  if (schema && payload) {
    const schemaValidationResult = validateByJsonSchema(schema, payload, `pre_write_schema_for_${target_table}`);
    if (!schemaValidationResult.isValid) {
      errors.push({
        code: "payload_schema_mismatch",
        message: `Payload for ${target_table} does not conform to its schema.`,
        details: schemaValidationResult.errors
      });
    }
  }

  // 2. Duplicate Checks (simplified, requires specific logic per table)
  if (mutation_type === 'append' && target_table === 'output_artifacts' && payload?.artifact_id) {
    const [existing] = await getPool().query(
      "SELECT artifact_id FROM `output_artifacts` WHERE artifact_id = ? LIMIT 1",
      [payload.artifact_id]
    );
    if (existing.length > 0) {
      errors.push({
        code: "duplicate_artifact_id",
        message: `Artifact with ID ${payload.artifact_id} already exists.`
      });
    }
  }

  // 3. Write-Target Compatibility (e.g., table exists, columns match)
  try {
    // This is a simplified check. A more robust one would query INFORMATION_SCHEMA.
    // For now, we assume `getCanonicalSurfaceMetadata` can provide expected columns.
    const surfaceMetadata = await getCanonicalSurfaceMetadata(`surface.${target_table}_table`);
    if (!surfaceMetadata) {
      errors.push({
        code: "target_table_not_found",
        message: `Target table ${target_table} not registered in Registry Surfaces Catalog.`
      });
    } else if (surfaceMetadata.expected_columns && payload) {
      // Basic check: ensure payload keys are among expected columns
      const payloadKeys = Object.keys(payload);
      const missingExpected = payloadKeys.filter(key => !surfaceMetadata.expected_columns.includes(key));
      if (missingExpected.length > 0) {
        errors.push({
          code: "payload_column_mismatch",
          message: `Payload contains unexpected columns for ${target_table}: ${missingExpected.join(', ')}.`
        });
      }
    }
  } catch (err) {
    errors.push({
      code: "target_compatibility_check_failed",
      message: `Failed to check compatibility for ${target_table}: ${err.message}`
    });
  }

  // 4. Approval Holds Check (conceptual, requires `approval_holds` table and logic)
  // if (payload?.requires_approval) {
  //   const policies = await loadLiveGovernedChangeControlPolicies();
  //   const approvalRequired = policies.some(p => p.policy_key === 'approval_required' && p.policy_value === 'TRUE');
  //   if (approvalRequired) {
  //     errors.push({
  //       code: "approval_hold_required",
  //       message: "Mutation requires explicit approval before write."
  //     });
  //   }
  // }

  if (errors.length > 0) {
    return { ok: false, status: "blocked", reason: "pre_write_validation_failed", details: errors, validation_id: validationId };
  }
  return { ok: true, status: "validated", reason: "pre_write_passed", validation_id: validationId };
}

/**
 * Performs post-write readback validation.
 * @param {Object} writebackContext - Context after a write operation.
 * @param {string} writebackContext.target_table - The name of the target database table.
 * @param {Object} writebackContext.written_payload - The data that was attempted to be written.
 * @param {string} writebackContext.primary_key_value - The value of the primary key of the written record.
 * @returns {Promise<Object>} Validation result.
 */
async function validatePostWriteReadback(writebackContext) {
  const validationId = createValidationId();
  const { target_table, written_payload, primary_key_value } = writebackContext;
  const errors = [];

  // 1. Confirm row exists and key fields match
  let readRow = null;
  if (target_table === 'output_artifacts' && primary_key_value) {
    const [rows] = await getPool().query(
      "SELECT * FROM `output_artifacts` WHERE artifact_id = ? LIMIT 1",
      [primary_key_value]
    );
    readRow = rows[0];
  } else if (target_table === 'sink_dispatch_log' && primary_key_value) {
    const [rows] = await getPool().query(
      "SELECT * FROM `sink_dispatch_log` WHERE dispatch_id = ? LIMIT 1",
      [primary_key_value]
    );
    readRow = rows[0];
  } else if (target_table === 'agent_chain_events' && primary_key_value) {
    const [rows] = await getPool().query(
      "SELECT * FROM `agent_chain_events` WHERE event_id = ? LIMIT 1",
      [primary_key_value]
    );
    readRow = rows[0];
  }
  // Add more table-specific readback logic as needed

  if (!readRow) {
    errors.push({
      code: "readback_failed",
      message: `Record with primary key ${primary_key_value} not found in ${target_table} after write.`
    });
  } else {
    // Basic field comparison (can be extended for deep comparison)
    for (const key in written_payload) {
      // Skip comparing JSON fields directly unless deep comparison is implemented
      if (key.endsWith('_json') || key === 'content_text' || key === 'storage_ref') continue;
      if (String(readRow[key]) !== String(written_payload[key])) {
        errors.push({
          code: "field_mismatch_after_write",
          message: `Field '${key}' mismatch in ${target_table} after write. Expected: '${written_payload[key]}', Observed: '${readRow[key]}'.`
        });
        break;
      }
    }
  }

  // 2. Verify output_artifacts and sink_dispatch_log entries (if applicable)
  // This would be more complex, checking for related entries.
  // For now, assume primary key readback is sufficient.

  if (errors.length > 0) {
    return { ok: false, status: "degraded", reason: "post_write_readback_failed", details: errors, validation_id: validationId };
  }
  return { ok: true, status: "validated", reason: "post_write_readback_passed", validation_id: validationId };
}

/**
 * Orchestrates the validation process based on the stage.
 * @param {string} validationStage - The stage of validation ('pre_execution', 'pre_write', 'post_write_readback').
 * @param {Object} context - The context object relevant to the validation stage.
 * @returns {Promise<Object>} The validation result.
 */
export async function orchestrateValidation(validationStage, context) {
  switch (validationStage) {
    case 'pre_execution':
      return validatePreExecution(context);
    case 'pre_write':
      return validatePreWrite(context);
    case 'post_write_readback':
      return validatePostWriteReadback(context);
    default:
      return { ok: false, status: "blocked", reason: "unknown_validation_stage", details: { stage: validationStage } };
  }
}

/**
 * Public API for the Governance Validation Engine.
 * @param {Object} deps - Injected dependencies.
 * @returns {Object} An object exposing validation functions.
 */
export function createGovernanceValidationEngine(deps) {
  const { getPool, validateByJsonSchema, getCanonicalSurfaceMetadata, getWorkflowRowByKey, getAgentSkills, getWorkflowDetails } = deps;

  return {
    validatePreExecution: (context) => validatePreExecution({ ...context, getPool, validateByJsonSchema, getAgentSkills, getWorkflowDetails }),
    validatePreWrite: (context) => validatePreWrite({ ...context, getPool, validateByJsonSchema, getCanonicalSurfaceMetadata }),
    validatePostWriteReadback: (context) => validatePostWriteReadback({ ...context, getPool }),
    orchestrateValidation: (stage, context) => orchestrateValidation(stage, { ...context, getPool, validateByJsonSchema, getCanonicalSurfaceMetadata, getWorkflowRowByKey, getAgentSkills, getWorkflowDetails }),
  };
}
