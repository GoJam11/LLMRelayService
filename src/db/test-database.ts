export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() ?? '';

export function isTrustedTestDatabaseUrl(databaseUrl: string): boolean {
  return Boolean(TEST_DATABASE_URL) && databaseUrl === TEST_DATABASE_URL;
}