-- 003-wishlist.sql — la liste de souhaits (lot 3b).
--
-- Le seul geste actif de la vue store : « Ajouter à votre liste de souhaits ».
-- C'est le réflexe que l'application cherche à capturer, donc il se persiste.
--
-- Une date et non un booléen : savoir *quand* une idée a été mise en liste de
-- souhaits vaut plus que savoir qu'elle l'est. NULL = pas en liste.
ALTER TABLE ideas ADD COLUMN wishlisted_at TEXT;

CREATE INDEX idx_ideas_wishlisted_at ON ideas (wishlisted_at);
