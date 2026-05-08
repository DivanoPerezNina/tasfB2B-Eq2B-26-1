import React from 'react';
import { Link, useLocation } from 'react-router';
import { 
  LayoutDashboard, 
  Package, 
  AlertTriangle, 
  BarChart3, 
  Settings,
  Plane
} from 'lucide-react';
import { cn } from './ui/utils';

const navigation = [
  { name: 'Dashboard Principal', href: '/', icon: LayoutDashboard },
  { name: 'Gestión de Equipaje', href: '/baggage', icon: Package },
  { name: 'Contingencias', href: '/contingencies', icon: AlertTriangle },
  { name: 'Monitoreo KPIs', href: '/monitoring', icon: BarChart3 },
  { name: 'Configuración', href: '/config', icon: Settings },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <div className="flex h-full w-64 flex-col bg-slate-900 text-white">
      <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
        <Plane className="h-8 w-8 text-blue-400" />
        <div>
          <h1 className="font-bold">Tasf.B2B</h1>
          <p className="text-xs text-slate-400">Logística Aeroportuaria</p>
        </div>
      </div>
      
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="rounded-lg bg-slate-800 p-3">
          <p className="text-xs text-slate-400">Sistema de Simulación</p>
          <p className="text-sm font-medium">Versión 1.0.0</p>
        </div>
      </div>
    </div>
  );
}
