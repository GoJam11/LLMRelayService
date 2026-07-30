/**
 * Short-lived, single-use "step-up auth" tokens for sensitive settings
 * changes (currently: disabling ZDR). Minted only after the caller has
 * re-verified their password. A token:
 *   - is valid for PRIVILEGED_TOKEN_TTL_MS (5 minutes) from issuance
 *   - authorizes exactly one `purpose` (e.g. "zdr.disable")
 *   - is single-use: `consumeZdrPrivilegedToken` marks it consumed atomically
 *     and rejects any later redemption attempt, even if not yet expired
 */
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { createDbClient, type DbClient } from './db/client';
import { zdrPrivilegedTokens } from './db/schema';

export const PRIVILEGED_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

let db: DbClient | null = null;
function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedPrivilegedToken {
  token: string;
  expiresAt: number;
}

export async function issueZdrPrivilegedToken(purpose: string, now = Date.now()): Promise<IssuedPrivilegedToken> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = now + PRIVILEGED_TOKEN_TTL_MS;

  await getDb().insert(zdrPrivilegedTokens).values({
    id: randomUUID(),
    tokenHash: hashToken(token),
    purpose,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  });

  return { token, expiresAt };
}

/**
 * Validates and consumes a privileged token for `purpose`. Returns true only
 * if the token exists, matches the purpose, is unexpired, and had not
 * already been consumed — and atomically marks it consumed in that case so
 * it cannot be redeemed again.
 */
export async function consumeZdrPrivilegedToken(token: string, purpose: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const database = getDb();

  const rows = await database
    .select()
    .from(zdrPrivilegedTokens)
    .where(and(eq(zdrPrivilegedTokens.tokenHash, tokenHash), isNull(zdrPrivilegedTokens.consumedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  if (row.purpose !== purpose) return false;
  if (row.expiresAt <= now) return false;

  const result = await database
    .update(zdrPrivilegedTokens)
    .set({ consumedAt: now })
    .where(and(eq(zdrPrivilegedTokens.id, row.id), isNull(zdrPrivilegedTokens.consumedAt)));

  // Some drivers don't return affected-row counts consistently across dialects;
  // re-select to confirm this call actually won the race to consume it.
  const confirmRows = await database
    .select()
    .from(zdrPrivilegedTokens)
    .where(eq(zdrPrivilegedTokens.id, row.id))
    .limit(1);

  void result;
  return confirmRows[0]?.consumedAt === now;
}
