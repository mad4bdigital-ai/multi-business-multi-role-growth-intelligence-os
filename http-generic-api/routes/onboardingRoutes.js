import { Router } from "express";

/**
 * Legacy onboarding routes are intentionally empty.
 *
 * `/connect` is owned by connectRoutes.js. Keeping a second `/connect`
 * handler here can shadow the tenant connector UI when route registration
 * order changes or production revisions drift.
 */
export function buildOnboardingRoutes() {
  return Router();
}
