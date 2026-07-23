# Dynamic Context and Hardcoding Policy

## Prohibited in production source and shared configuration

- literal tenant identifiers;
- literal user identifiers;
- literal workspace identifiers or customer-specific keys;
- literal brand identifiers or customer names used for routing;
- literal connection or provider-account identifiers;
- default tenant or default customer fallbacks;
- selection using the first database or API result without uniqueness validation;
- customer-specific branches in shared domain or application code;
- guessed SQL table or column names when a governed schema or registry adapter exists.

## Allowed constants

- resource type names;
- capability keys defined in registries;
- lifecycle states;
- risk classes;
- stable machine-readable error codes;
- feature-flag names;
- protocol and schema versions.

## Test and documentation exceptions

Synthetic identifiers MAY appear in:

- isolated fixtures;
- migration test data;
- OpenAPI examples;
- documentation examples.

They MUST be visibly synthetic, generated where practical, and prevented from matching production records.

## CI checks

- scan production paths for UUID and customer-key literals;
- reject zero-tenant or default-customer fallbacks outside approved fixtures;
- reject unsafe `first`, index-zero, or unqualified `LIMIT 1` selection in context and connection resolvers;
- scan router and resolver code for known customer labels;
- verify OpenAPI examples use synthetic placeholders;
- verify every context resolver accepts authenticated principal evidence and registry repositories;
- verify tenant predicates are applied to graph and connection queries;
- maintain a narrow allowlist with file, reason, owner, and expiry.

## Review rule

Any exception requires a security review, an explicit expiry, and a regression test proving it cannot affect production routing.
