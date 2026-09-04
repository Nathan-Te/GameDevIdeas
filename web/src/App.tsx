import { Catalogue } from './pages/Catalogue';
import { IdeaPage } from './pages/IdeaPage';
import { SteamPage } from './pages/SteamPage';
import { Trash } from './pages/Trash';
import { Link, useLocation } from './router';

/**
 * Les quatre vues du seed. L'ordre des tests compte : `/idees/:slug/steam` est
 * examiné avant `/idees/:slug`, sinon le slug avalerait le suffixe.
 */
export function App() {
  const { pathname, search } = useLocation();

  if (pathname === '/' || pathname === '') return <Catalogue />;
  if (pathname === '/corbeille' || pathname === '/corbeille/') return <Trash />;

  const steam = /^\/idees\/([^/]+)\/steam\/?$/.exec(pathname);
  if (steam) return <SteamPage slug={decodeURIComponent(steam[1])} search={search} />;

  const idea = /^\/idees\/([^/]+)\/?$/.exec(pathname);
  if (idea) return <IdeaPage slug={decodeURIComponent(idea[1])} />;

  return (
    <div className="page">
      <p className="notice notice--error">Page inconnue : {pathname}</p>
      <Link to="/" className="button button--ghost">
        Retour au catalogue
      </Link>
    </div>
  );
}
