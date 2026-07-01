function text(value = "") {
  return String(value ?? "").trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!text(value)) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function brandHost(value = "") {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/, 1)[0];
  }
}

function normalizeUnicodeDigits(value = "") {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicIndic = "۰۱۲۳۴۵۶۷۸۹";
  return String(value || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabicIndic.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    const easternIndex = easternArabicIndic.indexOf(digit);
    return easternIndex >= 0 ? String(easternIndex) : digit;
  });
}

export function brandReferenceScript(value = "") {
  const raw = text(value);
  if (/\p{Script=Arabic}/u.test(raw)) return "Arab";
  if (/\p{Script=Latin}/u.test(raw)) return "Latn";
  if (/\p{L}/u.test(raw)) return "Other";
  return "Unknown";
}

export function normalizeHumanBrandReference(value = "") {
  let normalized = normalizeUnicodeDigits(text(value).normalize("NFKC").toLowerCase());
  if (!normalized) return "";
  normalized = normalized
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

export function normalizeBrandReference(value = "") {
  const raw = text(value).normalize("NFKC").toLowerCase();
  if (!raw) return "";
  const host = brandHost(raw);
  const candidate = host && (raw.includes("://") || raw.includes("/") || raw.includes("."))
    ? host
    : raw;
  return candidate
    .replace(/^www\./, "")
    .replace(/\/wp-json\/?$/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function brandRowReferences(row = {}) {
  const aliases = parseJsonArray(row.site_aliases_json ?? row.site_aliases);
  const values = [
    row.brand_key,
    row.target_key,
    row.brand_name,
    row.normalized_brand_name,
    row.brand_domain,
    row.primary_site_key,
    row.base_url,
    row.website_url,
    ...aliases,
  ];
  const normalized = new Set();
  for (const value of values) {
    const key = normalizeBrandReference(value);
    if (key) normalized.add(key);
    const host = brandHost(value);
    const hostKey = normalizeBrandReference(host);
    if (hostKey) normalized.add(hostKey);
  }
  return [...normalized];
}

export function brandRowMatchesReference(row = {}, reference = "") {
  const wanted = normalizeBrandReference(reference);
  return Boolean(wanted && brandRowReferences(row).includes(wanted));
}

function rowPriority(row = {}, reference = "") {
  const wanted = normalizeBrandReference(reference);
  if (!wanted) return 0;
  const exactTarget = normalizeBrandReference(row.target_key || row.brand_key) === wanted;
  const exactDomain = normalizeBrandReference(row.brand_domain || brandHost(row.base_url)) === wanted;
  const exactName = normalizeBrandReference(row.normalized_brand_name || row.brand_name) === wanted;
  if (exactTarget) return 100;
  if (exactDomain) return 95;
  if (exactName) return 90;
  return brandRowMatchesReference(row, reference) ? 80 : 0;
}

export function resolveBrandReference({ reference = "", rows = [] } = {}) {
  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: rowPriority(row, reference) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return {
      status: "not_found",
      reference: text(reference),
      normalized_reference: normalizeBrandReference(reference),
      row: null,
      canonical_brand_key: "",
    };
  }

  const topScore = ranked[0].score;
  const topRows = ranked.filter((entry) => entry.score === topScore);
  const canonicalKeys = new Set(
    topRows.map(({ row }) => text(row.target_key || row.brand_key)).filter(Boolean)
  );
  if (canonicalKeys.size > 1) {
    return {
      status: "ambiguous",
      reference: text(reference),
      normalized_reference: normalizeBrandReference(reference),
      candidate_keys: [...canonicalKeys],
      row: null,
      canonical_brand_key: "",
    };
  }

  const row = topRows[0].row;
  return {
    status: "resolved",
    reference: text(reference),
    normalized_reference: normalizeBrandReference(reference),
    row,
    canonical_brand_key: text(row.target_key || row.brand_key),
    canonical_brand_name: text(row.brand_name || row.normalized_brand_name),
    brand_domain: text(row.brand_domain || brandHost(row.base_url)),
  };
}

export function extractGoogleFileId(value = "") {
  const raw = text(value);
  if (!raw) return "";
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw)) return raw;
  const patterns = [
    /\/document\/d\/([A-Za-z0-9_-]+)/,
    /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/,
    /\/presentation\/d\/([A-Za-z0-9_-]+)/,
    /\/file\/d\/([A-Za-z0-9_-]+)/,
    /[?&]id=([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}
