const MAX_RETRIES = 5;
const BASE_BACKOFF_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 900; // 15 minutes max wait

/**
 * Computes a bounded exponential backoff policy for 429 limits.
 * @param {number} currentRetryCount - The number of times this job has already been retried.
 * @returns {Object} The recovery policy envelope.
 */
export function getRecoveryPolicy(currentRetryCount = 0) {
    if (currentRetryCount >= MAX_RETRIES) {
        return {
            retryable: false,
            recommended_action: "manual_intervention_required",
            reason: "exhausted_max_retries"
        };
    }

    // Bounded exponential backoff
    let backoffSeconds = BASE_BACKOFF_SECONDS * Math.pow(2, currentRetryCount);
    backoffSeconds = Math.min(backoffSeconds, MAX_BACKOFF_SECONDS);

    return {
        retryable: true,
        recommended_action: "retry_after_backoff",
        retry_after_seconds: backoffSeconds
    };
}