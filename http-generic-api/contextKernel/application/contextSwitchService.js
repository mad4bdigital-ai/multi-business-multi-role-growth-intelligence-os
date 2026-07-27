import { computeInvalidatedDimensions, createContextHash } from "../domain/index.js";
import { assertContextPinRepository } from "./repositoryPorts.js";
import {
  freezeApplicationValue,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

function dimensionFingerprint(context, dimension) {
  switch (dimension) {
    case "principal":
      return createContextHash({
        principalType: context.principal?.principalType || null,
        principalRef: context.principal?.principalRef || null,
      });
    case "effectiveSubject":
      return createContextHash(context.effectiveSubject || null);
    case "tenant":
      return String(context.tenantRef || "");
    case "workspace":
      return String(context.workspaceRef || "");
    case "brand":
      return String(context.brandRef || "");
    case "resource":
      return createContextHash({ resourceType: context.resourceType, resourceRef: context.resourceRef });
    case "connection":
      return String(context.connectionRef || "");
    case "authority":
      return createContextHash(context.authority || null);
    case "capability":
      return createContextHash(context.capability || null);
    default:
      return "";
  }
}

function changedDimensions(currentContext, nextContext) {
  const dimensions = [
    "principal",
    "effectiveSubject",
    "tenant",
    "workspace",
    "brand",
    "resource",
    "connection",
    "authority",
    "capability",
  ];
  return dimensions.filter(
    (dimension) => dimensionFingerprint(currentContext, dimension) !== dimensionFingerprint(nextContext, dimension),
  );
}

export function createContextSwitchService({ resolutionService, contextPinRepository }) {
  if (!resolutionService || typeof resolutionService.resolve !== "function") {
    throw new TypeError("Context switch service requires resolutionService.resolve().");
  }
  assertContextPinRepository(contextPinRepository);

  async function prepare({ currentContext, nextResolutionInput }) {
    const current = requireApplicationObject(currentContext, "currentContext");
    const nextInput = requireApplicationObject(nextResolutionInput, "nextResolutionInput");
    const resolution = await resolutionService.resolve(nextInput);
    if (resolution.status !== "resolved" || !resolution.context) {
      return freezeApplicationValue({
        status: resolution.status,
        reasonCodes: resolution.reasonCodes || [],
        resolution,
        changedDimensions: [],
        invalidatedDimensions: [],
        pinInvalidationRequired: false,
        automaticWritePerformed: false,
      });
    }

    const changed = changedDimensions(current, resolution.context);
    const invalidated = changed.length > 0 ? computeInvalidatedDimensions(changed) : [];
    return freezeApplicationValue({
      status: "switch_ready",
      reasonCodes: [],
      resolution,
      changedDimensions: changed,
      invalidatedDimensions: invalidated,
      pinInvalidationRequired: Boolean(current.pinRef && changed.length > 0),
      automaticWritePerformed: false,
    });
  }

  async function apply({
    currentContext,
    nextResolutionInput,
    principalType,
    principalRef,
  }) {
    const prepared = await prepare({ currentContext, nextResolutionInput });
    if (prepared.status !== "switch_ready") return prepared;

    let invalidatedPin = null;
    if (prepared.pinInvalidationRequired) {
      invalidatedPin = await contextPinRepository.invalidatePin({
        tenantRef: requireApplicationString(currentContext.tenantRef, "currentContext.tenantRef"),
        pinRef: requireApplicationString(currentContext.pinRef, "currentContext.pinRef"),
        principalType: requireApplicationString(principalType, "principalType"),
        principalRef: requireApplicationString(principalRef, "principalRef"),
        reason: "context_switch",
      });
    }

    return freezeApplicationValue({
      ...prepared,
      status: "switched",
      invalidatedPin,
      automaticWritePerformed: prepared.pinInvalidationRequired,
    });
  }

  return Object.freeze({ prepare, apply });
}

export const _testingContextSwitchService = Object.freeze({
  changedDimensions,
  dimensionFingerprint,
});
