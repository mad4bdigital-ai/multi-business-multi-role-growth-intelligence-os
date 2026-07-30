// frontend-surface-operation: POST /admin/container-authority/canary-promotions
// frontend-state-change-proof: POST /admin/container-authority/canary-promotions
// frontend-surface-operation: POST /admin/container-authority/canary-rollbacks
// frontend-state-change-proof: POST /admin/container-authority/canary-rollbacks
// frontend-surface-operation: POST /admin/container-authority/canary-closeouts
// frontend-state-change-proof: POST /admin/container-authority/canary-closeouts

await import("./test-dynamic-container-rollout-safety.mjs");

console.log("dynamic container canary state-change evidence tests passed");
