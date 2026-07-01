import { extractGoogleFileId } from "./resolvers/brandReferenceResolver.js";

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeAuditSiteUrl(value = "") {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}/`;
  } catch {
    return "";
  }
}

export function classifyAuditEvidence(input = {}) {
  const source = text(input.source, 64).toLowerCase();
  const sourceDetected = input.source_detected === true;
  const renderedAttempted = input.rendered_attempted === true;
  const renderedVisible = input.rendered_visible === true;
  const conditional = input.conditional === true;

  let classification = "unverified";
  if (source === "brand_core" || source === "strategy_document") classification = "document_authority";
  else if (source === "tracker" || source === "implementation_tracker") classification = "tracker_state";
  else if (renderedVisible) classification = "rendered_visible";
  else if (conditional) classification = "conditional";
  else if (renderedAttempted && sourceDetected) classification = "hidden_template_fallback";
  else if (renderedAttempted && !renderedVisible) classification = "rendered_not_reproduced";
  else if (sourceDetected) classification = "source_only";

  return {
    classification,
    report_as_visitor_issue: classification === "rendered_visible",
    requires_visual_confirmation: ["source_only", "hidden_template_fallback", "conditional", "unverified"].includes(classification),
  };
}

function detectGoogleProduct(url = "") {
  const href = text(url).toLowerCase();
  if (href.includes("/document/d/")) return "google_docs";
  if (href.includes("/spreadsheets/d/")) return "google_sheets";
  if (href.includes("/presentation/d/")) return "google_slides";
  return "drive_binary_or_unknown";
}

function readStrategyForProduct(product) {
  if (product === "google_docs") {
    return { read_strategy: "docs_api_chunked", fallback_strategy: "drive_export_text_plain" };
  }
  if (product === "google_sheets") {
    return { read_strategy: "sheets_api_range_chunked", fallback_strategy: "drive_export_text_csv" };
  }
  if (product === "google_slides") {
    return { read_strategy: "slides_api_chunked", fallback_strategy: "drive_export_text_plain" };
  }
  return { read_strategy: "metadata_only_manual_review", fallback_strategy: "manual_review" };
}

function resourceSteps(product) {
  if (product === "google_docs") {
    return [
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "getFileMetadata",
        purpose: "confirm_mime_type_and_resource_authority",
      },
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "drive_export_workspace_file",
        purpose: "export_plain_text",
        query: { mimeType: "text/plain" },
      },
    ];
  }
  if (product === "google_sheets") {
    return [
      {
        parent_action_key: "google_sheets_api",
        endpoint_key: "getSpreadsheet",
        purpose: "list_sheet_metadata",
      },
      {
        parent_action_key: "google_sheets_api",
        endpoint_key: "getSheetValues",
        purpose: "read_selected_ranges_with_pagination",
      },
    ];
  }
  if (product === "google_slides") {
    return [
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "getFileMetadata",
        purpose: "confirm_mime_type_and_resource_authority",
      },
      {
        parent_action_key: "google_drive_api",
        endpoint_key: "drive_export_workspace_file",
        purpose: "export_plain_text",
        query: { mimeType: "text/plain" },
      },
    ];
  }
  return [
    {
      parent_action_key: "google_drive_api",
      endpoint_key: "getFileMetadata",
      purpose: "metadata_first_manual_review",
    },
  ];
}

export function buildAuditResourceReadPlan(url = "") {
  const resourceUrl = text(url);
  const fileId = extractGoogleFileId(resourceUrl);
  const product = detectGoogleProduct(resourceUrl);
  const strategy = readStrategyForProduct(product);
  const blockers = [];
  if (!fileId) blockers.push("google_file_id_required");

  return {
    resource_url: resourceUrl,
    file_id: fileId || null,
    detected_product: product,
    capability_key: "files.object.read",
    credential_scope: "auto",
    resolution_status: fileId ? "planned" : "blocked",
    read_strategy: strategy.read_strategy,
    fallback_strategy: strategy.fallback_strategy,
    canonical_steps: resourceSteps(product),
    continuation_required: true,
    provider_call_executed: false,
    blockers,
    secrets_included: false,
  };
}
