import { getDbDriver } from './config';
import * as pgSchema from './schema.pg';
import * as sqliteSchema from './schema.sqlite';

// The target database is fixed at deploy time (derived from DATABASE_URL). We
// expose a single set of table objects for the active driver; the store layer
// imports these and uses the shared Drizzle query builder, which emits the SQL
// dialect matching the connected client. Column names/shapes are identical
// across ./schema.pg.ts and ./schema.sqlite.ts, so we surface the PostgreSQL
// types as the canonical shape while swapping the runtime objects.
const active = getDbDriver() === 'sqlite' ? sqliteSchema : pgSchema;

export const consoleRequests = active.consoleRequests as unknown as typeof pgSchema.consoleRequests;
export const consoleApiKeys = active.consoleApiKeys as unknown as typeof pgSchema.consoleApiKeys;
export const consoleProviders = active.consoleProviders as unknown as typeof pgSchema.consoleProviders;
export const modelAliases = active.modelAliases as unknown as typeof pgSchema.modelAliases;
export const modelCatalogCache = active.modelCatalogCache as unknown as typeof pgSchema.modelCatalogCache;
export const modelMetadataOverrides = active.modelMetadataOverrides as unknown as typeof pgSchema.modelMetadataOverrides;
export const gatewaySettings = active.gatewaySettings as unknown as typeof pgSchema.gatewaySettings;
