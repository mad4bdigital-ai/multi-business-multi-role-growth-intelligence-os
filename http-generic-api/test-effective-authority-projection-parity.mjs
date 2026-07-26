import assert from "node:assert/strict";

import { compareEffectiveAuthorityProjectionParity } from "./src/domain/effectiveAuthority/effectiveAuthorityProjectionParity.js";

const reference = {
  surfaceKey: "authority_manifest",
  resources: [
    {
      resourceId: "connector-b",
      reasonCodes: ["EXECUTION_BLOCKED"],
    },
    {
      resourceId: "connector-a",
      reasonCodes: ["SCOPE_AUTHORIZED", "CAPABILITY_REGISTERED"],
    },
  ],
};

const aligned = compareEffectiveAuthorityProjectionParity({
  reference,
  candidates: [
    {
      surfaceKey: "tool_catalog",
      resources: [
        {
          resourceId: "connector-a",
          reasonCodes: ["CAPABILITY_REGISTERED", "SCOPE_AUTHORIZED"],
        },
        {
          resourceId: "connector-b",
          reasonCodes: ["EXECUTION_BLOCKED"],
        },
      ],
    },
    {
      surfaceKey: "activation",
      resources: [
        {
          resourceId: "connector-b",
          reasonCodes: [" execution_blocked ", "EXECUTION_BLOCKED"],
        },
        {
          resourceId: "connector-a",
          reasonCodes: ["scope_authorized", "capability_registered"],
        },
      ],
    },
  ],
});

assert.deepEqual(aligned, {
  referenceSurfaceKey: "authority_manifest",
  aligned: true,
  comparisons: [
    {
      referenceSurfaceKey: "authority_manifest",
      candidateSurfaceKey: "activation",
      aligned: true,
      missingResourceIds: [],
      extraResourceIds: [],
      reasonMismatches: [],
    },
    {
      referenceSurfaceKey: "authority_manifest",
      candidateSurfaceKey: "tool_catalog",
      aligned: true,
      missingResourceIds: [],
      extraResourceIds: [],
      reasonMismatches: [],
    },
  ],
});
assert.equal(Object.isFrozen(aligned), true);
assert.equal(Object.isFrozen(aligned.comparisons), true);

const mismatch = compareEffectiveAuthorityProjectionParity({
  reference,
  candidates: [
    {
      surfaceKey: "dashboard",
      resources: [
        {
          resourceId: "connector-c",
          reasonCodes: ["NOT_REGISTERED"],
        },
        {
          resourceId: "connector-a",
          reasonCodes: ["CAPABILITY_REGISTERED"],
        },
      ],
    },
  ],
});

assert.deepEqual(mismatch, {
  referenceSurfaceKey: "authority_manifest",
  aligned: false,
  comparisons: [
    {
      referenceSurfaceKey: "authority_manifest",
      candidateSurfaceKey: "dashboard",
      aligned: false,
      missingResourceIds: ["connector-b"],
      extraResourceIds: ["connector-c"],
      reasonMismatches: [
        {
          resourceId: "connector-a",
          referenceReasonCodes: ["CAPABILITY_REGISTERED", "SCOPE_AUTHORIZED"],
          candidateReasonCodes: ["CAPABILITY_REGISTERED"],
        },
      ],
    },
  ],
});

assert.deepEqual(
  compareEffectiveAuthorityProjectionParity({ reference, candidates: [] }),
  {
    referenceSurfaceKey: "authority_manifest",
    aligned: true,
    comparisons: [],
  }
);

assert.throws(
  () =>
    compareEffectiveAuthorityProjectionParity({
      reference,
      candidates: [
        {
          surfaceKey: "activation",
          resources: [
            { resourceId: "connector-a", reasonCodes: [] },
            { resourceId: "connector-a", reasonCodes: [] },
          ],
        },
      ],
    }),
  /duplicate resourceId/
);

assert.throws(
  () =>
    compareEffectiveAuthorityProjectionParity({
      reference,
      candidates: [
        {
          surfaceKey: "activation",
          resources: [
            { resourceId: "connector-a", reasonCodes: ["not valid!"] },
          ],
        },
      ],
    }),
  /stable uppercase reason code/
);

assert.throws(
  () =>
    compareEffectiveAuthorityProjectionParity({
      reference,
      candidates: [
        { surfaceKey: "activation", resources: [] },
        { surfaceKey: "activation", resources: [] },
      ],
    }),
  /Duplicate projection surfaceKey/
);

console.log("effective authority exact projection parity tests passed");
