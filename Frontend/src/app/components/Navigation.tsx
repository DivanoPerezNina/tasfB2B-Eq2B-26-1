import { Link, useLocation } from 'react-router';
import { Activity, Settings, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export function Navigation() {
  const location = useLocation();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const links = [
    { path: '/', label: 'Simulación', icon: Activity },
    { path: '/configuracion', label: 'Configuración', icon: Settings },
  ];

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: 'Claro' },
    { value: 'dark' as const, icon: Moon, label: 'Oscuro' },
    { value: 'system' as const, icon: Monitor, label: 'Sistema' },
  ];

  return (
    <nav className="flex items-center justify-between gap-1 border-b border-panel-border bg-panel-bg px-6 py-2">
      <div className="flex gap-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname === link.path;
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
      </div>

      {/* Theme toggle */}
      <div className="flex items-center rounded-lg border border-panel-border bg-panel-section-bg p-0.5">
        {themeOptions.map(opt => {
          const Icon = opt.icon;
          const isActive = theme === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              title={opt.label}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-all ${
                isActive
                  ? 'bg-panel-bg text-panel-text shadow-sm'
                  : 'text-panel-text-faint hover:text-panel-text-muted'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
