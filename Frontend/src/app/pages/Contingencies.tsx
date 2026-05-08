import React, { useState } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { flights } from '../data/flights';
import { airports } from '../data/airports';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { AlertTriangle, XCircle, RefreshCw, Bell } from 'lucide-react';
import { toast } from 'sonner';

export function Contingencies() {
  const { baggages, cancellations, registerCancellation } = useSimulation();
  const [selectedFlightId, setSelectedFlightId] = useState('');

  const handleCancelFlight = () => {
    if (!selectedFlightId) {
      toast.error('Selecciona un vuelo para cancelar');
      return;
    }

    const flight = flights.find(f => f.id === selectedFlightId);
    if (!flight) return;

    const fromAirport = airports.find(a => a.id === flight.fromAirportId);
    const toAirport = airports.find(a => a.id === flight.toAirportId);

    registerCancellation(selectedFlightId);
    
    toast.error(
      `Vuelo cancelado: ${fromAirport?.code} → ${toAirport?.code}`,
      { description: 'Las maletas afectadas han sido marcadas para replanificación' }
    );

    setSelectedFlightId('');
  };

  // Maletas afectadas por cancelaciones
  const affectedBaggages = baggages.filter(b => b.affectedByCancellation);

  // Maletas retrasadas
  const delayedBaggages = baggages.filter(b => b.isDelayed);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Control de Contingencias</h1>
        <p className="text-sm text-slate-500">Gestión de cancelaciones y replanificación de rutas</p>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-4">
        {/* Panel de cancelaciones */}
        <div className="space-y-4">
          <Card className="border-red-200">
            <CardHeader className="bg-red-50">
              <CardTitle className="flex items-center gap-2 text-red-900">
                <XCircle className="h-5 w-5" />
                Registrar Cancelación de Vuelo
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Seleccionar Vuelo</label>
                  <Select value={selectedFlightId} onValueChange={setSelectedFlightId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elige un vuelo para cancelar" />
                    </SelectTrigger>
                    <SelectContent>
                      {flights.map(flight => {
                        const from = airports.find(a => a.id === flight.fromAirportId);
                        const to = airports.find(a => a.id === flight.toAirportId);
                        return (
                          <SelectItem key={flight.id} value={flight.id}>
                            {from?.code} → {to?.code} ({flight.sameContinentRoute ? 'Cont.' : 'Inter.'})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {selectedFlightId && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-sm font-medium">Información del Vuelo</p>
                    {(() => {
                      const flight = flights.find(f => f.id === selectedFlightId);
                      if (!flight) return null;
                      const from = airports.find(a => a.id === flight.fromAirportId);
                      const to = airports.find(a => a.id === flight.toAirportId);
                      return (
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-600">Ruta:</span>
                            <span className="font-medium">{from?.code} → {to?.code}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Capacidad:</span>
                            <span className="font-medium">{flight.capacity} maletas</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Duración:</span>
                            <span className="font-medium">{flight.duration} día(s)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Tipo:</span>
                            <span className="font-medium">
                              {flight.sameContinentRoute ? 'Mismo continente' : 'Intercontinental'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <Button 
                  onClick={handleCancelFlight} 
                  variant="destructive" 
                  className="w-full"
                  disabled={!selectedFlightId}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancelar Vuelo
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Historial de cancelaciones */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Historial de Cancelaciones ({cancellations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {cancellations.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">
                    No hay cancelaciones registradas
                  </p>
                ) : (
                  cancellations.reverse().map(cancellation => {
                    const flight = flights.find(f => f.id === cancellation.flightId);
                    const from = airports.find(a => a.id === flight?.fromAirportId);
                    const to = airports.find(a => a.id === flight?.toAirportId);
                    
                    return (
                      <div key={cancellation.id} className="rounded border border-red-200 bg-red-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-medium text-red-900">
                            {from?.code} → {to?.code}
                          </span>
                          <span className="text-xs text-red-700">
                            {cancellation.affectedBaggageIds.length} maletas afectadas
                          </span>
                        </div>
                        <p className="text-xs text-red-700">
                          {new Date(cancellation.cancellationTime).toLocaleString()}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Panel de notificaciones y alertas */}
        <div className="space-y-4">
          <Card className="border-yellow-200">
            <CardHeader className="bg-yellow-50">
              <CardTitle className="flex items-center gap-2 text-yellow-900">
                <Bell className="h-5 w-5" />
                Alertas de Retraso ({delayedBaggages.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {delayedBaggages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">
                    No hay maletas retrasadas
                  </p>
                ) : (
                  delayedBaggages.map(baggage => {
                    const current = airports.find(a => a.id === baggage.currentAirportId);
                    const destination = airports.find(a => a.id === baggage.destinationAirportId);
                    
                    return (
                      <div key={baggage.id} className="rounded border border-yellow-300 bg-yellow-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-sm font-medium text-yellow-900">
                            {baggage.id.slice(0, 20)}...
                          </span>
                          <span className="rounded-full bg-yellow-200 px-2 py-1 text-xs font-medium text-yellow-800">
                            Retrasada
                          </span>
                        </div>
                        <div className="space-y-1 text-xs text-yellow-800">
                          <p>Aerolínea: {baggage.airline}</p>
                          <p>Ubicación: {current?.code}</p>
                          <p>Destino: {destination?.code}</p>
                          <p>Tipo: {baggage.type}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200">
            <CardHeader className="bg-red-50">
              <CardTitle className="flex items-center gap-2 text-red-900">
                <RefreshCw className="h-5 w-5" />
                Maletas Pendientes de Replanificación ({affectedBaggages.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {affectedBaggages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">
                    No hay maletas pendientes de replanificación
                  </p>
                ) : (
                  affectedBaggages.map(baggage => {
                    const current = airports.find(a => a.id === baggage.currentAirportId);
                    const destination = airports.find(a => a.id === baggage.destinationAirportId);
                    
                    return (
                      <div key={baggage.id} className="rounded border border-red-300 bg-red-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-sm font-medium text-red-900">
                            {baggage.id.slice(0, 20)}...
                          </span>
                          <span className="rounded-full bg-red-200 px-2 py-1 text-xs font-medium text-red-800">
                            No embarcada
                          </span>
                        </div>
                        <div className="space-y-1 text-xs text-red-800">
                          <p>Aerolínea: {baggage.airline}</p>
                          <p>Ubicación: {current?.code}</p>
                          <p>Destino: {destination?.code}</p>
                          <p>Tipo: {baggage.type}</p>
                        </div>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="mt-2 w-full border-red-300 text-red-900 hover:bg-red-100"
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Replanificar Ruta
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Comparativa de rutas */}
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-base text-blue-900">
                Algoritmo de Replanificación
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-blue-800">
                El sistema utiliza algoritmos metaheurísticos para encontrar rutas alternativas
                óptimas cuando un vuelo es cancelado, considerando:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-blue-800">
                <li>• Capacidad de almacenes</li>
                <li>• Capacidad de vuelos disponibles</li>
                <li>• Tiempos de entrega máximos</li>
                <li>• Prioridad de maletas tipo Negocio</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
