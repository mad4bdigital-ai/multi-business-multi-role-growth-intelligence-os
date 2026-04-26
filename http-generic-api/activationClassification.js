/**
 * Standardizes the runtime classification envelope for rate-limited states.
 * @param {Object} progressState - The current stage progress.
 * @returns {Object} The canonical classification envelope.
 */
export function buildRateLimitedClassification(progressState) {
    return {
        activation_status: "validation_rate_limited",
        reason_code: "google_sheets_rate_limited",
        progress: progressState
    };
}