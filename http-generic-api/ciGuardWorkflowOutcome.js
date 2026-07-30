const SUPERSEDED_CLASSIFICATION = "cancelled_due_to_superseding_run";

function normalizedText(value) {
  return String(value ?? "").trim();
}

function numericRunNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sameOptionalIdentity(left, right) {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

export function classifyCiGuardWorkflowOutcome({
  guardResult,
  currentRun,
  workflowRuns = [],
} = {}) {
  const normalizedResult = normalizedText(guardResult).toLowerCase() || "unknown";
  const currentRunId = String(currentRun?.id ?? "");
  const currentRunNumber = numericRunNumber(currentRun?.run_number);

  if (normalizedResult !== "cancelled") {
    return {
      classification: normalizedResult,
      neutral: false,
      superseding_run: null,
    };
  }

  const candidates = (Array.isArray(workflowRuns) ? workflowRuns : [])
    .filter((candidate) => String(candidate?.id ?? "") !== currentRunId)
    .filter((candidate) => numericRunNumber(candidate?.run_number) > currentRunNumber)
    .filter((candidate) => sameOptionalIdentity(candidate?.workflow_id, currentRun?.workflow_id))
    .filter((candidate) => sameOptionalIdentity(candidate?.event, currentRun?.event))
    .filter((candidate) => sameOptionalIdentity(candidate?.head_branch, currentRun?.head_branch))
    .sort((left, right) => numericRunNumber(right?.run_number) - numericRunNumber(left?.run_number));

  const supersedingRun = candidates[0] || null;
  return supersedingRun
    ? {
        classification: SUPERSEDED_CLASSIFICATION,
        neutral: true,
        superseding_run: {
          id: supersedingRun.id ?? null,
          run_number: numericRunNumber(supersedingRun.run_number),
          html_url: normalizedText(supersedingRun.html_url) || null,
          status: normalizedText(supersedingRun.status) || null,
          conclusion: normalizedText(supersedingRun.conclusion) || null,
        },
      }
    : {
        classification: "cancelled",
        neutral: false,
        superseding_run: null,
      };
}

export const _testingCiGuardWorkflowOutcome = Object.freeze({
  SUPERSEDED_CLASSIFICATION,
  numericRunNumber,
  sameOptionalIdentity,
});
