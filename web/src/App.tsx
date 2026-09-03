import { Catalogue } from './pages/Catalogue';
import { IdeaPage } from './pages/IdeaPage';
import { Link, usePathname } from './router';

export function App() {
  const pathname = usePathname();

  if (pathname === '/' || pathname === '') return <Catalogue />;

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
