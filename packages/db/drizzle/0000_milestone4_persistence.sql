CREATE TYPE "public"."diagnostic_severity" AS ENUM('INFO', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('CONTAINS', 'IMPORTS', 'EXPORTS', 'CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'INSTANTIATES', 'ROUTES_TO', 'TESTS', 'DEPENDS_ON', 'POSSIBLE_CALL');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('REPOSITORY', 'MODULE', 'FILE', 'FUNCTION', 'METHOD', 'CONSTRUCTOR', 'CLASS', 'INTERFACE', 'TYPE_ALIAS', 'ENUM', 'VARIABLE', 'COMPONENT', 'API_ROUTE', 'TEST', 'EXTERNAL_PACKAGE', 'UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('STATIC_RESOLUTION', 'SYNTAX', 'HEURISTIC');--> statement-breakpoint
CREATE TYPE "public"."file_role" AS ENUM('SOURCE', 'PROJECT_CONFIGURATION');--> statement-breakpoint
CREATE TYPE "public"."identity_stability" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."index_job_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."snapshot_pin_type" AS ENUM('MANUAL', 'ACTIVE_DIFF', 'ACTIVE_PR');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('BUILDING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."unresolved_reason" AS ENUM('ABSENT_DEPENDENCY', 'AMBIGUOUS_TARGET', 'COMPUTED_SPECIFIER', 'DYNAMIC_DISPATCH', 'MALFORMED_SOURCE', 'OUTSIDE_ANALYSIS_SCOPE', 'UNSUPPORTED_SYNTAX');--> statement-breakpoint
CREATE TABLE "analyzer_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"code" text NOT NULL,
	"severity" "diagnostic_severity" NOT NULL,
	"message" text NOT NULL,
	"location_path" text,
	"start_line" integer,
	"start_column" integer,
	"end_line" integer,
	"end_column" integer,
	CONSTRAINT "analyzer_diagnostics_location_complete" CHECK (("analyzer_diagnostics"."location_path" IS NULL AND "analyzer_diagnostics"."start_line" IS NULL AND "analyzer_diagnostics"."start_column" IS NULL AND "analyzer_diagnostics"."end_line" IS NULL AND "analyzer_diagnostics"."end_column" IS NULL) OR ("analyzer_diagnostics"."location_path" IS NOT NULL AND "analyzer_diagnostics"."start_line" > 0 AND "analyzer_diagnostics"."start_column" > 0 AND "analyzer_diagnostics"."end_line" > 0 AND "analyzer_diagnostics"."end_column" > 0))
);
--> statement-breakpoint
CREATE TABLE "code_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"edge_key" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"edge_type" "edge_type" NOT NULL,
	"confidence" double precision NOT NULL,
	"analyzer_name" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"resolver_name" text NOT NULL,
	"resolver_version" text NOT NULL,
	"evidence_file_id" uuid,
	"evidence_start_line" integer,
	"evidence_start_column" integer,
	"evidence_end_line" integer,
	"evidence_end_column" integer,
	"evidence_kind" "evidence_kind",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "code_edges_confidence_valid" CHECK ("code_edges"."confidence" >= 0 AND "code_edges"."confidence" <= 1),
	CONSTRAINT "code_edges_evidence_complete" CHECK (("code_edges"."evidence_file_id" IS NULL AND "code_edges"."evidence_start_line" IS NULL AND "code_edges"."evidence_start_column" IS NULL AND "code_edges"."evidence_end_line" IS NULL AND "code_edges"."evidence_end_column" IS NULL AND "code_edges"."evidence_kind" IS NULL) OR ("code_edges"."evidence_file_id" IS NOT NULL AND "code_edges"."evidence_start_line" > 0 AND "code_edges"."evidence_start_column" > 0 AND "code_edges"."evidence_end_line" > 0 AND "code_edges"."evidence_end_column" > 0 AND "code_edges"."evidence_kind" IS NOT NULL AND ("code_edges"."evidence_end_line" > "code_edges"."evidence_start_line" OR ("code_edges"."evidence_end_line" = "code_edges"."evidence_start_line" AND "code_edges"."evidence_end_column" >= "code_edges"."evidence_start_column"))))
);
--> statement-breakpoint
CREATE TABLE "code_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"file_id" uuid,
	"stable_key" text NOT NULL,
	"canonical_identity" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"qualified_name" text NOT NULL,
	"start_line" integer,
	"start_column" integer,
	"end_line" integer,
	"end_column" integer,
	"exported" boolean NOT NULL,
	"default_export" boolean NOT NULL,
	"declaration_fingerprint" text,
	"implementation_fingerprint" text,
	"identity_stability" "identity_stability" NOT NULL,
	"analyzer_name" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "code_entities_snapshot_id_id_unique" UNIQUE("snapshot_id","id"),
	CONSTRAINT "code_entities_default_export_valid" CHECK (NOT "code_entities"."default_export" OR "code_entities"."exported"),
	CONSTRAINT "code_entities_range_complete" CHECK (("code_entities"."start_line" IS NULL AND "code_entities"."start_column" IS NULL AND "code_entities"."end_line" IS NULL AND "code_entities"."end_column" IS NULL) OR ("code_entities"."start_line" > 0 AND "code_entities"."start_column" > 0 AND "code_entities"."end_line" > 0 AND "code_entities"."end_column" > 0 AND ("code_entities"."end_line" > "code_entities"."start_line" OR ("code_entities"."end_line" = "code_entities"."start_line" AND "code_entities"."end_column" >= "code_entities"."start_column"))))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"file_role" "file_role" NOT NULL,
	"language" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_object_key" text NOT NULL,
	"byte_count" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "files_snapshot_id_id_unique" UNIQUE("snapshot_id","id"),
	CONSTRAINT "files_hash_valid" CHECK ("files"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "files_object_key_matches_hash" CHECK ("files"."source_object_key" = 'source/sha256/' || substr("files"."content_hash", 1, 2) || '/' || "files"."content_hash"),
	CONSTRAINT "files_counts_nonnegative" CHECK ("files"."byte_count" >= 0 AND "files"."line_count" >= 0),
	CONSTRAINT "files_path_relative" CHECK ("files"."path" <> '' AND "files"."path" !~ '^(?:/|[A-Za-z]:)' AND position('/../' in '/' || "files"."path" || '/') = 0)
);
--> statement-breakpoint
CREATE TABLE "index_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"snapshot_id" uuid,
	"commit_sha" varchar(64) NOT NULL,
	"analyzer_name" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"status" "index_job_status" DEFAULT 'RUNNING' NOT NULL,
	"stage" text DEFAULT 'CLAIMED' NOT NULL,
	"reused_existing" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"failure_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "index_jobs_commit_sha_valid" CHECK ("index_jobs"."commit_sha" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logical_id" text NOT NULL,
	"name" text NOT NULL,
	"current_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_id_current_snapshot_unique" UNIQUE("id","current_snapshot_id"),
	CONSTRAINT "repositories_logical_id_nonempty" CHECK (length(btrim("repositories"."logical_id")) > 0),
	CONSTRAINT "repositories_name_nonempty" CHECK (length(btrim("repositories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "repository_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"analyzer_name" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"status" "snapshot_status" DEFAULT 'BUILDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_stage" text,
	"failure_code" text,
	"failure_summary" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"diagnostic_count" integer DEFAULT 0 NOT NULL,
	"unresolved_count" integer DEFAULT 0 NOT NULL,
	"analysis_stats" jsonb,
	"analysis_telemetry" jsonb,
	"graph_summary" jsonb,
	CONSTRAINT "repository_snapshots_repository_id_id_unique" UNIQUE("repository_id","id"),
	CONSTRAINT "repository_snapshots_commit_sha_valid" CHECK ("repository_snapshots"."commit_sha" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "repository_snapshots_analyzer_nonempty" CHECK (length(btrim("repository_snapshots"."analyzer_name")) > 0 AND length(btrim("repository_snapshots"."analyzer_version")) > 0),
	CONSTRAINT "repository_snapshots_counts_nonnegative" CHECK ("repository_snapshots"."file_count" >= 0 AND "repository_snapshots"."entity_count" >= 0 AND "repository_snapshots"."edge_count" >= 0 AND "repository_snapshots"."diagnostic_count" >= 0 AND "repository_snapshots"."unresolved_count" >= 0),
	CONSTRAINT "repository_snapshots_state_timestamps" CHECK (("repository_snapshots"."status" = 'BUILDING' AND "repository_snapshots"."ready_at" IS NULL AND "repository_snapshots"."failed_at" IS NULL) OR ("repository_snapshots"."status" = 'READY' AND "repository_snapshots"."ready_at" IS NOT NULL AND "repository_snapshots"."failed_at" IS NULL) OR ("repository_snapshots"."status" = 'FAILED' AND "repository_snapshots"."ready_at" IS NULL AND "repository_snapshots"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "snapshot_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"pin_type" "snapshot_pin_type" NOT NULL,
	"owner_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "snapshot_pins_owner_nonempty" CHECK (length(btrim("snapshot_pins"."owner_reference")) > 0),
	CONSTRAINT "snapshot_pins_lease_valid" CHECK ("snapshot_pins"."expires_at" > "snapshot_pins"."created_at" AND "snapshot_pins"."expires_at" <= "snapshot_pins"."created_at" + interval '30 days')
);
--> statement-breakpoint
CREATE TABLE "unresolved_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"source_entity_id" uuid,
	"intended_edge_type" "edge_type" NOT NULL,
	"target_text" text,
	"reason" "unresolved_reason" NOT NULL,
	"evidence_file_id" uuid,
	"evidence_start_line" integer,
	"evidence_start_column" integer,
	"evidence_end_line" integer,
	"evidence_end_column" integer,
	"detail" text NOT NULL,
	CONSTRAINT "unresolved_relationships_evidence_complete" CHECK (("unresolved_relationships"."evidence_file_id" IS NULL AND "unresolved_relationships"."evidence_start_line" IS NULL AND "unresolved_relationships"."evidence_start_column" IS NULL AND "unresolved_relationships"."evidence_end_line" IS NULL AND "unresolved_relationships"."evidence_end_column" IS NULL) OR ("unresolved_relationships"."evidence_file_id" IS NOT NULL AND "unresolved_relationships"."evidence_start_line" > 0 AND "unresolved_relationships"."evidence_start_column" > 0 AND "unresolved_relationships"."evidence_end_line" > 0 AND "unresolved_relationships"."evidence_end_column" > 0))
);
--> statement-breakpoint
ALTER TABLE "analyzer_diagnostics" ADD CONSTRAINT "analyzer_diagnostics_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_snapshot_source_fk" FOREIGN KEY ("snapshot_id","source_entity_id") REFERENCES "public"."code_entities"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_snapshot_target_fk" FOREIGN KEY ("snapshot_id","target_entity_id") REFERENCES "public"."code_entities"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_snapshot_evidence_file_fk" FOREIGN KEY ("snapshot_id","evidence_file_id") REFERENCES "public"."files"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_entities" ADD CONSTRAINT "code_entities_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_entities" ADD CONSTRAINT "code_entities_snapshot_file_fk" FOREIGN KEY ("snapshot_id","file_id") REFERENCES "public"."files"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_jobs" ADD CONSTRAINT "index_jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_jobs" ADD CONSTRAINT "index_jobs_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_snapshots" ADD CONSTRAINT "repository_snapshots_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_pins" ADD CONSTRAINT "snapshot_pins_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_relationships" ADD CONSTRAINT "unresolved_relationships_snapshot_id_repository_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repository_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_relationships" ADD CONSTRAINT "unresolved_relationships_snapshot_source_fk" FOREIGN KEY ("snapshot_id","source_entity_id") REFERENCES "public"."code_entities"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_relationships" ADD CONSTRAINT "unresolved_relationships_snapshot_evidence_file_fk" FOREIGN KEY ("snapshot_id","evidence_file_id") REFERENCES "public"."files"("snapshot_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analyzer_diagnostics_snapshot_ordinal_unique" ON "analyzer_diagnostics" USING btree ("snapshot_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "code_edges_snapshot_edge_key_unique" ON "code_edges" USING btree ("snapshot_id","edge_key");--> statement-breakpoint
CREATE INDEX "code_edges_snapshot_source_type_idx" ON "code_edges" USING btree ("snapshot_id","source_entity_id","edge_type");--> statement-breakpoint
CREATE INDEX "code_edges_snapshot_target_type_idx" ON "code_edges" USING btree ("snapshot_id","target_entity_id","edge_type");--> statement-breakpoint
CREATE UNIQUE INDEX "code_entities_snapshot_stable_key_unique" ON "code_entities" USING btree ("snapshot_id","stable_key");--> statement-breakpoint
CREATE INDEX "code_entities_snapshot_qualified_name_idx" ON "code_entities" USING btree ("snapshot_id","qualified_name");--> statement-breakpoint
CREATE INDEX "code_entities_snapshot_type_idx" ON "code_entities" USING btree ("snapshot_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "files_snapshot_path_unique" ON "files" USING btree ("snapshot_id","path");--> statement-breakpoint
CREATE INDEX "files_source_object_key_idx" ON "files" USING btree ("source_object_key");--> statement-breakpoint
CREATE INDEX "index_jobs_repository_status_started_idx" ON "index_jobs" USING btree ("repository_id","status","started_at");--> statement-breakpoint
CREATE INDEX "index_jobs_logical_identity_idx" ON "index_jobs" USING btree ("repository_id","commit_sha","analyzer_name","analyzer_version");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_logical_id_unique" ON "repositories" USING btree ("logical_id");--> statement-breakpoint
CREATE INDEX "repositories_current_snapshot_idx" ON "repositories" USING btree ("current_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_snapshots_identity_unique" ON "repository_snapshots" USING btree ("repository_id","commit_sha","analyzer_name","analyzer_version");--> statement-breakpoint
CREATE INDEX "repository_snapshots_repository_status_ready_idx" ON "repository_snapshots" USING btree ("repository_id","status","ready_at");--> statement-breakpoint
CREATE INDEX "repository_snapshots_repository_commit_idx" ON "repository_snapshots" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pins_identity_unique" ON "snapshot_pins" USING btree ("snapshot_id","pin_type","owner_reference");--> statement-breakpoint
CREATE INDEX "snapshot_pins_snapshot_expiry_idx" ON "snapshot_pins" USING btree ("snapshot_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_relationships_snapshot_ordinal_unique" ON "unresolved_relationships" USING btree ("snapshot_id","ordinal");
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_current_snapshot_same_repository_fk"
  FOREIGN KEY ("id", "current_snapshot_id")
  REFERENCES "repository_snapshots" ("repository_id", "id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION codeatlas_require_ready_current_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM repository_snapshots
    WHERE id = NEW.current_snapshot_id
      AND repository_id = NEW.id
      AND status = 'READY'
  ) THEN
    RAISE EXCEPTION 'repositories.current_snapshot_id must reference a READY snapshot owned by the repository';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER repositories_current_snapshot_ready
AFTER INSERT OR UPDATE ON repositories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION codeatlas_require_ready_current_snapshot();
