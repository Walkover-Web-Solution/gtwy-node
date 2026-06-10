// Build a jsonpath that matches any JSON key name, at any nesting depth, containing
// `term` as a case-insensitive substring. Escaping order matters:
// 1) regex-escape so metacharacters (. * ( [ \ etc.) match literally in like_regex
// 2) JSON.stringify to produce a valid jsonpath string literal (handles " and \)
// keyvalue() is inside the filter predicate so scalars visited by $.** evaluate to
// false per-item instead of erroring.
export function buildKeySearchJsonpath(term) {
  const regexEscaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `lax $.** ? (@.keyvalue().key like_regex ${JSON.stringify(regexEscaped)} flag "i")`;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const appendKey = (base, key) => (IDENTIFIER_RE.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`);

// Recursively collect paths of keys whose name contains termLower (case-insensitive).
// Mirrors the SQL jsonpath predicate: key names only, never values; arrays indexed as [i].
export function findMatchedKeyPaths(node, termLower, basePath = "data", out = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findMatchedKeyPaths(item, termLower, `${basePath}[${i}]`, out));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const path = appendKey(basePath, key);
      if (key.toLowerCase().includes(termLower)) out.push(path);
      findMatchedKeyPaths(value, termLower, path, out);
    }
  }
  return out;
}
