import { getPool } from "../../../db.js";
import { summarizeSessionIfNeeded } from "../../../sessionSummaryService.js";
import { runLiveResourceCoverageAudit } from "../../../resourceApiCoverageService.js";
import { createResourceApiService } from "../../application/resourceApi/resourceApiService.js";
import { createResourceRepository } from "./resourceRepository.js";

export function createDefaultResourceApiService(deps = {}) {
  const pool = deps.pool || getPool();
  const repository = deps.resourceRepository || createResourceRepository({ pool });
  const getCallModelForClass = deps.getCallModelForClass;
  const callModel = deps.callModel;

  return createResourceApiService({
    repository,
    deploymentCommitSha: process.env.DEPLOYMENT_COMMIT_SHA || null,
    runCoverageAudit: (options) => runLiveResourceCoverageAudit(pool, options),
    summarizeSession: ({ session, force }) => {
      const selectedCallModel = getCallModelForClass
        ? getCallModelForClass("standard")
        : callModel;
      return summarizeSessionIfNeeded({
        pool,
        session,
        callModel: selectedCallModel,
        force,
      });
    },
  });
}
