import { TEST_DATABASE_URL } from './test-database';

function isTestProcess(): boolean {
  if (process.env.USE_TEST_DATABASE === '1') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return typeof Bun !== 'undefined' && Array.isArray(Bun.argv) && Bun.argv.includes('test');
}

export function getDatabaseUrl(): string {
  if (isTestProcess()) {
    if (!TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL is required for running tests. Set it in .env or your environment (see .env.example).');
    }
    return TEST_DATABASE_URL;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL');
  }

  return databaseUrl;
}
