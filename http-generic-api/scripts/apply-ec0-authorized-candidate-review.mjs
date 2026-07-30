#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const testPath = path.join(apiRoot, "test-execution-capsule-contract.mjs");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let source = fs.readFileSync(testPath, "utf8");
const anchor = `assert.throws(
  () => resolveCapsule(createResolution({
    context: { connectionRef: "connection-b" },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
);`;
const additions = `${anchor}

const forgedSelectedCandidate = {
  ...selectedCandidate,
  resourceRef: "repository-forged",
  connectionRef: "connection-forged",
};
assert.throws(
  () => resolveCapsule(createResolution({
    selectedCandidate: forgedSelectedCandidate,
    candidates: [selectedCandidate],
    context: {
      selectedCandidate: forgedSelectedCandidate,
      resourceRef: "repository-forged",
      connectionRef: "connection-forged",
    },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
  "caller-selected fields must not override the authorized candidate set",
);
assert.throws(
  () => resolveCapsule(createResolution({
    context: {
      selectedCandidate: {
        ...selectedCandidate,
        resourceRef: "repository-nested-forged",
      },
    },
  })),
  (error) => error?.code === "execution_capsule_context_candidate_mismatch",
  "nested selected candidate must match the authorized candidate exactly",
);
assert.throws(
  () => resolveCapsule(createResolution({
    context: {
      capability: {
        capabilityKey: "repository.write",
        dispatchAllowed: true,
      },
    },
  })),
  (error) => error?.code === "execution_capsule_capability_context_mismatch",
  "context capability and readiness decision must identify the same capability",
);`;
source = replaceExactlyOnce(source, anchor, additions, "authorized candidate regressions");
fs.writeFileSync(testPath, source);
console.log("EC0 authorized candidate regressions applied");
