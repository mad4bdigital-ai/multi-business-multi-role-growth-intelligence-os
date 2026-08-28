import routePolicy from "../generated/route-policy.staging.json" with { type: "json" };
import { createActivationGateway } from "./gateway.mjs";

// Replaced only by build-staging-worker.mjs in the deployment artifact. The
// checked-in entrypoint deliberately cannot attest an unbuilt Worker.
const workerBuildIdentity = /* WORKER_BUILD_IDENTITY */ null;
const handle = createActivationGateway({ policy: routePolicy, workerBuildIdentity });

export default {
  fetch(request, env, context) {
    return handle(request, env, context);
  },
};
