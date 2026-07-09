import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { Navigation } from './Navigation';

const HEADER_COLLAPSED_KEY = 'tasf.header.collapsed';

// El Header de Carbon es fijo (48px). Cuando se oculta, el contenido recupera
// ese espacio para que el mapa pueda verse más amplio.
export function Layout() {
  const [headerCollapsed, setHeaderCollapsed] = useState(() => {
    try {
      return localStorage.getItem(HEADER_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HEADER_COLLAPSED_KEY, String(headerCollapsed));
    } catch {
      // localStorage no disponible
    }
  }, [headerCollapsed]);

  return (
    <>
      <Navigation
        collapsed={headerCollapsed}
        onToggleCollapsed={() => setHeaderCollapsed(v => !v)}
      />
      <div
        style={{
          marginTop: headerCollapsed ? 0 : '48px',
          height: headerCollapsed ? '100vh' : 'calc(100vh - 48px)',
          overflow: 'hidden',
          background: 'var(--cds-background)',
          transition: 'margin-top 180ms ease, height 180ms ease',
        }}
      >
        <Outlet />
      </div>
    </>
  );
}