import { Link, useLocation } from 'react-router';
import {
  Activity,
  Settings,
  Sun,
  Moon,
  Monitor,
  Database,
  LogOut,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { clearToken } from '../lib/auth';

export function Navigation() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const cerrarSesion = () => {
    clearToken();
    window.location.reload();
  };

  const links = [
    { path: '/', label: 'Simulación', icon: Activity },
    { path: '/configuracion', label: 'Configuración', icon: Settings },
    { path: '/datos', label: 'Ingreso de datos', icon: Database },
  ];

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: 'Claro' },
    { value: 'dark' as const, icon: Moon, label: 'Oscuro' },
    { value: 'system' as const, icon: Monitor, label: 'Sistema' },
  ];

  const isActivePath = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header className="border-b border-panel-border bg-panel-bg px-6 py-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 shrink-0">
          <h1 className="truncate text-xl font-bold text-panel-text">
            Dashboard de Logística Aeroportuaria - Tasf.B2B
          </h1>
          <p className="truncate text-xs text-panel-text-faint">
            Sistema de gestión de equipajes extraviados entre América, Asia y Europa
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
          <nav className="flex flex-wrap items-center gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = isActivePath(link.path);
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'text-panel-text-muted hover:bg-panel-hover hover:text-panel-text'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden h-7 w-px bg-panel-border md:block" />

          <div className="flex items-center rounded-lg border border-panel-border bg-panel-section-bg p-0.5">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const isActive = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-panel-bg text-panel-text shadow-sm'
                      : 'text-panel-text-faint hover:text-panel-text'
                  }`}
                  title={opt.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{opt.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={cerrarSesion}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-panel-text-faint transition-colors hover:bg-panel-hover hover:text-panel-text"
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
