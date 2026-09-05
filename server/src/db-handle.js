/**
 * Une poignée sur la connexion SQLite, et non la connexion elle-même.
 *
 * Tout le code lit `app.db` et appelle `prepare`, `transaction`, `pragma`…
 * dessus. Sans cette indirection, chaque route garderait une référence sur
 * l'objet `Database` obtenu au démarrage — et une restauration, qui remplace le
 * fichier de base sous nos pieds, ne pourrait pas rebrancher l'application sur
 * la nouvelle base : `better-sqlite3` ne sait pas rouvrir une connexion fermée.
 *
 * Le Proxy transmet tout ce qu'il ne connaît pas à la connexion courante, en
 * liant les méthodes : `handle.prepare(...)` est exactement
 * `connection.prepare(...)`. Seuls `swap` et `connection` lui appartiennent.
 */
export function createDbHandle(connection) {
  let current = connection;

  const own = {
    /** Marqueur : `buildApp` ne doit pas emballer une poignée dans une poignée. */
    isDbHandle: true,

    /** La connexion sous-jacente, pour qui a besoin de l'objet réel. */
    get connection() {
      return current;
    },

    /**
     * Rebranche la poignée sur une nouvelle connexion et renvoie l'ancienne.
     * L'appelant décide s'il ferme celle qu'il récupère : la restauration la
     * ferme *avant* de remplacer le fichier, donc bien avant d'appeler `swap`.
     */
    swap(next) {
      const previous = current;
      current = next;
      return previous;
    },
  };

  return new Proxy(own, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const value = current[prop];
      return typeof value === 'function' ? value.bind(current) : value;
    },
    has: (target, prop) => prop in target || prop in current,
  });
}
