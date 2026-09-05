-- 006-sharing.sql — le partage public et les avis d'amis (lot 7).
--
-- Quatre tables, et une seule règle qui les gouverne toutes : **un avis d'ami
-- n'est jamais un verdict**. `verdicts` reste la table du jugement de Nathan et
-- n'est touchée par rien de ce qui suit ; `reviews` est celle des amis. Aucune
-- vue, aucune requête et aucun calcul ne mélange les deux — les additionner
-- ferait mentir les deux à la fois.

-- Une sélection d'idées partagée par un lien. Le lien *est* le secret : il n'y
-- a pas d'authentification, donc le jeton porte 32 octets d'aléa cryptographique
-- (base64url, 43 caractères). `UNIQUE` crée l'index dont la lecture par jeton a
-- besoin — c'est la requête la plus chaude du lot, elle est faite à chaque
-- chargement de page invité.
CREATE TABLE shares (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT    NOT NULL UNIQUE,
  -- « Les copains » : pour que Nathan retrouve à qui il a donné quoi.
  label           TEXT    NOT NULL DEFAULT '',
  -- Les avis des autres visiteurs sont-ils visibles sur la page ? Vrai par
  -- défaut ; à couper quand on veut des avis non influencés.
  reviews_visible INTEGER NOT NULL DEFAULT 1 CHECK (reviews_visible IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Nulle = sans échéance. Passée, le lien répond 404 comme un lien inconnu.
  expires_at      TEXT,
  -- Non nulle = révoqué. On ne supprime pas une sélection révoquée : les avis
  -- déjà reçus doivent garder d'où ils viennent.
  revoked_at      TEXT
);

-- La sélection est **ordonnée** : c'est l'ordre dans lequel les amis scrollent.
CREATE TABLE share_ideas (
  share_id INTEGER NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
  idea_id  INTEGER NOT NULL REFERENCES ideas  (id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (share_id, idea_id)
);

CREATE INDEX idx_share_ideas_order ON share_ideas (share_id, position, idea_id);

-- L'avis d'un ami. Rien à voir avec `verdicts` : ni la même table, ni les mêmes
-- colonnes, ni le même auteur.
CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id     INTEGER NOT NULL REFERENCES ideas  (id) ON DELETE CASCADE,
  -- D'où vient l'avis. `SET NULL` plutôt que `CASCADE` : si une sélection
  -- disparaissait, l'avis resterait — il a été donné, il ne se retire pas.
  share_id    INTEGER          REFERENCES shares (id) ON DELETE SET NULL,
  author_name TEXT    NOT NULL DEFAULT '',
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5),
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Non nulle quand le visiteur est revenu corriger son avis. Le lot ajoute
  -- cette colonne au modèle demandé : un avis modifiable qui ne dit pas qu'il
  -- l'a été raconterait une date fausse.
  updated_at  TEXT,
  -- Tiré par le navigateur du visiteur : c'est ce qui lui permet de corriger
  -- son propre avis, et seulement le sien. Ce n'est pas un compte.
  visitor_id  TEXT    NOT NULL,
  -- SHA-256 de l'adresse source et d'un sel du serveur. Sert au débit et à
  -- rien d'autre : jamais affiché, jamais servi par une route.
  ip_hash     TEXT
);

-- Un ami a un avis par idée, pas une collection. C'est cette contrainte qui
-- fait de « déposer » et « corriger » la même opération.
CREATE UNIQUE INDEX idx_reviews_visitor ON reviews (idea_id, visitor_id);
CREATE INDEX idx_reviews_idea  ON reviews (idea_id, created_at DESC, id DESC);
CREATE INDEX idx_reviews_share ON reviews (share_id);

-- La liste de souhaits **du visiteur**. Distincte de `ideas.wishlisted_at`, qui
-- est celle de Nathan : un ami ne coche pas la case de Nathan.
CREATE TABLE share_wishlists (
  share_id   INTEGER NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
  idea_id    INTEGER NOT NULL REFERENCES ideas  (id) ON DELETE CASCADE,
  visitor_id TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (share_id, idea_id, visitor_id)
);

CREATE INDEX idx_share_wishlists_idea ON share_wishlists (idea_id);
