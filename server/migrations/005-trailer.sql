-- 005-trailer.sql — la bande-annonce (lot 4).
--
-- Deux changements, indissociables : un `kind` de plus sur les pièces jointes,
-- et la référence de l'idée vers celle qui lui sert de bande-annonce.
--
-- `trailer_file_id` se pose en une ligne, comme la capsule, avec la même
-- politique : `ON DELETE SET NULL`, parce que supprimer la bande-annonce d'une
-- idée ne doit pas supprimer l'idée. SQLite accepte d'ajouter une colonne avec
-- clé étrangère tant que son défaut est NULL — c'est le cas.
ALTER TABLE ideas ADD COLUMN trailer_file_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL;

-- Le `kind` `trailer`, lui, se paie plus cher : `001-init.sql` a posé une
-- contrainte CHECK sur la colonne, et SQLite ne sait pas modifier une
-- contrainte. Il faut reconstruire la table — la procédure documentée : table
-- neuve sous un nom temporaire, copie, suppression de l'ancienne, renommage.
--
-- C'est pour cette reconstruction que `migrate.js` coupe les clés étrangères
-- le temps des migrations et les revérifie après : sans ça, le DROP TABLE
-- déclencherait le `ON DELETE SET NULL` de `ideas.capsule_file_id` et toutes
-- les capsules seraient perdues en chemin.
CREATE TABLE attachments_rebuilt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('image', 'markdown', 'file', 'link', 'trailer')),
  label      TEXT    NOT NULL DEFAULT '',
  path       TEXT,
  url        TEXT,
  link_type  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  size_bytes INTEGER
);

INSERT INTO attachments_rebuilt
  (id, idea_id, kind, label, path, url, link_type, position, created_at, size_bytes)
SELECT id, idea_id, kind, label, path, url, link_type, position, created_at, size_bytes
FROM attachments;

DROP TABLE attachments;

ALTER TABLE attachments_rebuilt RENAME TO attachments;

CREATE INDEX idx_attachments_idea ON attachments (idea_id, position, id);

-- Un GIF déjà attaché était une image ; il devient une bande-annonce, comme
-- tout GIF envoyé à partir de maintenant. Un GIF n'est pas une capture : c'est
-- précisément le constat qui a ouvert ce lot.
UPDATE attachments
SET kind = 'trailer'
WHERE kind = 'image' AND lower(path) LIKE '%.gif';

-- Une capsule ne peut pas être une bande-annonce : celles qui viennent de
-- changer de nature sont libérées plutôt que laissées à pointer un GIF.
UPDATE ideas
SET capsule_file_id = NULL
WHERE capsule_file_id IN (SELECT id FROM attachments WHERE kind = 'trailer');
