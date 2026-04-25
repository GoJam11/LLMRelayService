import { encoding_for_model, get_encoding } from '@dqbd/tiktoken';

export interface TokenEstimate {
  input_tokens: number;
  output_tokens: number;
  estimated: true;
}

type EncodingType = ReturnType<typeof get_encoding>;

let cachedEncoder: EncodingType | null = null;

function getEncoder(modelName: string): EncodingType {
  try {
    return encoding_for_model(modelName as any);
  } catch {
    // Fallback to cl100k_base (GPT-3.5+/GPT-4 encoding)
    return get_encoding('cl100k_base');
  }
}

function countTokensInternal(text: string, encoder: EncodingType): number {
  try {
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch {
    // Fallback to character heuristic: ~1 token per 4 chars (English)
    return Math.ceil(text.length / 4);
  }
}

export function countTokens(text: string, modelName: string = 'gpt-3.5-turbo'): number {
  try {
    const encoder = getEncoder(modelName);
    return countTokensInternal(text, encoder);
  } catch {
    // Last resort: character heuristic
    return Math.ceil(text.length / 4);
  }
}

interface RequestMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

export function estimateInputTokens(requestBodyText: string | null): number {
  if (!requestBodyText) return 0;

  try {
    const parsed = JSON.parse(requestBodyText) as Record<string, any>;
    const messages = parsed.messages as RequestMessage[] | undefined;
    
    if (!Array.isArray(messages)) return 0;

    const encoder = cachedEncoder || get_encoding('cl100k_base');
    let totalTokens = 0;

    for (const msg of messages) {
      // ~4 tokens per message (overhead for role, metadata)
      totalTokens += 4;

      // Count content
      if (typeof msg.content === 'string') {
        totalTokens += countTokensInternal(msg.content, encoder);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block.text === 'string') {
            totalTokens += countTokensInternal(block.text, encoder);
          }
        }
      }
    }

    return totalTokens;
  } catch {
    // Can't parse or estimate, return 0
    return 0;
  }
}

export function estimateOutputTokens(responseText: string | null): number {
  if (!responseText) return 0;

  try {
    const encoder = cachedEncoder || get_encoding('cl100k_base');
    return countTokensInternal(responseText, encoder);
  } catch {
    return Math.ceil((responseText?.length ?? 0) / 4);
  }
}

// Initialize encoder on module load to avoid WASM init delay during request handling
export function initializeTokenEstimator(): void {
  try {
    cachedEncoder = get_encoding('cl100k_base');
  } catch (err) {
    console.warn('[TOKEN_ESTIMATOR_INIT]', 'Failed to initialize tiktoken encoder', err);
  }
}
