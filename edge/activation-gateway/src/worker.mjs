import routePolicy from "../generated/route-policy.json" with { type: "json" };
import { createActivationGateway } from "./gateway.mjs";

const handle = createActivationGateway({ policy: routePolicy });

export default {
  fetch(request, env, context) {
    return handle(request, env, context);
  },
};
