// Route-surface compatibility wrapper. The OAuth implementation lives outside
// routes/ so JWT signing and verification remain centralized in a shared runtime.
export { buildRemoteMcpOAuthRoutes } from "../oauth/remoteMcpOAuthRoutes.js";
