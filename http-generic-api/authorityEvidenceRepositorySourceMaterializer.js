import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
  AuthorityEvidenceRepositorySourceMaterializationError,
  finalizeAuthorityEvidenceRepositoryManifest as finalizeStrictManifest,
  materializeAuthorityEvidenceRepositorySourceDocuments,
} from "./authorityEvidenceRepositorySourceMaterializerStrict.js";

export {
  AUTHORITY_EVIDENCE_REPOSITORY_MANIFEST_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_CONTRACT,
  AUTHORITY_EVIDENCE_REPOSITORY_SOURCE_MATERIALIZATION_CONTRACT,
  AuthorityEvidenceRepositorySourceMaterializationError,
  materializeAuthorityEvidenceRepositorySourceDocuments,
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function repositoryRoot(value) {
  return fs.realpathSync(path.resolve(value));
}

function gitShow(root, observedRef, sourceFile) {
  const result = spawnSync("git", ["show", `${observedRef}:${sourceFile}`], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "");
}

function throwContentDriftBeforeDigest({ materializationReport, observedRef, root }) {
  if (!Array.isArray(materializationReport?.source_files)) return;
  for (const entry of materializationReport.source_files) {
    const sourceFile = String(entry?.source_file || "");
    if (!sourceFile || sourceFile.startsWith("/") || sourceFile.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")) {
      return;
    }
    const absolutePath = path.resolve(root, sourceFile);
    if (path.relative(root, absolutePath).replaceAll("\\", "/") !== sourceFile) return;
    let currentText;
    try {
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      currentText = fs.readFileSync(absolutePath, "utf8");
    } catch {
      return;
    }
    const currentHash = sha256(currentText);
    if (currentHash !== String(entry?.content_sha256 || "").toLowerCase()) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_current_content_mismatch",
        "A source document no longer matches the reviewed materialization report.",
        { source_file: sourceFile },
      );
    }
    const reviewedText = gitShow(root, observedRef, sourceFile);
    if (reviewedText !== null && sha256(reviewedText) !== currentHash) {
      throw new AuthorityEvidenceRepositorySourceMaterializationError(
        "authority_evidence_repository_materialization_reviewed_content_mismatch",
        "The current source document differs from the bytes committed at the reviewed ref.",
        { source_file: sourceFile },
      );
    }
  }
}

export function finalizeAuthorityEvidenceRepositoryManifest(options = {}) {
  try {
    return finalizeStrictManifest(options);
  } catch (error) {
    if (error?.code !== "authority_evidence_repository_materialization_report_digest_mismatch") throw error;
    const observedRef = String(options.observed_ref || "").trim().toLowerCase();
    if (/^[a-f0-9]{40}$/.test(observedRef)) {
      try {
        throwContentDriftBeforeDigest({
          materializationReport: options.materialization_report,
          observedRef,
          root: repositoryRoot(options.repository_root ?? process.cwd()),
        });
      } catch (compatibilityError) {
        if (compatibilityError instanceof AuthorityEvidenceRepositorySourceMaterializationError) {
          throw compatibilityError;
        }
      }
    }
    throw error;
  }
}
