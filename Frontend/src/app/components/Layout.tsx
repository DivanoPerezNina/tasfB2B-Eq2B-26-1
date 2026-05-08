import { Outlet } from 'react-router';
import { Navigation } from './Navigation';

export function Layout() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="border-b border-panel-border bg-panel-bg px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-panel-text">
              Dashboard de Logística Aeroportuaria - Tasf.B2B
            </h1>
            <p className="text-xs text-panel-text-faint">
              Sistema de gestión de equipajes extraviados entre América, Asia y Europa
            </p>
          </div>
        </div>
      </div>
      <Navigation />
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
