# Frontend — Especificación General

**Framework:** React 18 + TypeScript + Vite 6  
**Servidor:** Nginx (archivos estáticos)  
**Estado:** UI prototipada con datos hardcodeados — pendiente integración con BFF

> Las URLs de API referenciadas en este doc apuntan al BFF (`:8081`). Ver `backend/CONTRATOS.md` para el envelope genérico de respuestas.

---

## 1. Páginas del Sistema

| Ruta | Componente | Descripción |
|---|---|---|
| `/` | `UnifiedDashboard` | Mapa interactivo + métricas en tiempo real |
| `/configuracion` | `SimulationConfig` | Carga de datos y parámetros de simulación |

---

## 2. Patrón MVC en React

El frontend sigue MVC adaptado a React:

```
Model      → SimulationContext + tipos en types/index.ts + servicios API en services/
View       → Componentes TSX (pages/ y components/)
Controller → Handlers de eventos + useEffect + funciones de los servicios API
```

```
src/app/
├── pages/                   # View: páginas completas
│   ├── UnifiedDashboard.tsx
│   └── SimulationConfig.tsx
├── components/              # View: componentes reutilizables
│   ├── Map.tsx
│   ├── SimulationControls.tsx
│   ├── Navigation.tsx
│   ├── Sidebar.tsx
│   └── ui/                  # Biblioteca de componentes base (shadcn/Radix)
├── context/
│   └── SimulationContext.tsx  # Model: estado global de la simulación
├── services/                  # Controller: llamadas al BFF (por implementar)
│   ├── cargaService.ts
│   ├── simulacionService.ts
│   └── sseService.ts
├── types/
│   └── index.ts               # Model: interfaces y enums
└── data/                      # Datos hardcodeados (reemplazar con servicios)
    ├── aeropuertos.ts
    ├── vuelos.ts
    └── envios.ts
```

---

## 3. Estado Global — SimulationContext

Datos que viven en `SimulationContext` y son accesibles desde cualquier componente:

```typescript
interface SimulationState {
  // Estado de la simulación
  isRunning: boolean
  isPaused: boolean
  simulationTime: Date | null          // reloj simulado actual
  diaSimulado: number                  // 1..N
  progresoPct: number                  // 0..100

  // Configuración activa
  config: SimulationConfig

  // Datos del dominio (cargados desde BFF)
  aeropuertos: Aeropuerto[]
  vuelos: Vuelo[]

  // Estado en tiempo real (llega por SSE)
  ocupacionAeropuertos: Record<string, OcupacionAeropuerto>
  metricasGlobales: MetricasGlobales

  // Selección del usuario
  aeropuertoSeleccionado: string | null  // IATA
  vueloSeleccionado: number | null       // vuelo_id
  envioSeleccionado: string | null       // id_envio

  // Acciones
  iniciarSimulacion: () => void
  pausarSimulacion: () => void
  reanudarSimulacion: () => void
  detenerSimulacion: () => void
  seleccionarAeropuerto: (iata: string | null) => void
  seleccionarVuelo: (id: number | null) => void
  seleccionarEnvio: (id: string | null) => void
}
```

---

## 4. Integración SSE

El componente `sseService.ts` (por implementar) maneja la conexión al Ejecutor vía BFF:

```typescript
// Se conecta cuando la simulación inicia
// aeropuertoFoco = aeropuerto actualmente visible en pantalla
const source = new EventSource(
  `/api/simulacion/${simulacionId}/eventos?aeropuerto=${aeropuertoFoco}`
)

source.addEventListener('tick', (e) => { /* actualiza ocupación y métricas */ })
source.addEventListener('cambio_semaforo', (e) => { /* actualiza color del aeropuerto */ })
source.addEventListener('fin_simulacion', (e) => { /* muestra resumen final */ })
source.addEventListener('replanificacion', (e) => { /* muestra overlay de re-cálculo */ })
```

Cuando el usuario hace zoom o cambia de aeropuerto en foco, el cliente **cierra la conexión SSE actual y abre una nueva** con el nuevo `?aeropuerto=` para que el Ejecutor filtre eventos relevantes.

---

## 5. Carpeta `services/` — Por Implementar

Estos archivos reemplazan los datos hardcodeados de `data/`:

| Archivo | Responsabilidad |
|---|---|
| `cargaService.ts` | Upload de archivos, consulta de estado de carga, totales en BD |
| `simulacionService.ts` | Configurar, iniciar, pausar, detener simulación; consultar envío/aeropuerto |
| `sseService.ts` | Gestión del EventSource, mapeo de eventos a estado del contexto |

---

## 6. Datos Hardcodeados a Reemplazar

| Archivo actual | Reemplazado por |
|---|---|
| `data/aeropuertos.ts` | `GET /api/aeropuertos` (BFF → Carga Masiva) |
| `data/vuelos.ts` | `GET /api/vuelos` (BFF → Carga Masiva) |
| `data/envios.ts` (40 mock) | SSE + `GET /api/simulacion/{id}/envio/{id}` (BFF → Ejecutor) |
| `SimulationContext` loop JS | Conexión SSE real al Ejecutor |
