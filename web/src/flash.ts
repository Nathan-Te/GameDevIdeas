const KEY = 'vitrine:flash';

/**
 * Un message qui survit à un changement de vue, et un seul.
 *
 * La restauration finit sur le catalogue : elle a quelque chose à dire, mais
 * l'écran qui l'affiche n'est plus celui qui l'a produit. Une session storage
 * suffit — le message est lu une fois puis effacé, donc un rechargement de page
 * ne le fait pas réapparaître.
 */
export function setFlash(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    /* stockage refusé : le message est simplement perdu */
  }
}

export function takeFlash(): string | null {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}
