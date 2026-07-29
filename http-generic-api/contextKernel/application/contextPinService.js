import { randomUUID } from "node:crypto";

import { createContextPin } from "../domain/index.js";
import { assertContextPinRepository } from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

export function createContextPinService({
  contextPinRepository,
  idFactory = () => randomUUID(),
  clock = () => new Date(),
}) {
  assertContextPinRepository(contextPinRepository);
  requireApplicationFunction(idFactory, "idFactory");
  requireApplicationFunction(clock, "clock");

  async function create({
    resolution,
    tenantRef = null,
    principalType,
    principalRef,
    expiresAt = null,
  }) {
    const resolved = requireApplicationObject(resolution, "resolution");
    if (resolved.status !== "resolved" || !resolved.context || !resolved.selectedCandidate) {
      throw new ContextApplicationError(
        "context_pin_requires_resolved_context",
        "A context pin can only be created from a resolved execution context.",
        409,
      );
    }
    const expiry = expiresAt == null ? null : new Date(expiresAt);
    if (expiry && (Number.isNaN(expiry.getTime()) || expiry.getTime() <= clock().getTime())) {
      throw new ContextApplicationError(
        "context_pin_expiry_invalid",
        "Context pin expiry must be a valid future timestamp.",
        422,
      );
    }
    const pin = createContextPin({
      pinRef: requireApplicationString(idFactory(), "pinRef"),
      stableRef: resolved.selectedCandidate.stableRef,
      contextRevision: resolved.context.contextRevision,
      expiresAt: expiry?.toISOString() || null,
      verified: true,
    });
    const request = freezeApplicationValue({
      tenantRef: requireApplicationString(tenantRef || resolved.context.tenantRef, "tenantRef"),
      principalType: requireApplicationString(principalType, "principalType"),
      principalRef: requireApplicationString(principalRef, "principalRef"),
      pin,
      contextHash: resolved.context.contextHash,
      createdAt: clock().toISOString(),
    });
    const stored = await contextPinRepository.createPin(request);
    return freezeApplicationValue(stored || request);
  }

  async function read({ tenantRef, pinRef, principalType, principalRef }) {
    const result = await contextPinRepository.findContextPin({
      tenantRef: requireApplicationString(tenantRef, "tenantRef"),
      pinRef: requireApplicationString(pinRef, "pinRef"),
      principalType: requireApplicationString(principalType, "principalType"),
      principalRef: requireApplicationString(principalRef, "principalRef"),
    });
    return freezeApplicationValue(result);
  }

  async function invalidate({ tenantRef, pinRef, principalType, principalRef, reason = "context_changed" }) {
    const request = freezeApplicationValue({
      tenantRef: requireApplicationString(tenantRef, "tenantRef"),
      pinRef: requireApplicationString(pinRef, "pinRef"),
      principalType: requireApplicationString(principalType, "principalType"),
      principalRef: requireApplicationString(principalRef, "principalRef"),
      reason: requireApplicationString(reason, "reason"),
      invalidatedAt: clock().toISOString(),
    });
    const result = await contextPinRepository.invalidatePin(request);
    return freezeApplicationValue(result || request);
  }

  return Object.freeze({ create, read, invalidate });
}
