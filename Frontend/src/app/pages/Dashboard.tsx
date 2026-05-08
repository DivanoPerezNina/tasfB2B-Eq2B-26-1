import React, { useState } from 'react';
import { Map } from '../components/Map';
import { SimulationControls } from '../components/SimulationControls';
import { useSimulation } from '../context/SimulationContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { airports } from '../data/airports';
import { Package, Plane, AlertCircle, CheckCircle } from 'lucide-react';

export function Dashboard() {
  const [selectedAirportId, setSelectedAirportId] = useState<string | undefined>();
  const { stats, getAirportStats } = useSimulation();

  const selectedAirport = selectedAirportId 
    ? airports.find(a => a.id === selectedAirportId)
    : null;

  const airportStats = selectedAirportId 
    ? getAirportStats(selectedAirportId)
    : null;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Principal</h1>
          <p className="text-sm text-slate-500">Visualización en tiempo real de la red logística</p>
        </div>
      </div>

      <SimulationControls />

      <div className="grid flex-1 grid-cols-3 gap-4">
        {/* Mapa - 2 columnas */}
        <div className="col-span-2">
          <Map 
            selectedAirportId={selectedAirportId} 
            onAirportSelect={setSelectedAirportId}
          />
        </div>

        {/* Panel lateral - 1 columna */}
        <div className="space-y-4">
          {/* Estadísticas globales */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estadísticas Globales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-slate-600">Total Maletas</span>
                </div>
                <span className="font-bold">{stats.totalBaggage}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-slate-600">Entregadas</span>
                </div>
                <span className="font-bold text-green-600">{stats.delivered}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plane className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-slate-600">En Tránsito</span>
                </div>
                <span className="font-bold text-blue-600">{stats.inTransit}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-slate-600">Retrasadas</span>
                </div>
                <span className="font-bold text-red-600">{stats.delayed}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-slate-600">No Embarcadas</span>
                </div>
                <span className="font-bold text-yellow-600">{stats.notBoarded}</span>
              </div>

              <div className="border-t pt-3">
                <div className="text-center">
                  <p className="text-xs text-slate-500">Tasa de Cumplimiento</p>
                  <p className="text-2xl font-bold text-green-600">
                    {stats.onTimeDeliveryRate.toFixed(1)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Información del aeropuerto seleccionado */}
          {selectedAirport && airportStats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Aeropuerto Seleccionado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-slate-500">Código IATA</p>
                  <p className="text-xl font-bold">{selectedAirport.code}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Ciudad</p>
                  <p className="font-medium">{selectedAirport.city}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Continente</p>
                  <p className="font-medium">{selectedAirport.continent}</p>
                </div>

                <div className="border-t pt-3">
                  <p className="text-sm text-slate-500">Ocupación del Almacén</p>
                  <div className="mt-2">
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">
                        {airportStats.occupancy} / {airportStats.capacity}
                      </span>
                      <span className="font-bold">
                        {airportStats.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full transition-all ${
                          airportStats.percentage > 80
                            ? 'bg-red-500'
                            : airportStats.percentage > 60
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(airportStats.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ayuda */}
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-6">
              <p className="text-sm text-blue-900">
                <strong>Haz clic en un aeropuerto</strong> en el mapa para ver información detallada.
                Usa los controles de zoom y filtro para navegar.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
