# Local Manager capability installer diagnostics

The Local Manager capability installer is a governed, signed local action. A non-zero installer exit is a local execution failure, not evidence that the platform or Production Recovery database path should be retried or widened.

When the installer fails:

1. preserve the actual installer exit code in the local diagnostic envelope;
2. preserve the signed installer label and local artifact path only when they contain no token material;
3. classify UAC cancellation separately from process-launch failure and non-zero child exit;
4. do not copy installer tokens, device tokens, Cloudflare credentials, or generated secrets into the UI diagnostic;
5. run post-install runtime verification only after a zero child exit;
6. if post-install verification fails, report that separately from installer execution failure.

Cloudflare HTTP 520-527 failures from `auth.mad4b.com` belong to platform-origin availability classification and should remain retryable. They must not be conflated with a local capability installer child-process failure.
