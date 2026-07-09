import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  Activity,
  Settings,
  Sun,
  Moon,
  Monitor,
  Database,
  LogOut,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { clearToken } from '../lib/auth';

const HEADER_COLLAPSED_KEY = 'tasf.header.collapsed';

export function Navigation() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(HEADER_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HEADER_COLLAPSED_KEY, String(collapsed));
    } catch {
      // localStorage no disponible
    }
  }, [collapsed]);

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
    <header
      className={`border-b border-panel-border bg-panel-bg shadow-sm transition-all duration-300 ${
        collapsed ? 'px-4 py-1.5' : 'px-6 py-3'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Marca / título */}
        <div className="min-w-0 shrink-0">
          {collapsed ? (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-500/15 px-2 py-1 text-xs font-bold text-blue-600 dark:text-blue-400">
                TASF.B2B
              </span>
              <span className="hidden text-xs text-panel-text-faint md:inline">
                Logística Aeroportuaria
              </span>
            </div>
          ) : (
            <>
              <h1 className="truncate text-xl font-bold text-panel-text">
                Dashboard de Logística Aeroportuaria - Tasf.B2B
              </h1>
              <p className="truncate text-xs text-panel-text-faint">
                Sistema de gestión de equipajes extraviados entre América, Asia y Europa
              </p>
            </>
          )}
        </div>

        {/* Menú + controles */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <nav className="flex flex-wrap items-center gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = isActivePath(link.path);

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`flex items-center gap-2 rounded-md font-medium transition-colors ${
                    collapsed
                      ? 'px-2.5 py-1.5 text-xs'
                      : 'px-3 py-2 text-sm'
                  } ${
                    isActive
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'text-panel-text-muted hover:bg-panel-hover hover:text-panel-text'
                  }`}
                  title={link.label}
                >
                  <Icon className={collapsed ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                  <span className={collapsed ? 'hidden lg:inline' : ''}>
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden h-6 w-px bg-panel-border md:block" />

          {/* Tema */}
          <div className="flex items-center rounded-lg border border-panel-border bg-panel-section-bg p-0.5">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const isActive = theme === opt.value;

              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex items-center gap-1.5 rounded-md font-medium transition-colors ${
                    collapsed
                      ? 'px-2 py-1 text-[11px]'
                      : 'px-2.5 py-1.5 text-xs'
                  } ${
                    isActive
                      ? 'bg-panel-bg text-panel-text shadow-sm'
                      : 'text-panel-text-faint hover:text-panel-text'
                  }`}
                  title={opt.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {!collapsed && <span className="hidden sm:inline">{opt.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Salir */}
          <button
            onClick={cerrarSesion}
            className={`flex items-center gap-1.5 rounded-md font-medium text-panel-text-faint transition-colors hover:bg-panel-hover hover:text-panel-text ${
              collapsed
                ? 'px-2 py-1 text-[11px]'
                : 'px-2.5 py-1.5 text-xs'
            }`}
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
            {!collapsed && <span>Salir</span>}
          </button>

          {/* Contraer / expandir */}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md border border-panel-border bg-panel-section-bg font-medium text-panel-text-muted transition-colors hover:bg-panel-hover hover:text-panel-text ${
              collapsed
                ? 'px-2 py-1 text-[11px]'
                : 'px-2.5 py-1.5 text-xs'
            }`}
            title={collapsed ? 'Expandir cabecera' : 'Contraer cabecera'}
          >
            {collapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Expandir</span>
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Contraer</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}