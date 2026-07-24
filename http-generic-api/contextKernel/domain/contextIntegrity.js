import crypto from "node:crypto";
import { deepFreeze } from "./model.js";

const SENSITIVE_KEY = /(?:credential|secret|token|password|private[_-]?key|authorization|cookie)/i;

export const ContextDimensions = deepFreeze([
  "principal",
  "effectiveSubject",
  "tenant",
  "workspace",
  "brand",
  "resource",
  "connection",
  "authority",
  "capability",
  "plan",
  "approval",
  "execution",
]);

const INVALIDATION_GRAPH = deepFreeze({
  principal: ["effectiveSubject", "tenant", "workspace", "brand", "resource", "connection", "authority", "capability", "plan", "approval", "execution"],
  effectiveSubject: ["tenant", "workspace", "brand", "resource", "connection", "authority", "capability", "plan", "approval", "execution"],
  tenant: ["workspace", "brand", "resource", "connection", "authority", "capability", "plan", "approval", "execution"],
  workspace: ["brand", "resource", "connection", "authority", "capability", "plan", "approval", "execution"],
  brand: ["resource", "connection", "authority", "capability", "plan", "approval", "execution"],
  resource: ["connection", "authority", "capability", "plan", "approval", "execution"],
  connection: ["authority", "capability", "plan", "approval", "execution"],
  authority: ["capability", "plan", "approval", "execution"],
  capability: ["plan", "approval", "execution"],
  plan: ["approval", "execution"],
  approval: ["execution"],
  execution: [],
});

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (SENSITIVE_KEY.test(key)) continue;
    const child = value[key];
    if (child !== undefined) result[key] = sanitize(child);
  }
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function createContextHash(context) {
  const canonical = canonicalize(sanitize(context));
  return crypto.createHash("sha256").update(`context-kernel-v1:${canonical}`).digest("hex");
}

export function createContextRevision(context, previousRevision = "") {
  return createContextHash({ context, previousRevision: String(previousRevision || "") });
}

export function validateContextRevision({
  expectedRevision,
  actualRevision,
  expiresAt = null,
  now = new Date(),
}) {
  const reasonCodes = [];
  if (!expectedRevision || expectedRevision !== actualRevision) reasonCodes.push("context_revision_mismatch");
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) reasonCodes.push("context_expired");
  return deepFreeze({
    valid: reasonCodes.length === 0,
    reasonCodes,
    actualRevision,
  });
}

export function computeInvalidatedDimensions(changedDimensions) {
  if (!Array.isArray(changedDimensions)) throw new TypeError("changedDimensions must be an array.");
  const invalidated = new Set();
  const queue = [...changedDimensions];
  while (queue.length > 0) {
    const dimension = queue.shift();
    if (!ContextDimensions.includes(dimension)) throw new TypeError(`Unknown context dimension: ${dimension}`);
    if (invalidated.has(dimension)) continue;
    invalidated.add(dimension);
    queue.push(...INVALIDATION_GRAPH[dimension]);
  }
  return deepFreeze(ContextDimensions.filter((dimension) => invalidated.has(dimension)));
}
