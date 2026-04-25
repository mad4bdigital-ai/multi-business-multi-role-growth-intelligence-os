// Exposes only the WordPress domain symbols consumed by the runtime layer.
// All other wordpress/* exports stay internal to the domain.
export {
  normalizeSiteMigrationPayload,
  validateSiteMigrationPayload,
  validateSiteMigrationRouteWorkflowReadiness,
  executeSiteMigrationJob,
  firstPopulated
} from "../wordpress/index.js";
