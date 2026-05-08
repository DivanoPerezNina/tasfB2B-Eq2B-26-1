import React from 'react';
import { useSimulation } from '../context/SimulationContext';
import { airports } from '../data/airports';
import { flights } from '../data/flights';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { BarChart3, TrendingUp, Package, Clock, AlertCircle, Plane, Warehouse } from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function Monitoring() {
  const { stats, baggages, airports: airportsState, config } = useSimulation();

  // Datos para gráfico de línea temporal (simulado)
  const timeSeriesData = [
    { time: '00:00', entregadas: 45, retrasadas: 5 },
    { time: '04:00', entregadas: 78, retrasadas: 8 },
    { time: '08:00', entregadas: 120, retrasadas: 12 },
    { time: '12:00', entregadas: 165, retrasadas: 15 },
    { time: '16:00', entregadas: 198, retrasadas: 18 },
    { time: '20:00', entregadas: 234, retrasadas: 22 },
  ];

  // Datos de estados
  const statusData = [
    { name: 'Entregadas', value: stats.delivered, color: '#10b981' },
    { name: 'En Tránsito', value: stats.inTransit, color: '#3b82f6' },
    { name: 'Retrasadas', value: stats.delayed, color: '#ef4444' },
    { name: 'No Embarcadas', value: stats.notBoarded, color: '#f59e0b' },
  ].filter(item => item.value > 0); // Filtrar valores cero para evitar problemas con Recharts

  // Ocupación de aeropuertos
  const airportOccupancyData = airportsState.map(airport => ({
    name: airport.code,
    occupancy: airport.currentOccupancy,
    capacity: airport.warehouseCapacity,
    percentage: (airport.currentOccupancy / airport.warehouseCapacity) * 100
  })).sort((a, b) => b.percentage - a.percentage).slice(0, 10);

  // Semáforos
  const getTrafficLightColor = (percentage: number, thresholds: { green: number; yellow: number; red: number }) => {
    if (percentage >= thresholds.red) return 'bg-red-500';
    if (percentage >= thresholds.yellow) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Panel de Monitoreo</h1>
        <p className="text-sm text-slate-500">KPIs y métricas de rendimiento operacional</p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total Maletas</CardTitle>
            <Package className="h-4 w-4 text-slate-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBaggage}</div>
            <p className="text-xs text-slate-500">Registradas en sistema</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Entregadas</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.delivered}</div>
            <p className="text-xs text-slate-500">
              {stats.totalBaggage > 0 ? ((stats.delivered / stats.totalBaggage) * 100).toFixed(1) : 0}% del total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">En Tránsito</CardTitle>
            <Plane className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.inTransit}</div>
            <p className="text-xs text-slate-500">En movimiento</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Retrasadas</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.delayed}</div>
            <p className="text-xs text-slate-500">Fuera de plazo</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos y métricas */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cumplimiento de plazos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Tasa de Cumplimiento de Plazos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <div className="relative h-48 w-48">
                <svg className="h-full w-full" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="10"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="10"
                    strokeDasharray={`${stats.onTimeDeliveryRate * 2.51} 251`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-green-600">
                    {stats.onTimeDeliveryRate.toFixed(1)}%
                  </span>
                  <span className="text-xs text-slate-500">On-time</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-sm text-slate-600">A tiempo</p>
                <p className="text-xl font-bold text-green-600">
                  {baggages.filter(b => b.status === 'entregada' && !b.isDelayed).length}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Con retraso</p>
                <p className="text-xl font-bold text-red-600">
                  {baggages.filter(b => b.status === 'entregada' && b.isDelayed).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Distribución por estado */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Distribución por Estado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry) => (
                    <Cell key={`cell-${entry.name}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Ocupación de almacenes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Ocupación de Almacenes por Aeropuerto
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={airportOccupancyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="occupancy" name="Ocupación Actual" fill="#3b82f6" />
              <Bar dataKey="capacity" name="Capacidad Máxima" fill="#e2e8f0" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Semáforos de capacidad */}
      <Card>
        <CardHeader>
          <CardTitle>Semáforos de Capacidad</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Almacenes */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Almacenes</h3>
                <span className="text-sm text-slate-500">
                  Umbrales: Verde &lt;{config.thresholds.warehouse.green}% | Ámbar &lt;{config.thresholds.warehouse.yellow}% | Rojo ≥{config.thresholds.warehouse.red}%
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {airportsState.slice(0, 15).map(airport => {
                  const percentage = (airport.currentOccupancy / airport.warehouseCapacity) * 100;
                  const color = getTrafficLightColor(percentage, config.thresholds.warehouse);
                  
                  return (
                    <div key={airport.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium">{airport.code}</span>
                        <div className={`h-3 w-3 rounded-full ${color}`} />
                      </div>
                      <div className="text-xs text-slate-600">
                        {airport.currentOccupancy} / {airport.warehouseCapacity}
                      </div>
                      <div className="mt-1 text-xs font-medium">
                        {percentage.toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Vuelos */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Vuelos (Muestra)</h3>
                <span className="text-sm text-slate-500">
                  Umbrales: Verde &lt;{config.thresholds.flight.green}% | Ámbar &lt;{config.thresholds.flight.yellow}% | Rojo ≥{config.thresholds.flight.red}%
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {flights.slice(0, 10).map(flight => {
                  const percentage = (flight.currentLoad / flight.capacity) * 100;
                  const color = getTrafficLightColor(percentage, config.thresholds.flight);
                  const from = airports.find(a => a.id === flight.fromAirportId);
                  const to = airports.find(a => a.id === flight.toAirportId);
                  
                  return (
                    <div key={flight.id} className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium">
                          {from?.code}→{to?.code}
                        </span>
                        <div className={`h-3 w-3 rounded-full ${color}`} />
                      </div>
                      <div className="text-xs text-slate-600">
                        {flight.currentLoad} / {flight.capacity}
                      </div>
                      <div className="mt-1 text-xs font-medium">
                        {percentage.toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}