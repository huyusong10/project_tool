CREATE TABLE requirement_groups (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX requirement_groups_name ON requirement_groups(project_id,name);
--> statement-breakpoint
ALTER TABLE requirements ADD group_id TEXT REFERENCES requirement_groups(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE requirements ADD tags TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX requirements_group ON requirements(group_id);
--> statement-breakpoint
CREATE TABLE source_documents (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_key TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, source_version TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX source_documents_key ON source_documents(project_id,source_key);
--> statement-breakpoint
CREATE TABLE source_clauses (id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE, source_key TEXT NOT NULL, current_revision_id TEXT NOT NULL, deferred_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX source_clauses_key ON source_clauses(document_id,source_key);
--> statement-breakpoint
CREATE TABLE source_revisions (id TEXT PRIMARY KEY NOT NULL, clause_id TEXT NOT NULL REFERENCES source_clauses(id) ON DELETE CASCADE, document_version TEXT NOT NULL, section TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX source_revisions_clause ON source_revisions(clause_id);
--> statement-breakpoint
CREATE TABLE source_links (id TEXT PRIMARY KEY NOT NULL, clause_id TEXT NOT NULL REFERENCES source_clauses(id) ON DELETE CASCADE, requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE, work_item_id TEXT REFERENCES work_items(id) ON DELETE CASCADE, scope TEXT NOT NULL, reviewed_revision_id TEXT NOT NULL REFERENCES source_revisions(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX source_links_target ON source_links(clause_id,requirement_id,coalesce(work_item_id,''));
--> statement-breakpoint
CREATE INDEX source_links_requirement ON source_links(requirement_id);
--> statement-breakpoint
CREATE TABLE requirement_import_receipts (batch_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor_id TEXT NOT NULL, content_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER intake_group_insert AFTER INSERT ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_group_update AFTER UPDATE ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_group_delete AFTER DELETE ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_document_insert AFTER INSERT ON source_documents BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_document_update AFTER UPDATE ON source_documents BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_clause_insert AFTER INSERT ON source_clauses BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM source_documents WHERE id=NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_clause_update AFTER UPDATE ON source_clauses BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM source_documents WHERE id=NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_link_insert AFTER INSERT ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_link_update AFTER UPDATE ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_link_delete AFTER DELETE ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=OLD.requirement_id); END;
