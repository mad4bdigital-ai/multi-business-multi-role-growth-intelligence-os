/**
 * Computes the canonical progress state payload.
 * @param {string[]} completedStages - Stages that have already successfully completed.
 * @param {string} blockedStage - The stage where the execution was blocked.
 * @returns {Object} The progress state envelope.
 */
export function buildProgressState(completedStages, blockedStage) {
    return {
        current_stage: blockedStage,
        completed_stages: completedStages,
        blocked_stage: blockedStage
    };
}