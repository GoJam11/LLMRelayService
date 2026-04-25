import { describe, it, expect } from 'bun:test';
import { countTokens, estimateInputTokens, estimateOutputTokens } from '../src/token-estimator';

describe('Token Estimator', () => {
  describe('countTokens', () => {
    it('counts tokens for basic English text', () => {
      const text = 'Hello world';
      const tokens = countTokens(text, 'gpt-3.5-turbo');
      // Should be around 2-3 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('counts tokens for longer text', () => {
      const text = 'The quick brown fox jumps over the lazy dog. This is a test sentence.';
      const tokens = countTokens(text, 'gpt-3.5-turbo');
      // ~16-20 tokens expected
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(30);
    });

    it('returns fallback for empty text', () => {
      const tokens = countTokens('', 'gpt-3.5-turbo');
      expect(tokens).toBe(0);
    });
  });

  describe('estimateInputTokens', () => {
    it('estimates tokens from chat messages', () => {
      const requestBody = JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        model: 'gpt-3.5-turbo',
      });

      const tokens = estimateInputTokens(requestBody);
      // ~4 per message + content = ~12-15 tokens expected
      expect(tokens).toBeGreaterThan(0);
    });

    it('returns 0 for null body', () => {
      const tokens = estimateInputTokens(null);
      expect(tokens).toBe(0);
    });

    it('returns 0 for invalid JSON', () => {
      const tokens = estimateInputTokens('{ invalid json }');
      expect(tokens).toBe(0);
    });

    it('handles messages with array content', () => {
      const requestBody = JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image_url', url: 'https://example.com/image.jpg' },
            ],
          },
        ],
        model: 'gpt-4-vision',
      });

      const tokens = estimateInputTokens(requestBody);
      expect(tokens).toBeGreaterThan(0);
    });

    it('includes Anthropic system prompts and tool definitions', () => {
      const requestBody = JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        system: 'Answer with concise JSON.',
        tools: [
          {
            name: 'lookup',
            input_schema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Find the latest invoice total.' }],
          },
        ],
      });

      const tokens = estimateInputTokens(requestBody);
      expect(tokens).toBeGreaterThan(countTokens('Find the latest invoice total.'));
    });
  });

  describe('estimateOutputTokens', () => {
    it('estimates tokens from response text', () => {
      const responseText = 'The answer is 42. This is a longer response with more words.';
      const tokens = estimateOutputTokens(responseText);
      // ~10-15 tokens expected
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(25);
    });

    it('returns 0 for null response', () => {
      const tokens = estimateOutputTokens(null);
      expect(tokens).toBe(0);
    });

    it('returns 0 for empty response', () => {
      const tokens = estimateOutputTokens('');
      expect(tokens).toBe(0);
    });

    it('estimates OpenAI JSON output from assistant content instead of the raw envelope', () => {
      const content = 'The answer is 42.';
      const response = JSON.stringify({
        id: 'chatcmpl-test',
        choices: [{ message: { role: 'assistant', content } }],
      });

      expect(estimateOutputTokens(response)).toBe(countTokens(content));
    });

    it('estimates Anthropic SSE output from text deltas', () => {
      const response = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: message_stop
data: {"type":"message_stop"}`;

      expect(estimateOutputTokens(response)).toBe(countTokens('Hello world'));
    });

    it('does not double count OpenAI Responses SSE completed envelopes', () => {
      const response = `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Hello"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":" world"}

event: response.completed
data: {"type":"response.completed","response":{"output_text":"Hello world"}}`;

      expect(estimateOutputTokens(response)).toBe(countTokens('Hello world'));
    });

    it('returns 0 for JSON error envelopes without assistant output', () => {
      const response = JSON.stringify({
        error: { type: 'overloaded_error', message: 'Overloaded' },
      });

      expect(estimateOutputTokens(response)).toBe(0);
    });
  });
});
