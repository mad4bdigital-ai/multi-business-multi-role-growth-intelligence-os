import { getRecoveryPolicy } from './activationRecoveryPolicy.js';
import { buildRateLimitedClassification } from './activationClassification.js';
import { buildProgressState } from './activationProgress.js';
import { createJob } from './executionAsync.js'; 

export const SOLVER_JOB_TYPE = 'registry_validation_async_solver';

/**
 * Packages the 429 failure into a resumable background job and returns the HTTP envelope.
 * @param {Object} validationContext - The current execution state and context.
 * @returns {Promise<Object>} The async activation envelope to return to the caller.
 */
export async function promoteToAsyncSolver(validationContext) {
    const retryCount = validationContext.retry_count || 0;
    const recovery = getRecoveryPolicy(retryCount);

    if (!recovery.retryable) {
        throw new Error("Validation rate limit exceeded max retries. Execution aborted.");
    }

    // Package the work into a stable payload shape
    const jobPayload = {
        job_type: SOLVER_JOB_TYPE,
        validation_context: {
            activation_id: validationContext.activation_id,
            spreadsheet_id: validationContext.spreadsheet_id,
            auth: validationContext.auth,
            blocked_stage: "sheets_validation",
            pending_reads: validationContext.pending_reads,
            completed_stages: validationContext.completed_stages,
            retry_count: retryCount + 1
        }
    };

    // Queue through existing async runtime
    const job = await createJob({
        type: SOLVER_JOB_TYPE,
        payload: jobPayload,
        delaySeconds: recovery.retry_after_seconds
    });

    const progress = buildProgressState(
        validationContext.completed_stages,
        "sheets_validation"
    );

    // Return the canonical async activation envelope
    return {
        runtime_classification: buildRateLimitedClassification(progress),
        recovery: recovery,
        async_job: {
            job_id: job.id,
            status_url: `/jobs/${job.id}`,
            result_url: `/jobs/${job.id}/result`
        }
    };
}

/**
 * Resumes execution from the last checkpoint. Called by your background job runner.
 * @param {Object} jobPayload - The payload saved during promoteToAsyncSolver.
 * @param {Object} sheetsClient - An authenticated Google Sheets API client.
 * @returns {Promise<Object>} The final validation result.
 */
export async function resumeValidationJob(jobPayload, sheetsClient) {
    const { validation_context } = jobPayload;
    console.log(`[Solver] Resuming validation for activation ${validation_context.activation_id}...`);
    
    const results = {};
    const remainingReads = [...validation_context.pending_reads];

    for (const range of validation_context.pending_reads) {
        try {
            const response = await sheetsClient.spreadsheets.values.get({
                spreadsheetId: validation_context.spreadsheet_id,
                range: range,
            });
            
            results[range] = response.data.values;
            remainingReads.shift(); // Successfully read, remove from pending
            
        } catch (error) {
            if (error.code === 429 || error.status === 429) {
                error.resumableContext = {
                    ...validation_context,
                    pending_reads: remainingReads
                };
            }
            throw error;
        }
    }

    return {
        status: "active",
        alignment_audit: results,
        activation_id: validation_context.activation_id,
        completed_stages: [...validation_context.completed_stages, "sheets_validation"]
    };
}