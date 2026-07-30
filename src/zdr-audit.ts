/**
 * Audit trail for ZDR *setting changes* only. Never records prompt/response
 * content — only who/when/where/what-action metadata.
 */
import { randomUUID } from 'crypto';
import { createDbClient, type DbClient } from './db/client';
import { zdrAuditLog } from './db/schema';

export type ZdrAuditScope = 'global' | 'model_group' | 'guardrail';

let db: DbClient | null = null;
function getDb(): DbClient {
  if (!db) db = createDbClient();
  return db;
}

export async function recordZdrAuditEvent(input: {
  action: string;
  scope: ZdrAuditScope;
  scopeId?: string | null;
  enabled: boolean;
  actorIp?: string | null;
  now?: number;
}): Promise<void> {
  await getDb().insert(zdrAuditLog).values({
    id: randomUUID(),
    action: input.action,
    scope: input.scope,
    scopeId: input.scopeId ?? null,
    enabled: input.enabled ? 1 : 0,
    actorIp: input.actorIp ?? null,
    createdAt: input.now ?? Date.now(),
  });
}
