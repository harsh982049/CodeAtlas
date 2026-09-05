import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { JsonObject } from "@codeatlas/shared";

export const snapshotStatus = pgEnum("snapshot_status", ["BUILDING", "READY", "FAILED"]);
export const fileRole = pgEnum("file_role", ["SOURCE", "PROJECT_CONFIGURATION"]);
export const entityType = pgEnum("entity_type", [
  "REPOSITORY", "MODULE", "FILE", "FUNCTION", "METHOD", "CONSTRUCTOR", "CLASS",
  "INTERFACE", "TYPE_ALIAS", "ENUM", "VARIABLE", "COMPONENT", "API_ROUTE", "TEST",
  "EXTERNAL_PACKAGE", "UNRESOLVED",
]);
export const identityStability = pgEnum("identity_stability", ["HIGH", "MEDIUM", "LOW"]);
export const edgeType = pgEnum("edge_type", [
  "CONTAINS", "IMPORTS", "EXPORTS", "CALLS", "REFERENCES", "EXTENDS", "IMPLEMENTS",
  "INSTANTIATES", "ROUTES_TO", "TESTS", "DEPENDS_ON", "POSSIBLE_CALL",
]);
export const evidenceKind = pgEnum("evidence_kind", ["STATIC_RESOLUTION", "SYNTAX", "HEURISTIC"]);
export const diagnosticSeverity = pgEnum("diagnostic_severity", ["INFO", "WARNING", "ERROR"]);
export const unresolvedReason = pgEnum("unresolved_reason", [
  "ABSENT_DEPENDENCY", "AMBIGUOUS_TARGET", "COMPUTED_SPECIFIER", "DYNAMIC_DISPATCH",
  "MALFORMED_SOURCE", "OUTSIDE_ANALYSIS_SCOPE", "UNSUPPORTED_SYNTAX",
]);
export const indexJobStatus = pgEnum("index_job_status", ["RUNNING", "SUCCEEDED", "FAILED"]);
export const pinType = pgEnum("snapshot_pin_type", ["MANUAL", "ACTIVE_DIFF", "ACTIVE_PR"]);

const createdAt = timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  logicalId: text("logical_id").notNull(),
  name: text("name").notNull(),
  currentSnapshotId: uuid("current_snapshot_id"),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("repositories_logical_id_unique").on(table.logicalId),
  unique("repositories_id_current_snapshot_unique").on(table.id, table.currentSnapshotId),
  index("repositories_current_snapshot_idx").on(table.currentSnapshotId),
  check("repositories_logical_id_nonempty", sql`length(btrim(${table.logicalId})) > 0`),
  check("repositories_name_nonempty", sql`length(btrim(${table.name})) > 0`),
]);

export const repositorySnapshots = pgTable("repository_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  commitSha: varchar("commit_sha", { length: 64 }).notNull(),
  analyzerName: text("analyzer_name").notNull(),
  analyzerVersion: text("analyzer_version").notNull(),
  status: snapshotStatus("status").notNull().default("BUILDING"),
  createdAt,
  readyAt: timestamp("ready_at", { withTimezone: true, mode: "date" }),
  failedAt: timestamp("failed_at", { withTimezone: true, mode: "date" }),
  failureStage: text("failure_stage"),
  failureCode: text("failure_code"),
  failureSummary: text("failure_summary"),
  fileCount: integer("file_count").notNull().default(0),
  entityCount: integer("entity_count").notNull().default(0),
  edgeCount: integer("edge_count").notNull().default(0),
  diagnosticCount: integer("diagnostic_count").notNull().default(0),
  unresolvedCount: integer("unresolved_count").notNull().default(0),
  analysisStats: jsonb("analysis_stats").$type<JsonObject>(),
  analysisTelemetry: jsonb("analysis_telemetry").$type<JsonObject>(),
  graphSummary: jsonb("graph_summary").$type<JsonObject>(),
}, (table) => [
  uniqueIndex("repository_snapshots_identity_unique").on(
    table.repositoryId, table.commitSha, table.analyzerName, table.analyzerVersion,
  ),
  unique("repository_snapshots_repository_id_id_unique").on(table.repositoryId, table.id),
  index("repository_snapshots_repository_status_ready_idx").on(table.repositoryId, table.status, table.readyAt),
  index("repository_snapshots_repository_commit_idx").on(table.repositoryId, table.commitSha),
  check("repository_snapshots_commit_sha_valid", sql`${table.commitSha} ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'`),
  check("repository_snapshots_analyzer_nonempty", sql`length(btrim(${table.analyzerName})) > 0 AND length(btrim(${table.analyzerVersion})) > 0`),
  check("repository_snapshots_counts_nonnegative", sql`${table.fileCount} >= 0 AND ${table.entityCount} >= 0 AND ${table.edgeCount} >= 0 AND ${table.diagnosticCount} >= 0 AND ${table.unresolvedCount} >= 0`),
  check("repository_snapshots_state_timestamps", sql`(${table.status} = 'BUILDING' AND ${table.readyAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'READY' AND ${table.readyAt} IS NOT NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'FAILED' AND ${table.readyAt} IS NULL AND ${table.failedAt} IS NOT NULL)`),
]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  role: fileRole("file_role").notNull(),
  language: text("language").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  sourceObjectKey: text("source_object_key").notNull(),
  byteCount: bigint("byte_count", { mode: "number" }).notNull(),
  lineCount: integer("line_count").notNull(),
  metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
}, (table) => [
  uniqueIndex("files_snapshot_path_unique").on(table.snapshotId, table.path),
  unique("files_snapshot_id_id_unique").on(table.snapshotId, table.id),
  index("files_source_object_key_idx").on(table.sourceObjectKey),
  check("files_hash_valid", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("files_object_key_matches_hash", sql`${table.sourceObjectKey} = 'source/sha256/' || substr(${table.contentHash}, 1, 2) || '/' || ${table.contentHash}`),
  check("files_counts_nonnegative", sql`${table.byteCount} >= 0 AND ${table.lineCount} >= 0`),
  check("files_path_relative", sql`${table.path} <> '' AND ${table.path} !~ '^(?:/|[A-Za-z]:)' AND position('/../' in '/' || ${table.path} || '/') = 0`),
]);

export const codeEntities = pgTable("code_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  fileId: uuid("file_id"),
  stableKey: text("stable_key").notNull(),
  canonicalIdentity: text("canonical_identity").notNull(),
  entityType: entityType("entity_type").notNull(),
  name: text("name").notNull(),
  qualifiedName: text("qualified_name").notNull(),
  startLine: integer("start_line"),
  startColumn: integer("start_column"),
  endLine: integer("end_line"),
  endColumn: integer("end_column"),
  exported: boolean("exported").notNull(),
  defaultExport: boolean("default_export").notNull(),
  declarationFingerprint: text("declaration_fingerprint"),
  implementationFingerprint: text("implementation_fingerprint"),
  identityStability: identityStability("identity_stability").notNull(),
  analyzerName: text("analyzer_name").notNull(),
  analyzerVersion: text("analyzer_version").notNull(),
  metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
}, (table) => [
  uniqueIndex("code_entities_snapshot_stable_key_unique").on(table.snapshotId, table.stableKey),
  unique("code_entities_snapshot_id_id_unique").on(table.snapshotId, table.id),
  index("code_entities_snapshot_qualified_name_idx").on(table.snapshotId, table.qualifiedName),
  index("code_entities_snapshot_type_idx").on(table.snapshotId, table.entityType),
  check("code_entities_default_export_valid", sql`NOT ${table.defaultExport} OR ${table.exported}`),
  check("code_entities_range_complete", sql`(${table.startLine} IS NULL AND ${table.startColumn} IS NULL AND ${table.endLine} IS NULL AND ${table.endColumn} IS NULL) OR (${table.startLine} > 0 AND ${table.startColumn} > 0 AND ${table.endLine} > 0 AND ${table.endColumn} > 0 AND (${table.endLine} > ${table.startLine} OR (${table.endLine} = ${table.startLine} AND ${table.endColumn} >= ${table.startColumn})))`),
  foreignKey({
    columns: [table.snapshotId, table.fileId],
    foreignColumns: [files.snapshotId, files.id],
    name: "code_entities_snapshot_file_fk",
  }),
]);

export const codeEdges = pgTable("code_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  edgeKey: text("edge_key").notNull(),
  sourceEntityId: uuid("source_entity_id").notNull(),
  targetEntityId: uuid("target_entity_id").notNull(),
  edgeType: edgeType("edge_type").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  analyzerName: text("analyzer_name").notNull(),
  analyzerVersion: text("analyzer_version").notNull(),
  resolverName: text("resolver_name").notNull(),
  resolverVersion: text("resolver_version").notNull(),
  evidenceFileId: uuid("evidence_file_id"),
  evidenceStartLine: integer("evidence_start_line"),
  evidenceStartColumn: integer("evidence_start_column"),
  evidenceEndLine: integer("evidence_end_line"),
  evidenceEndColumn: integer("evidence_end_column"),
  evidenceKind: evidenceKind("evidence_kind"),
  metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
}, (table) => [
  uniqueIndex("code_edges_snapshot_edge_key_unique").on(table.snapshotId, table.edgeKey),
  index("code_edges_snapshot_source_type_idx").on(table.snapshotId, table.sourceEntityId, table.edgeType),
  index("code_edges_snapshot_target_type_idx").on(table.snapshotId, table.targetEntityId, table.edgeType),
  check("code_edges_confidence_valid", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  check("code_edges_evidence_complete", sql`(${table.evidenceFileId} IS NULL AND ${table.evidenceStartLine} IS NULL AND ${table.evidenceStartColumn} IS NULL AND ${table.evidenceEndLine} IS NULL AND ${table.evidenceEndColumn} IS NULL AND ${table.evidenceKind} IS NULL) OR (${table.evidenceFileId} IS NOT NULL AND ${table.evidenceStartLine} > 0 AND ${table.evidenceStartColumn} > 0 AND ${table.evidenceEndLine} > 0 AND ${table.evidenceEndColumn} > 0 AND ${table.evidenceKind} IS NOT NULL AND (${table.evidenceEndLine} > ${table.evidenceStartLine} OR (${table.evidenceEndLine} = ${table.evidenceStartLine} AND ${table.evidenceEndColumn} >= ${table.evidenceStartColumn})))`),
  foreignKey({
    columns: [table.snapshotId, table.sourceEntityId],
    foreignColumns: [codeEntities.snapshotId, codeEntities.id],
    name: "code_edges_snapshot_source_fk",
  }),
  foreignKey({
    columns: [table.snapshotId, table.targetEntityId],
    foreignColumns: [codeEntities.snapshotId, codeEntities.id],
    name: "code_edges_snapshot_target_fk",
  }),
  foreignKey({
    columns: [table.snapshotId, table.evidenceFileId],
    foreignColumns: [files.snapshotId, files.id],
    name: "code_edges_snapshot_evidence_file_fk",
  }),
]);

export const analyzerDiagnostics = pgTable("analyzer_diagnostics", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  code: text("code").notNull(),
  severity: diagnosticSeverity("severity").notNull(),
  message: text("message").notNull(),
  locationPath: text("location_path"),
  startLine: integer("start_line"),
  startColumn: integer("start_column"),
  endLine: integer("end_line"),
  endColumn: integer("end_column"),
}, (table) => [
  uniqueIndex("analyzer_diagnostics_snapshot_ordinal_unique").on(table.snapshotId, table.ordinal),
  check("analyzer_diagnostics_location_complete", sql`(${table.locationPath} IS NULL AND ${table.startLine} IS NULL AND ${table.startColumn} IS NULL AND ${table.endLine} IS NULL AND ${table.endColumn} IS NULL) OR (${table.locationPath} IS NOT NULL AND ${table.startLine} > 0 AND ${table.startColumn} > 0 AND ${table.endLine} > 0 AND ${table.endColumn} > 0)`),
]);

export const unresolvedRelationships = pgTable("unresolved_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  sourceEntityId: uuid("source_entity_id"),
  intendedEdgeType: edgeType("intended_edge_type").notNull(),
  targetText: text("target_text"),
  reason: unresolvedReason("reason").notNull(),
  evidenceFileId: uuid("evidence_file_id"),
  evidenceStartLine: integer("evidence_start_line"),
  evidenceStartColumn: integer("evidence_start_column"),
  evidenceEndLine: integer("evidence_end_line"),
  evidenceEndColumn: integer("evidence_end_column"),
  detail: text("detail").notNull(),
}, (table) => [
  uniqueIndex("unresolved_relationships_snapshot_ordinal_unique").on(table.snapshotId, table.ordinal),
  check("unresolved_relationships_evidence_complete", sql`(${table.evidenceFileId} IS NULL AND ${table.evidenceStartLine} IS NULL AND ${table.evidenceStartColumn} IS NULL AND ${table.evidenceEndLine} IS NULL AND ${table.evidenceEndColumn} IS NULL) OR (${table.evidenceFileId} IS NOT NULL AND ${table.evidenceStartLine} > 0 AND ${table.evidenceStartColumn} > 0 AND ${table.evidenceEndLine} > 0 AND ${table.evidenceEndColumn} > 0)`),
  foreignKey({
    columns: [table.snapshotId, table.sourceEntityId],
    foreignColumns: [codeEntities.snapshotId, codeEntities.id],
    name: "unresolved_relationships_snapshot_source_fk",
  }),
  foreignKey({
    columns: [table.snapshotId, table.evidenceFileId],
    foreignColumns: [files.snapshotId, files.id],
    name: "unresolved_relationships_snapshot_evidence_file_fk",
  }),
]);

export const indexJobs = pgTable("index_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").references(() => repositorySnapshots.id, { onDelete: "set null" }),
  commitSha: varchar("commit_sha", { length: 64 }).notNull(),
  analyzerName: text("analyzer_name").notNull(),
  analyzerVersion: text("analyzer_version").notNull(),
  status: indexJobStatus("status").notNull().default("RUNNING"),
  stage: text("stage").notNull().default("CLAIMED"),
  reusedExisting: boolean("reused_existing").notNull().default(false),
  failureCode: text("failure_code"),
  failureSummary: text("failure_summary"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  index("index_jobs_repository_status_started_idx").on(table.repositoryId, table.status, table.startedAt),
  index("index_jobs_logical_identity_idx").on(table.repositoryId, table.commitSha, table.analyzerName, table.analyzerVersion),
  check("index_jobs_commit_sha_valid", sql`${table.commitSha} ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'`),
]);

export const snapshotPins = pgTable("snapshot_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => repositorySnapshots.id, { onDelete: "cascade" }),
  pinType: pinType("pin_type").notNull(),
  ownerReference: text("owner_reference").notNull(),
  createdAt,
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  uniqueIndex("snapshot_pins_identity_unique").on(table.snapshotId, table.pinType, table.ownerReference),
  index("snapshot_pins_snapshot_expiry_idx").on(table.snapshotId, table.expiresAt),
  check("snapshot_pins_owner_nonempty", sql`length(btrim(${table.ownerReference})) > 0`),
  check("snapshot_pins_lease_valid", sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '30 days'`),
]);
