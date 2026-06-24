import { getPool } from "../../../db.js";
import { summarizeSessionIfNeeded } from "../../../sessionSummaryService.js";
import { runLiveResourceCoverageAudit } from "../../../resourceApiCoverageService.js";
import { createResourceApiService } from "../../application/resourceApi/resourceApiService.js";
import { createResourceRepository } from "./resourceRepository.js";

export function createDefaultResourceApiService(deps = {}) {
  let resolvedPool = deps.pool || null;
  const resolvePool = () => {
    if (!resolvedPool) resolvedPool = getPool();
    return resolvedPool;
  };
  const repository = deps.resourceRepository || createResourceRepository({ resolvePool });
  const getCallModelForClass = deps.getCallModelForClass;
  const callModel = deps.callModel;

  return createResourceApiService({
    repository,
    deploymentCommitSha: process.env.DEPLOYMENT_COMMIT_SHA || null,
    runCoverageAudit: (options) => runLiveResourceCoverageAudit(resolvePool(), options),
    summarizeSession: ({ session, force }) => {
      const selectedCallModel = getCallModelForClass
        ? getCallModelForClass("standard")
        : callModel;
      return summarizeSessionIfNeeded({
        pool: resolvePool(),
        session,
        callModel: selectedCallModel,
        force,
      });
    },
  });
}
