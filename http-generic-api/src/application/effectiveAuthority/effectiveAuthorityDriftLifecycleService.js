import { normalizeAuthorityDriftLifecycleTransition } from "../../domain/effectiveAuthority/effectiveAuthorityDriftLifecycle.js";

export function createEffectiveAuthorityDriftLifecycleService({
  repository,
  now = () => new Date(),
} = {}) {
  if (!repository || typeof repository.transitionDriftEvent !== "function") {
    throw new TypeError(
      "Effective authority drift lifecycle service requires repository.transitionDriftEvent()."
    );
  }

  async function transition(input = {}) {
    const normalized = normalizeAuthorityDriftLifecycleTransition({
      ...input,
      transitionedAt: input.transitionedAt ?? now(),
    });
    return repository.transitionDriftEvent(normalized);
  }

  return Object.freeze({ transition });
}
