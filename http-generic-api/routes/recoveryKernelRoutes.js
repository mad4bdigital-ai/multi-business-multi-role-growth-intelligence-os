// Recovery Kernel route facade that keeps read and consequential store authority explicit.
export * from "./recoveryKernelRoutesCore.js";

import { Router } from "express";
import * as Core from "./recoveryKernelRoutesCore.js";
import {
  assertApprovalChallengeAuthorities,
  createApprovalChallenge,
  sanitizeEvidence,
} from "../recoveryKernel.js";
import { buildRecoveryTypedConfirmationRequirements } from "../recoveryActionBridge.js";

export function resolveRecoveryRouteStores(options = {}, recoveryStore = options?.recoveryStore || null) {
  const hasExplicitReadOnly = Object.prototype.hasOwnProperty.call(options, "readOnlyRecoveryStore");
  const hasExplicitMutation = Object.prototype.hasOwnProperty.call(options, "mutationRecoveryStore");
  return Object.freeze({
    readOnlyRecoveryStore: hasExplicitReadOnly
      ? (options.readOnlyRecoveryStore ?? null)
      : (recoveryStore ?? null),
    mutationRecoveryStore: hasExplicitMutation
      ? (options.mutationRecoveryStore ?? null)
      : (recoveryStore ?? null),
    explicit_read_only_boundary: hasExplicitReadOnly,
    explicit_mutation_boundary: hasExplicitMutation,
  });
}

function productionGuard(env) {
  return (_req, res, next) => {
    try {
      Core._testingRecoveryKernelRoutes.assertProductionEnvironment(env);
      return next();
    } catch (error) {
      return Core._testingRecoveryKernelRoutes.errorResponse(res, error, "recovery_kernel_production_only");
    }
  };
}

export function buildRecoveryKernelRoutes(options = {}) {
  const router = Router();
  const stores = resolveRecoveryRouteStores(options, options.recoveryStore);
  const guards = [options.requireBackendApiKey, options.requireAdminPrincipal].filter((value) => typeof value === "function");
  if (guards.length !== 2) throw new Error("Recovery Kernel routes require backend-key and admin-principal guards.");

  // Approval issuance changes durable control-plane state. It must therefore use the
  // mutation/control authority explicitly, never the evidence-only projection.
  router.post(
    "/admin/recovery/kernel/approval-challenge",
    ...guards,
    productionGuard(options.env || process.env),
    async (req, res) => {
      try {
        const body = Core._testingRecoveryKernelRoutes.assertExactKeys(
          req.body || {},
          ["plan_id", "plan_hash", "step_id"],
          ["plan_id", "plan_hash", "step_id"],
        );
        assertApprovalChallengeAuthorities({
          recoveryStore: stores.mutationRecoveryStore,
          approvalIssuer: options.approvalIssuer,
          approvalStore: options.approvalStore,
        });
        const result = await createApprovalChallenge(body, {
          recoveryStore: stores.mutationRecoveryStore,
          approvalIssuer: options.approvalIssuer,
          approvalStore: options.approvalStore,
        });
        const confirmationRequirements = buildRecoveryTypedConfirmationRequirements(result);
        return res.status(201).json(sanitizeEvidence({
          ok: true,
          contract: "mad4b.recovery-approval-challenge-route-receipt.v1",
          result: {
            ...result,
            confirmation_required: true,
            confirmation_requirements: confirmationRequirements,
          },
          approval_token_not_returned: true,
          execution_ticket_not_returned: true,
          secrets_included: false,
        }));
      } catch (error) {
        return Core._testingRecoveryKernelRoutes.errorResponse(res, error, "recovery_approval_challenge_failed");
      }
    },
  );

  router.use(Core.buildRecoveryKernelRoutes(options));
  return router;
}
