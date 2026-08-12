# GitHub Enforcement Live Read-only Evidence

The live GitHub API readback for `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os` on 2026-08-12 showed the repository owner account has admin, maintain, push, pull, and triage permissions. `main` remains the default branch.

The classic branch protection endpoint returned null policy sections for required status checks, required pull request reviews, admin enforcement, and restrictions. The rulesets listing returned no active repository ruleset. This means CI jobs exist and run, but required-check enforcement is not active on `main`.

The latest CI run for `feat/safe-spec-portfolio-baseline` at SHA `c9f0e5f30c28cd410f642de1d6e3d92eac838606` completed successfully. The run included Syntax Check, Unit & Integration Tests, Spec 015 Contract Governance, Architecture Drift Detection, and Execution Resolver Gate.

The authenticated GitHub installation list exposed a selected `manus-connector` GitHub App installation with app ID `1869309` and installation ID `153171787`. No private key or token value was read or stored. The repository installation endpoint itself could not be decoded with the current user token and returned HTTP 401; therefore the installation IDs are evidence for identity matching only, not proof that a policy controller may use them for apply.

No branch protection, ruleset, DNS, provider, migration, or Production mutation was executed during this read-only check.
