# Governed Production synchronization request

- branch creation main SHA: `79c303362b1514e0c41356bd21a2951fecac27ed`
- branch creation Production SHA: `09e1ae4c702360801e5ede9d39fe712a7e357e1c`
- execution policy: re-read both protected refs at workflow execution time
- candidate policy: exact current-main tree while preserving current Production ancestry
- merge requested by this marker: false
- deployment requested by this marker: false
- SQL or migration execution requested: false
- provider calls requested: false
- credential payload reads requested: false
- restart or external send requested: false
- secrets included: false

This marker only creates the governed request review surface. The bounded launcher must discard stale attempts, validate the exact candidate, and stop at candidate-specific Production merge authorization.