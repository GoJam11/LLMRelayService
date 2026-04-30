/**
 * Pure model-allowlist matching logic.
 *
 * Kept in its own module (no DB imports) so it can be unit-tested in isolation
 * and imported from both the gateway request handler and the api-keys store.
 */

/**
 * Returns true if `model` is permitted by the given `patterns` list.
 *
 * Matching rules:
 *   - Exact string match: `"gpt-4o"` matches only `"gpt-4o"`.
 *   - Suffix wildcard: a pattern ending with `"*"` matches any model whose
 *     name starts with the prefix (e.g. `"claude-*"` matches
 *     `"claude-3-5-sonnet"` and `"claude-3-opus-20240229"`).
 *
 * Only a trailing `*` is supported; this is intentionally NOT a full glob.
 *
 * Semantic note: the check is always performed against the **client-requested
 * model name before alias resolution** (`originalRequestModel`), NOT against
 * the resolved upstream model (`route.resolvedModel`). This allows admins to
 * allow a public alias such as `"fast"` while preventing direct access to the
 * underlying model (e.g. `"gpt-4o"`):
 *
 *   allowed_models = ["fast"]
 *   "fast" → gpt-4o (via alias resolution)
 *
 *   request { "model": "fast" }   → allowed  ✓
 *   request { "model": "gpt-4o" } → denied   ✗
 */
export function isModelAllowed(model: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return model.startsWith(pattern.slice(0, -1));
    }
    return model === pattern;
  });
}
