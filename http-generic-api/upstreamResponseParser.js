function headerValue(headers = {}, name = "") {
  const expected = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || "").toLowerCase() === expected) return String(value || "");
  }
  return "";
}

export function resolveUpstreamResponseMode(requestPayload = {}, contentType = "") {
  const explicitMode = String(requestPayload?.response_mode || "").trim().toLowerCase();
  if (["raw_text", "text", "text_plain"].includes(explicitMode)) return "raw_text";
  if (["json", "application_json"].includes(explicitMode)) return "json";

  const expectJson = requestPayload?.expect_json;
  if (expectJson === false || String(expectJson || "").trim().toLowerCase() === "false") return "raw_text";
  if (expectJson === true || String(expectJson || "").trim().toLowerCase() === "true") return "json";

  const accept = headerValue(requestPayload?.headers, "accept").toLowerCase();
  if (accept.includes("application/vnd.github.raw")) return "raw_text";

  const normalizedContentType = String(contentType || "").toLowerCase();
  if (normalizedContentType.includes("application/json") || normalizedContentType.includes("+json")) return "json";
  return "raw_text";
}

export function isRawTextResponseRequest(requestPayload = {}, contentType = "") {
  return resolveUpstreamResponseMode(requestPayload, contentType) === "raw_text";
}

export async function readUpstreamResponse(upstream, requestPayload = {}) {
  const contentType = upstream?.headers?.get?.("content-type") || "";
  const responseMode = resolveUpstreamResponseMode(requestPayload, contentType);
  let data;
  let responseText = "";

  if (responseMode === "json") {
    data = await upstream.json();
    responseText = JSON.stringify(data);
  } else {
    data = await upstream.text();
    responseText = String(data || "");
  }

  return { data, responseText, contentType, responseMode };
}
