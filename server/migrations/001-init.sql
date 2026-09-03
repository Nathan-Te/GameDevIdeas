-- 001-init.sql — schéma initial de Vitrine (lot 1).
--
-- Les tables `ideas` et `verdicts` sont servies par l'API dès le lot 1.
-- `attachments` et `ideas.capsule_file_id` sont créées ici bien qu'aucune route
-- ne les serve encore : le lot 2 (pièces jointes) n'aura pas à remigrer.
-- Rappel de la règle du projet : une migration livrée n'est jamais réécrite.

-- Une idée. `deleted_at` non nul = idée en corbeille (soft delete).
CREATE TABLE ideas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL DEFAULT '',
  tagline         TEXT    NOT NULL DEFAULT '',
  pitch           TEXT    NOT NULL DEFAULT '',
  gif             TEXT    NOT NULL DEFAULT '',
  price_cents     INTEGER,
  family          TEXT    NOT NULL DEFAULT 'autre',
  status          TEXT    NOT NULL DEFAULT 'idee',
  competition     TEXT    NOT NULL DEFAULT '',
  capsule_file_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT
);

CREATE INDEX idx_ideas_deleted_at ON ideas (deleted_at);
CREATE INDEX idx_ideas_family     ON ideas (family);
CREATE INDEX idx_ideas_status     ON ideas (status);
CREATE INDEX idx_ideas_updated_at ON ideas (updated_at);

-- Un jugement daté. On n'écrase jamais un verdict, on en ajoute un nouveau :
-- le verdict courant d'une idée est simplement le plus récent.
CREATE TABLE verdicts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5),
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_verdicts_idea ON verdicts (idea_id, created_at DESC, id DESC);

-- Pièces jointes (lot 2). Les fichiers utilisateur vivent dans `data/files/`,
-- jamais en base : on ne stocke ici que le chemin relatif et les métadonnées.
CREATE TABLE attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('image', 'markdown', 'file', 'link')),
  label      TEXT    NOT NULL DEFAULT '',
  path       TEXT,
  url        TEXT,
  link_type  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_attachments_idea ON attachments (idea_id, position, id);
