// Temporary no-effect trigger for PR #4069.
// Executes only the trusted-main read-only census job and is never merged.
export const authorityLiveCensusTrigger = Object.freeze({
  pull_request: 4069,
  trusted_ref: "main",
  synchronized_main: "d1e741f796732cb986ab97faa39e22c738f57d5a",
  read_only: true,
  migration_apply: false,
});
