import { Backup } from './pages/Backup';
import { Catalogue } from './pages/Catalogue';
import { Families } from './pages/Families';
import { IdeaPage } from './pages/IdeaPage';
import { SharePage } from './pages/SharePage';
import { Shares } from './pages/Shares';
import { SteamPage } from './pages/SteamPage';
import { Trash } from './pages/Trash';
import { Link, useLocation } from './router';

/**
 * Les vues de Vitrine. L'ordre des tests compte : `/idees/:slug/steam` est
 * examiné avant `/idees/:slug`, sinon le slug avalerait le suffixe.
 */
export function App() {
  const { pathname, search } = useLocation();

  if (pathname === '/' || pathname === '') return <Catalogue />;
  if (pathname === '/corbeille' || pathname === '/corbeille/') return <Trash />;
  if (pathname === '/familles' || pathname === '/familles/') return <Families />;
  if (pathname === '/sauvegarde' || pathname === '/sauvegarde/') return <Backup />;
  if (pathname === '/partages' || pathname === '/partages/') return <Shares />;

  /**
   * La page invité. Elle est examinée avant les autres parce qu'elle est la
   * seule que quelqu'un d'autre que Nathan puisse atteindre : le serveur ne
   * sert la coquille de l'application, à un visiteur, que sous ce préfixe.
   */
  const shared = /^\/p\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (shared) {
    return (
      <SharePage
        token={decodeURIComponent(shared[1])}
        slug={shared[2] ? decodeURIComponent(shared[2]) : null}
      />
    );
  }

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
