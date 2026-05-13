import React from 'react';
import { useSimulation } from '../context/SimulationContext';
import { Button } from './ui/button';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';
import { format } from 'date-fns';

export function SimulationControls() {
  const { isRunning, simulationTime, startSimulation, pauseSimulation, resetSimulation, config } = useSimulation();

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-slate-600" />
        <div>
          <p className="text-xs text-slate-500">Tiempo de Simulación</p>
          <p className="font-mono font-medium">
            {format(simulationTime, 'dd/MM/yyyy HH:mm:ss')}
          </p>
        </div>
      </div>

      <div className="h-10 w-px bg-slate-200" />

      <div>
        <p className="text-xs text-slate-500">Escenario</p>
        <p className="font-medium capitalize">
          {config.scenario === 'realtime' ? 'Tiempo Real' : 
           config.scenario === 'period' ? 'Periodo' : 'Colapso'}
        </p>
      </div>

      <div className="h-10 w-px bg-slate-200" />

      <div>
        <p className="text-xs text-slate-500">Duración real</p>
        <p className="font-medium">{config.duracionRealMin ?? config.speed ?? 60} min</p>
      </div>

      <div className="ml-auto flex gap-2">
        {isRunning ? (
          <Button onClick={pauseSimulation} variant="outline" size="sm">
            <Pause className="mr-2 h-4 w-4" />
            Pausar
          </Button>
        ) : (
          <Button onClick={startSimulation} size="sm">
            <Play className="mr-2 h-4 w-4" />
            Iniciar
          </Button>
        )}
        
        <Button onClick={resetSimulation} variant="outline" size="sm">
          <RotateCcw className="mr-2 h-4 w-4" />
          Reiniciar
        </Button>
      </div>
    </div>
  );
}
