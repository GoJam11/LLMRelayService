import * as pgSchema from './schema.pg';
import * as sqliteSchema from './schema.sqlite';
import { getDbDialect } from './config';

// 运行时按方言导出对应的表对象（PostgreSQL 或 SQLite）。静态类型统一按 PG 版声明，
// 两份 schema 的表名/列名/取值语义完全一致，drizzle 查询构建器 API 也一致，因此上层
// 查询代码无需感知方言；生成的 SQL 由运行时实际的表对象与客户端方言决定。
// 方言分叉的原生 SQL（如 db.execute 的 PG CTE）必须在调用处显式按 getDbDialect() 分支。
const activeSchema = (getDbDialect() === 'sqlite' ? sqliteSchema : pgSchema) as unknown as typeof pgSchema;

export const consoleRequests = activeSchema.consoleRequests;
export const consoleApiKeys = activeSchema.consoleApiKeys;
export const consoleProviders = activeSchema.consoleProviders;
export const modelAliases = activeSchema.modelAliases;
export const modelCatalogCache = activeSchema.modelCatalogCache;
export const modelMetadataOverrides = activeSchema.modelMetadataOverrides;
export const gatewaySettings = activeSchema.gatewaySettings;
