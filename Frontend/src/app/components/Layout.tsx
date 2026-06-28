import { Outlet } from 'react-router';
import { Navigation } from './Navigation';

// El Header de Carbon es fijo (48px de alto), por eso el contenido se desplaza
// 48px hacia abajo y ocupa el resto del viewport.
export function Layout() {
  return (
    <>
      <Navigation />
      <div style={{ marginTop: '48px', height: 'calc(100vh - 48px)', overflow: 'hidden', background: 'var(--cds-background)' }}>
        <Outlet />
      </div>
    </>
  );
}
