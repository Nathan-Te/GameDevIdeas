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
  return useLocation().pathname;
}

/**
 * Chemin **et** query : la vue Steam enchaîne les idées en respectant les
 * filtres du catalogue, qui voyagent dans l'URL. Le catalogue, lui, écrit ses
 * filtres par `replaceState` sans repasser par `navigate` — il tient déjà son
 * propre état, et une resynchronisation ici le ferait clignoter.
 */
export function useLocation(): { pathname: string; search: string } {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const sync = () =>
      setLocation((current) =>
        current.pathname === window.location.pathname && current.search === window.location.search
          ? current
          : { pathname: window.location.pathname, search: window.location.search },
      );
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, []);

  return location;
}

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
  'aria-label'?: string;
}

/** Un vrai `<a>` : clic milieu, Ctrl+clic et « ouvrir dans un onglet » marchent. */
export function Link({ to, className, children, title, ...rest }: LinkProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={className} title={title} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
