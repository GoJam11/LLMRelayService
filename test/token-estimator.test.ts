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
  });
});
