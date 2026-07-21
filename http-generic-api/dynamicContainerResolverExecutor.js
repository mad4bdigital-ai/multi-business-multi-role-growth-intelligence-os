import { resolveEffectiveContainerContext } from "./dynamicContainerAuthorityResolver.js";
import {
  loadContainerAuthorityState,
  persistContainerResolution,
  persistShadowComparison,
  readContainerAuthorityEpoch,
  readContainerRolloutPolicy,
  readIdempotentResult,
  recordContainerPerformanceSample,
  storeIdempotentResult
} from "./dynamicContainerAuthorityRepository.js";

export function buildContainerResolverExecutorDependencies(executor) {
  if (!executor?.query) {
    throw Object.assign(new Error("A SQL executor is required."),{
      code:"container_resolver_executor_required",
      status:500
    });
  }
  return {
    loadState:input => loadContainerAuthorityState(input,executor),
    readEpoch:tenantId => readContainerAuthorityEpoch(tenantId,executor),
    persistResolution:resolution => persistContainerResolution(resolution,executor),
    persistComparison:comparison => persistShadowComparison(comparison,executor),
    recordPerformance:sample => recordContainerPerformanceSample(sample,executor),
    readPolicy:() => readContainerRolloutPolicy("dynamic_container_authority_v1",executor),
    readIdempotency:(scopeKey,idempotencyKey) => readIdempotentResult(scopeKey,idempotencyKey,executor),
    storeIdempotency:input => storeIdempotentResult(input,executor)
  };
}

export async function resolveContainerContextWithExecutor(input,executor,dependencies={}) {
  return resolveEffectiveContainerContext(input,{
    ...buildContainerResolverExecutorDependencies(executor),
    ...dependencies
  });
}
