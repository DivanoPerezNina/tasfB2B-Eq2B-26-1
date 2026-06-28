import { Link, useLocation } from 'react-router';
import {
  Header, HeaderName, HeaderNavigation, HeaderMenuItem,
  HeaderGlobalBar, HeaderGlobalAction,
} from '@carbon/react';
import { Light, Asleep, Screen, Logout } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { clearToken } from '../lib/auth';

/**
 * Chrome principal (Carbon UI Shell — Header superior).
 *
 * Estructura preparada para roles: hoy solo existe el perfil de logística/admin.
 * Cuando entren los operarios, este header se recorta por rol y "Operaciones
 * (día a día)" se separa de "Simulaciones (Periodo/Colapso)" en la navegación.
 */
export function Navigation() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const cerrarSesion = () => {
    clearToken();
    window.location.reload();
  };

  const links = [
    { path: '/', label: 'Simulación' },
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

  return (
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
      </HeaderGlobalBar>
    </Header>
  );
}
