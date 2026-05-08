import React, { useState } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { airports } from '../data/airports';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { BaggageType } from '../types';
import { Package, Search, Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';

export function BaggageManagement() {
  const { registerBaggage, baggages, getBaggageById } = useSimulation();
  const [searchId, setSearchId] = useState('');
  const [formData, setFormData] = useState({
    type: 'Normal' as BaggageType,
    airline: '',
    originAirportId: '',
    destinationAirportId: '',
    quantity: 1
  });

  const handleRegister = () => {
    if (!formData.airline || !formData.originAirportId || !formData.destinationAirportId) {
      toast.error('Por favor completa todos los campos');
      return;
    }

    if (formData.originAirportId === formData.destinationAirportId) {
      toast.error('El origen y destino no pueden ser iguales');
      return;
    }

    // Registrar maletas (individual o masivo)
    for (let i = 0; i < formData.quantity; i++) {
      const origin = airports.find(a => a.id === formData.originAirportId);
      const destination = airports.find(a => a.id === formData.destinationAirportId);
      
      if (!origin || !destination) continue;

      const sameContinentRoute = origin.continent === destination.continent;
      const deliveryDeadlineDays = sameContinentRoute ? 1 : 2;
      
      const estimatedDeliveryTime = new Date();
      estimatedDeliveryTime.setDate(estimatedDeliveryTime.getDate() + deliveryDeadlineDays);

      registerBaggage({
        type: formData.type,
        airline: formData.airline,
        originAirportId: formData.originAirportId,
        destinationAirportId: formData.destinationAirportId,
        currentAirportId: formData.originAirportId,
        status: 'en_almacen',
        estimatedDeliveryTime,
        plannedRoute: [formData.originAirportId, formData.destinationAirportId],
        isDelayed: false,
        affectedByCancellation: false
      });
    }

    toast.success(`${formData.quantity} maleta(s) registrada(s) exitosamente`);
    
    // Reset form
    setFormData({
      ...formData,
      airline: '',
      quantity: 1
    });
  };

  const searchedBaggage = searchId ? getBaggageById(searchId) : null;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Gestión de Equipaje</h1>
        <p className="text-sm text-slate-500">Registro y seguimiento de maletas extraviadas</p>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-4">
        {/* Formulario de registro */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Registrar Nueva Maleta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="type">Tipo de Maleta</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v as BaggageType })}>
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="Negocio">Negocio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="airline">Aerolínea</Label>
                <Input
                  id="airline"
                  placeholder="Ej: American Airlines"
                  value={formData.airline}
                  onChange={(e) => setFormData({ ...formData, airline: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="origin">Aeropuerto de Origen</Label>
                <Select value={formData.originAirportId} onValueChange={(v) => setFormData({ ...formData, originAirportId: v })}>
                  <SelectTrigger id="origin">
                    <SelectValue placeholder="Selecciona origen" />
                  </SelectTrigger>
                  <SelectContent>
                    {airports.map(airport => (
                      <SelectItem key={airport.id} value={airport.id}>
                        {airport.code} - {airport.city} ({airport.continent})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="destination">Aeropuerto de Destino</Label>
                <Select value={formData.destinationAirportId} onValueChange={(v) => setFormData({ ...formData, destinationAirportId: v })}>
                  <SelectTrigger id="destination">
                    <SelectValue placeholder="Selecciona destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {airports.map(airport => (
                      <SelectItem key={airport.id} value={airport.id}>
                        {airport.code} - {airport.city} ({airport.continent})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="quantity">Cantidad de Maletas</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Para registro masivo, ingresa la cantidad
                </p>
              </div>

              <Button onClick={handleRegister} className="w-full">
                <Package className="mr-2 h-4 w-4" />
                Registrar Maleta(s)
              </Button>
            </CardContent>
          </Card>

          {/* Plan de viaje */}
          {formData.originAirportId && formData.destinationAirportId && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Plan de Viaje Estimado
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Origen:</span>
                    <span className="font-medium">
                      {airports.find(a => a.id === formData.originAirportId)?.code}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Destino:</span>
                    <span className="font-medium">
                      {airports.find(a => a.id === formData.destinationAirportId)?.code}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Tiempo estimado:</span>
                    <span className="font-medium">
                      {airports.find(a => a.id === formData.originAirportId)?.continent ===
                       airports.find(a => a.id === formData.destinationAirportId)?.continent
                        ? '1 día' : '2 días'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Tipo de ruta:</span>
                    <span className="font-medium">
                      {airports.find(a => a.id === formData.originAirportId)?.continent ===
                       airports.find(a => a.id === formData.destinationAirportId)?.continent
                        ? 'Mismo continente' : 'Intercontinental'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Búsqueda y lista */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Buscar Maleta por ID
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Ingresa el ID de la maleta"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                />
                <Button onClick={() => setSearchId('')} variant="outline">
                  Limpiar
                </Button>
              </div>

              {searchedBaggage && (
                <div className="mt-4 space-y-2 rounded-lg border bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">ID:</span>
                    <span className="font-mono text-sm">{searchedBaggage.id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Tipo:</span>
                    <span className="font-medium">{searchedBaggage.type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Aerolínea:</span>
                    <span className="font-medium">{searchedBaggage.airline}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Estado:</span>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                      searchedBaggage.status === 'entregada' ? 'bg-green-100 text-green-700' :
                      searchedBaggage.status === 'en_transito' ? 'bg-blue-100 text-blue-700' :
                      searchedBaggage.status === 'retrasada' ? 'bg-red-100 text-red-700' :
                      searchedBaggage.status === 'no_embarcada' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {searchedBaggage.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Ubicación actual:</span>
                    <span className="font-medium">
                      {airports.find(a => a.id === searchedBaggage.currentAirportId)?.code}
                    </span>
                  </div>
                </div>
              )}

              {searchId && !searchedBaggage && (
                <p className="mt-4 text-center text-sm text-slate-500">
                  No se encontró ninguna maleta con ese ID
                </p>
              )}
            </CardContent>
          </Card>

          {/* Lista de maletas recientes */}
          <Card>
            <CardHeader>
              <CardTitle>Maletas Registradas ({baggages.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {baggages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">
                    No hay maletas registradas aún
                  </p>
                ) : (
                  baggages.slice(-20).reverse().map(baggage => (
                    <div key={baggage.id} className="flex items-center justify-between rounded border p-2">
                      <div className="flex items-center gap-2">
                        <Package className={`h-4 w-4 ${
                          baggage.type === 'Negocio' ? 'text-purple-500' : 'text-blue-500'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">{baggage.airline}</p>
                          <p className="text-xs text-slate-500">
                            {airports.find(a => a.id === baggage.originAirportId)?.code} → {' '}
                            {airports.find(a => a.id === baggage.destinationAirportId)?.code}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        baggage.status === 'entregada' ? 'bg-green-100 text-green-700' :
                        baggage.status === 'en_transito' ? 'bg-blue-100 text-blue-700' :
                        baggage.status === 'retrasada' ? 'bg-red-100 text-red-700' :
                        baggage.status === 'no_embarcada' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {baggage.status.replace('_', ' ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
