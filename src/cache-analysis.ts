export const ANTHROPIC_CACHE_CREATION_MIN_INPUT_TOKENS = 1000;

export function isAnthropicCacheCreationUnlikely(inputTokens: number | null | undefined): boolean {
  const numeric = Number(inputTokens);
  return Number.isFinite(numeric)
    && numeric > 0
    && numeric < ANTHROPIC_CACHE_CREATION_MIN_INPUT_TOKENS;
}

