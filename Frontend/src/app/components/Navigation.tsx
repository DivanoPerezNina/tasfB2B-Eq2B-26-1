import { Link, useLocation } from 'react-router';
import {
  Header, HeaderName, HeaderNavigation, HeaderMenuItem,
  HeaderGlobalBar, HeaderGlobalAction,
} from '@carbon/react';
import { Light, Asleep, Screen, Logout } from '@carbon/icons-react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { clearPerfil } from '../lib/auth';

interface NavigationProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/**
 * Chrome principal (Carbon UI Shell — Header superior).
 *
 * En estado normal mantiene la cabecera original. La única adición visible es
 * una manija inferior para ocultar/mostrar la barra y ganar alto para el mapa.
 */
export function Navigation({ collapsed = false, onToggleCollapsed }: NavigationProps) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const cerrarSesion = () => {
    clearPerfil();
    window.location.reload();
  };

  const links = [
    { path: '/', label: 'Simulación' },
    { path: '/cancelaciones', label: 'Cancelaciones' },
    { path: '/mantenimiento', label: 'Mantenimiento' },
    { path: '/configuracion', label: 'Configuración' },
    { path: '/datos', label: 'Ingreso de datos' },
  ];

  const themeOptions = [
    { value: 'light' as const, icon: Light, label: 'Claro' },
    { value: 'dark' as const, icon: Asleep, label: 'Oscuro' },
    { value: 'system' as const, icon: Screen, label: 'Sistema' },
  ];

  const isActivePath = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="fixed right-4 top-0 z-[80] flex h-6 w-16 items-center justify-center rounded-b-full border border-t-0 border-panel-border bg-panel-bg text-panel-text-muted shadow-lg transition-colors hover:bg-panel-hover hover:text-panel-text"
        title="Mostrar cabecera"
        aria-label="Mostrar cabecera"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative z-[70]">
      <Header aria-label="TASF.B2B — Logística Aeroportuaria">
        <HeaderName as={Link} to="/" prefix="TASF.B2B">
          Logística
        </HeaderName>

        <HeaderNavigation aria-label="Navegación principal">
          {links.map((l) => (
            <HeaderMenuItem
              key={l.path}
              as={Link}
              to={l.path}
              isActive={isActivePath(l.path)}
            >
              {l.label}
            </HeaderMenuItem>
          ))}
        </HeaderNavigation>

        <HeaderGlobalBar>
          {themeOptions.map((opt) => (
            <HeaderGlobalAction
              key={opt.value}
              aria-label={`Tema: ${opt.label}`}
              isActive={theme === opt.value}
              onClick={() => setTheme(opt.value)}
            >
              <opt.icon size={20} />
            </HeaderGlobalAction>
          ))}
          <HeaderGlobalAction aria-label="Salir" onClick={cerrarSesion}>
            <Logout size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction aria-label="Ocultar cabecera" onClick={onToggleCollapsed}>
            <ChevronUp size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>
    </div>
  );
}