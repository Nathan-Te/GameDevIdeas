/**
 * Une limite de débit à fenêtre glissante, en mémoire.
 *
 * En mémoire et non en base, pour deux raisons : une soumission refusée ne doit
 * rien écrire — sinon la limite est elle-même un vecteur d'écriture — et un
 * compteur qui vit une heure n'a pas à survivre à un redémarrage. La
 * conséquence est assumée : un redémarrage remet les compteurs à zéro. Sur une
 * instance mono-utilisateur redémarrée deux fois par mois, ça ne change rien ;
 * si ça changeait quelque chose un jour, ce serait le signe qu'il faut autre
 * chose qu'une limite de débit.
 *
 * Le limiteur est **créé par application** et porté par elle (`app.guestLimit`),
 * jamais posé dans un module : deux tests ne doivent pas se compter l'un
 * l'autre, et un état mutable global est exactement ce qu'on ne veut pas.
 */
export function createRateLimiter({ limit = 30, windowMs = 3_600_000 } = {}) {
  /** clé -> horodatages des soumissions retenues, du plus ancien au plus récent. */
  const hits = new Map();

  return {
    limit,
    windowMs,

    /**
     * Enregistre une soumission et dit si elle passe. Une soumission refusée
     * n'est **pas** comptée : sinon un client qui insiste repousserait sans fin
     * sa propre réouverture, ce qui n'est pas une limite mais un bannissement.
     */
    take(key, at = Date.now()) {
      const since = at - windowMs;
      const kept = (hits.get(key) ?? []).filter((stamp) => stamp > since);

      if (kept.length >= limit) {
        hits.set(key, kept);
        const retryAfter = Math.max(1, Math.ceil((kept[0] + windowMs - at) / 1000));
        return { allowed: false, remaining: 0, retryAfter };
      }

      kept.push(at);
      hits.set(key, kept);

      // Ménage opportuniste : sans lui, une clé vue une fois resterait pour
      // toujours. Le coût est proportionnel au nombre de clés, et il n'y en a
      // qu'une poignée — ce sont des amis, pas un public.
      if (hits.size > 1000) {
        for (const [other, stamps] of hits) {
          if (!stamps.some((stamp) => stamp > since)) hits.delete(other);
        }
      }

      return { allowed: true, remaining: limit - kept.length, retryAfter: 0 };
    },
  };
}
