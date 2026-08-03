from pathlib import Path


def one(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"anchor count for {path}: {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

lifecycle_anchor = '''      validation_phase: "post_approval_pre_merge_readback",
      secrets_included: false,
    });
  }

  const merge = await githubLifecycleRequest({
'''
lifecycle_insert = '''      validation_phase: "post_approval_pre_merge_readback",
      secrets_included: false,
    });
  }

  const finalReviewsResponse = await githubLifecycleRequest({
    owner,
    repo,
    apiPath: `/pulls/${pullNumber}/reviews?per_page=100`,
    token,
    fetchImpl: options.fetchImpl,
  });
  const finalReviews = Array.isArray(finalReviewsResponse.payload) ? finalReviewsResponse.payload : [];
  if (!Array.isArray(finalReviewsResponse.payload) || finalReviews.length >= 100) {
    throw lifecycleError(409, "github_pr_finalize_review_set_unbounded", "Final exact-head review evidence could not be bounded to one complete page.", {
      pull_number: pullNumber,
      returned_review_count: finalReviews.length,
      per_page: 100,
      validation_phase: "final_pre_merge_review_readback",
      secrets_included: false,
    });
  }
  const finalApprovalEvidence = summarizeGithubPullRequestApprovals(finalReviews, {
    expectedHeadSha,
    authorLogin: postApprovalPr?.user?.login || pr?.user?.login,
    requiredApprovals: options.required_approvals || options.requiredApprovals || 1,
  });
  if (finalApprovalEvidence.has_changes_requested) {
    throw lifecycleError(409, "github_pr_finalize_changes_requested", "Final exact-head review evidence contains an active changes-requested decision.", {
      ...finalApprovalEvidence,
      validation_phase: "final_pre_merge_review_readback",
    });
  }
  if (!finalApprovalEvidence.quorum_satisfied) {
    throw lifecycleError(409, "github_pr_finalize_approval_required", "Final exact-head human approval quorum is not satisfied.", {
      ...finalApprovalEvidence,
      validation_phase: "final_pre_merge_review_readback",
    });
  }

  const merge = await githubLifecycleRequest({
'''
one("http-generic-api/githubRepositoryLifecycle.js", lifecycle_anchor, lifecycle_insert)

p = Path("http-generic-api/githubRepositoryLifecycle.js")
text = p.read_text(encoding="utf-8")
if text.count("approval_evidence: approvalEvidence") != 2:
    raise SystemExit("approval audit anchors changed")
p.write_text(text.replace("approval_evidence: approvalEvidence", "approval_evidence: finalApprovalEvidence"), encoding="utf-8")

success_anchor = '''      { status: 200, payload: [{ id: 9001, state: "APPROVED", commit_id: HEAD_SHA, submitted_at: "2026-08-03T04:30:00Z", user: { login: "human-reviewer", type: "User" } }] },
      { status: 200, payload: { number: pullNumber, state: "open", draft: false, user: { login: "pr-author", type: "User" }, base: { ref: "main", sha: BASE_SHA }, head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: { merged: true, sha: COMMIT_SHA, message: "merged" } },
'''
success_replacement = '''      { status: 200, payload: [{ id: 9001, state: "APPROVED", commit_id: HEAD_SHA, submitted_at: "2026-08-03T04:30:00Z", user: { login: "human-reviewer", type: "User" } }] },
      { status: 200, payload: { number: pullNumber, state: "open", draft: false, user: { login: "pr-author", type: "User" }, base: { ref: "main", sha: BASE_SHA }, head: { ref: branch, sha: HEAD_SHA, repo: { full_name: `${OWNER}/${REPO}` } } } },
      { status: 200, payload: [{ id: 9002, state: "APPROVED", commit_id: HEAD_SHA, submitted_at: "2026-08-03T04:31:00Z", user: { login: "human-reviewer", type: "User" } }] },
      { status: 200, payload: { merged: true, sha: COMMIT_SHA, message: "merged" } },
'''
one("http-generic-api/test-github-repository-lifecycle.mjs", success_anchor, success_replacement)
print("compact final review-state patch applied")
