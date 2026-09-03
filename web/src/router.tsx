import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

/**
 * Routeur minimal sur l'API History. Vitrine a deux routes au lot 1 et en aura
 * quatre au lot 3 : une dépendance de routage coûterait plus en poids qu'elle
 * ne ferait gagner. Fastify renvoie `index.html` sur toute route inconnue, donc
 * un rechargement sur `/idees/mon-slug` fonctionne.
 */

const NAVIGATION_EVENT = 'vitrine:navigation';

export function navigate(to: string, { replace = false } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, []);

  return pathname;
}

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
}

/** Un vrai `<a>` : clic milieu, Ctrl+clic et « ouvrir dans un onglet » marchent. */
export function Link({ to, className, children, title }: LinkProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={className} title={title} onClick={onClick}>
      {children}
    </a>
  );
}
