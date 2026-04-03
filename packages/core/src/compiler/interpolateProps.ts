/**
 * Interpolate `{{key}}` mustache-style placeholders in HTML content
 * using values from a `data-props` JSON attribute.
 *
 * Supports:
 * - `{{key}}` — replaced with the value (HTML-escaped for safety)
 * - Nested keys are NOT supported (flat key-value only)
 * - Unmatched placeholders are left as-is (no error)
 *
 * Values are coerced to strings. Numbers and booleans are stringified.
 */

const MUSTACHE_RE = /\{\{(\s*[\w.-]+\s*)\}\}/g;

/**
 * Parse `data-props` JSON from an element attribute.
 * Returns null if the attribute is missing or invalid JSON.
 */
export function parseVariableValues(
  raw: string | null | undefined,
): Record<string, string | number | boolean> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, string | number | boolean>;
  } catch {
    return null;
  }
}

/**
 * Escape a string for safe insertion into HTML content.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Interpolate `{{key}}` placeholders in an HTML string using the provided values.
 * Values are HTML-escaped to prevent XSS. Unmatched placeholders are preserved.
 */
export function interpolateProps(
  html: string,
  values: Record<string, string | number | boolean>,
): string {
  if (!html || Object.keys(values).length === 0) return html;
  return html.replace(MUSTACHE_RE, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key in values) {
      return escapeHtml(String(values[key]));
    }
    return _match; // preserve unmatched placeholders
  });
}

/**
 * Interpolate props in script content. Values are NOT HTML-escaped here
 * since they'll be used as JavaScript string values.
 * Replaces `{{key}}` with the raw string value.
 */
export function interpolateScriptProps(
  scriptContent: string,
  values: Record<string, string | number | boolean>,
): string {
  if (!scriptContent || Object.keys(values).length === 0) return scriptContent;
  return scriptContent.replace(MUSTACHE_RE, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key in values) {
      const val = values[key];
      // For strings, return the raw value (caller wraps in quotes if needed)
      // For numbers/booleans, return the stringified value
      return String(val);
    }
    return _match;
  });
}
