import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Baggage, FlightCancellation, SimulationConfig, SimulationStats, SimulationScenario, Airport } from '../types';
import { airports as initialAirports } from '../data/airports';
import { flights as initialFlights } from '../data/flights';

interface SimulationContextType {
  // Estado de simulación
  isRunning: boolean;
  simulationTime: Date;
  config: SimulationConfig;
  airports: Airport[];
  
  // Datos de maletas
  baggages: Baggage[];
  cancellations: FlightCancellation[];
  
  // Estadísticas
  stats: SimulationStats;
  
  // Acciones
  startSimulation: () => void;
  pauseSimulation: () => void;
  resetSimulation: () => void;
  updateConfig: (config: Partial<SimulationConfig>) => void;
  registerBaggage: (baggage: Omit<Baggage, 'id' | 'registrationTime' | 'actualRoute'>) => void;
  registerCancellation: (flightId: string) => void;
  getBaggageById: (id: string) => Baggage | undefined;
  getAirportStats: (airportId: string) => { occupancy: number; capacity: number; percentage: number };
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const useSimulation = () => {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulation must be used within SimulationProvider');
  }
  return context;
};

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [simulationTime, setSimulationTime] = useState(new Date());
  const [airports, setAirports] = useState<Airport[]>(initialAirports);
  const [baggages, setBaggages] = useState<Baggage[]>([]);
  const [cancellations, setCancellations] = useState<FlightCancellation[]>([]);
  const [config, setConfig] = useState<SimulationConfig>({
    scenario: 'realtime',
    startDate: new Date(),
    speed: 1,
    thresholds: {
      warehouse: { green: 60, yellow: 80, red: 95 },
      flight: { green: 60, yellow: 80, red: 95 }
    },
    algorithmParams: {}
  });

  // Calcular estadísticas
  const stats: SimulationStats = {
    totalBaggage: baggages.length,
    delivered: baggages.filter(b => b.status === 'entregada').length,
    inTransit: baggages.filter(b => b.status === 'en_transito').length,
    delayed: baggages.filter(b => b.status === 'retrasada').length,
    notBoarded: baggages.filter(b => b.status === 'no_embarcada').length,
    onTimeDeliveryRate: baggages.length > 0 
      ? (baggages.filter(b => b.status === 'entregada' && !b.isDelayed).length / baggages.filter(b => b.status === 'entregada').length) * 100 
      : 0
  };

  // Motor de simulación
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const increment = config.speed * 60 * 1000; // 1 minuto de simulación por tick
      setSimulationTime(prev => new Date(prev.getTime() + increment));

      // Actualizar estado de maletas
      setBaggages(prev => prev.map(baggage => {
        if (baggage.status === 'entregada') return baggage;

        const now = simulationTime;
        
        // Verificar si llegó a destino
        if (baggage.currentAirportId === baggage.destinationAirportId) {
          return {
            ...baggage,
            status: 'entregada',
            actualDeliveryTime: now
          };
        }

        // Verificar si está retrasada
        const isDelayed = now > baggage.estimatedDeliveryTime;
        
        return {
          ...baggage,
          isDelayed,
          status: isDelayed ? 'retrasada' : baggage.status
        };
      }));

      // Actualizar ocupación de aeropuertos
      setAirports(prev => prev.map(airport => ({
        ...airport,
        currentOccupancy: baggages.filter(b => 
          b.currentAirportId === airport.id && 
          (b.status === 'en_almacen' || b.status === 'no_embarcada')
        ).length
      })));

    }, 1000 / config.speed); // Tick cada segundo, escalado por velocidad

    return () => clearInterval(interval);
  }, [isRunning, config.speed, simulationTime]);

  const startSimulation = useCallback(() => {
    setIsRunning(true);
  }, []);

  const pauseSimulation = useCallback(() => {
    setIsRunning(false);
  }, []);

  const resetSimulation = useCallback(() => {
    setIsRunning(false);
    setSimulationTime(config.startDate);
    setBaggages([]);
    setCancellations([]);
    setAirports(initialAirports);
  }, [config.startDate]);

  const updateConfig = useCallback((newConfig: Partial<SimulationConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  const registerBaggage = useCallback((baggageData: Omit<Baggage, 'id' | 'registrationTime' | 'actualRoute'>) => {
    const newBaggage: Baggage = {
      ...baggageData,
      id: `BAG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      registrationTime: simulationTime,
      actualRoute: [baggageData.originAirportId]
    };
    setBaggages(prev => [...prev, newBaggage]);
  }, [simulationTime]);

  const registerCancellation = useCallback((flightId: string) => {
    const affectedBaggages = baggages.filter(b => 
      b.plannedRoute.some((_, idx) => {
        if (idx === 0) return false;
        const fromAirport = b.plannedRoute[idx - 1];
        const toAirport = b.plannedRoute[idx];
        const flight = initialFlights.find(f => 
          f.fromAirportId === fromAirport && f.toAirportId === toAirport
        );
        return flight?.id === flightId;
      })
    );

    const cancellation: FlightCancellation = {
      id: `CANCEL-${Date.now()}`,
      flightId,
      cancellationTime: simulationTime,
      affectedBaggageIds: affectedBaggages.map(b => b.id)
    };

    setCancellations(prev => [...prev, cancellation]);
    
    // Marcar maletas como afectadas
    setBaggages(prev => prev.map(b => 
      affectedBaggages.some(ab => ab.id === b.id)
        ? { ...b, affectedByCancellation: true, status: 'no_embarcada' as const }
        : b
    ));
  }, [baggages, simulationTime]);

  const getBaggageById = useCallback((id: string) => {
    return baggages.find(b => b.id === id);
  }, [baggages]);

  const getAirportStats = useCallback((airportId: string) => {
    const airport = airports.find(a => a.id === airportId);
    if (!airport) return { occupancy: 0, capacity: 0, percentage: 0 };
    
    return {
      occupancy: airport.currentOccupancy,
      capacity: airport.warehouseCapacity,
      percentage: (airport.currentOccupancy / airport.warehouseCapacity) * 100
    };
  }, [airports]);

  return (
    <SimulationContext.Provider value={{
      isRunning,
      simulationTime,
      config,
      airports,
      baggages,
      cancellations,
      stats,
      startSimulation,
      pauseSimulation,
      resetSimulation,
      updateConfig,
      registerBaggage,
      registerCancellation,
      getBaggageById,
      getAirportStats
    }}>
      {children}
    </SimulationContext.Provider>
  );
};
