-- 004-families.sql — les familles deviennent des données (lot 4).
--
-- Jusqu'ici la liste des familles vivait dans le code : une énumération dans
-- `server/src/schemas.js`, une table d'étiquettes dans `shared/store-model.js`,
-- des libellés dans le front. Ajouter une famille demandait de toucher trois
-- fichiers et de redéployer. Elle vit désormais ici.
--
-- `store_tags` et `features` sont du JSON stocké en TEXT : ce sont des listes
-- courtes, jamais filtrées ni jointes, et leur donner chacune une table de
-- liaison coûterait deux tables pour un écran d'édition. La règle du projet
-- (« pas d'ORM, du SQL en clair ») ne dit rien contre ; le dépôt sérialise et
-- désérialise à la frontière, comme il le fait déjà pour les chemins de fichier.
--
-- La table est peuplée au démarrage, par `families-repo.js`, à partir de
-- `SEED_FAMILIES` — et seulement si elle est vide. Le seed n'est pas écrit ici
-- parce qu'il doit rester lisible à côté du modèle store, et parce qu'une
-- migration qui contiendrait la liste ferait croire qu'elle en est la source.
CREATE TABLE families (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL DEFAULT '',
  -- Les étiquettes affichées sur la page store. JSON : ["Coop", "Comédie"].
  store_tags TEXT    NOT NULL DEFAULT '[]',
  -- Les fonctionnalités déduites. JSON : ["solo"], ["coop-online", ...].
  features   TEXT    NOT NULL DEFAULT '[]',
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_families_position ON families (position, id);
