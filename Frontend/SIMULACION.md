# Componente: Simulación (Dashboard)

**Ruta:** `/`  
**Archivo:** `src/app/pages/UnifiedDashboard.tsx`  
**Estado:** UI prototipada con datos hardcodeados

---

## Modelo

### Datos que consume

| Dato | Fuente actual | Fuente definitiva |
|---|---|---|
| Lista de aeropuertos (30) | `data/aeropuertos.ts` | `GET /api/aeropuertos` al montar |
| Lista de vuelos | `data/vuelos.ts` | `GET /api/vuelos` al montar |
| Ocupación por aeropuerto | `SimulationContext` (JS mock) | SSE `event: tick` |
| Semáforo por aeropuerto | Calculado localmente | SSE `event: cambio_semaforo` |
| Métricas globales | `SimulationContext` (JS mock) | SSE `event: tick` → `metricas_globales` |
| Detalle de envío | `data/envios.ts` (40 mock) | `GET /api/simulacion/{id}/envio/{id_envio}` |
| Detalle de aeropuerto | Estático | `GET /api/simulacion/{id}/aeropuerto/{iata}` |

### Estado local del componente

```typescript
// Panel izquierdo
const [busqueda, setBusqueda] = useState('')
const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoBusqueda[]>([])
const [panelActivo, setPanelActivo] = useState<'aeropuerto' | 'vuelo' | 'envio' | null>(null)
const [detalleEnvio, setDetalleEnvio] = useState<DetalleEnvio | null>(null)

// Mapa
const [zoomNivel, setZoomNivel] = useState(1.0)
const [filtroActivo, setFiltroActivo] = useState<'todos' | 'america' | 'europa' | 'asia'>('todos')
const [vuelosVisibles, setVuelosVisibles] = useState<number>(59)
```

---

## Vista

### Layout

```
┌─ Nav ────────────────────────────────────────────────────────────┐
│  [Simulación*]  [Configuración]            [Claro|Oscuro|Sistema] │
└──────────────────────────────────────────────────────────────────┘
┌─ Sidebar 320px ──┐ ┌─ Mapa (resto del ancho) ──────────────────┐
│                   │ │ [+][-][⛶]  Filtro▾   ✈ N          Zoom  │
│ 🔍 Buscador       │ │                                  [info]   │
│  [chip] [chip]    │ │                                           │
│                   │ │  ●  ●  ●  (aeropuertos coloreados)        │
│ ── Panel activo ─ │ │    ╰───────╮ (arcos de rutas)             │
│  Aeropuerto /     │ │  ●      ●  ╯                              │
│  Vuelo /          │ │                                           │
│  Envío            │ │                           ┌─ Leyenda ───┐ │
│                   │ │                           │ ● verde <60%│ │
│ ── Cumplimiento ─ │ │                           │ ● ámbar 60% │ │
│  Continental  96% │ │                           │ ● rojo  >80%│ │
│  Intercont.   88% │ │                           │ ~ azul cont │ │
│  28✓ 7GVNS 5✗    │ │                           │ ~ amar int  │ │
│                   │ └───────────────────────────┴─────────────┘ │
│ ── Métricas ───── │                                              │
│  Total      9519k │                                              │
│  Entregadas    0  │                                              │
│  En Tránsito   0  │                                              │
│  Retrasadas    0  │                                              │
│  No Embarcadas 0  │                                              │
└───────────────────┘
```

### Mapa — Niveles de Zoom

| Zoom | Lo que se muestra |
|---|---|
| `< 1.5x` | Los 30 aeropuertos como puntos, rutas intercontinentales activas |
| `1.5x – 3x` | Código IATA sobre cada aeropuerto, rutas continentales |
| `> 3x` | Nombre del aeropuerto, indicador numérico de maletas en espera |

El tamaño del punto indica el tier del aeropuerto: Hub (grande) · Regional (mediano) · Pequeño (chico).

### Sidebar — Secciones Colapsables

#### Buscador
- Input libre con sugerencias en tiempo real
- Chips de resultado: `IATA: SKBO` / `Ruta: SKBO-EDDI` / `Envío: ENV-0001`
- Al seleccionar un chip, el mapa hace zoom al elemento y abre el panel correspondiente

#### Panel Aeropuerto (al clic en mapa o búsqueda por IATA)
```
📍 SKBO — Bogotá, Colombia
   Semáforo: 🟡 Ámbar
   Ocupación almacén: 309 / 430 maletas (72%)
   Vuelos activos: 3
   Envíos en espera: 340
   [Ver todos los vuelos desde aquí]
```

#### Panel Vuelo (al clic en arco o búsqueda por ruta)
```
✈ Vuelo #42 — SKBO → SEQM
   Estado: En vuelo
   Salida sim.: 18/08/2026 19:00
   Llegada sim.: 19/08/2026 07:00
   Maletas: 218 / 250
   Tipo: Continental
```

#### Panel Envío (al búsqueda por ID o desde panel aeropuerto)
```
📦 Envío #00000001
   De: SKBO → A: EBCI
   Estado: En vuelo (segmento 1 de 2)
   Vuelo actual: #187 EHAM→EBCI
   Llegada est.: 19/08/2026 14:00
   Deadline: 20/08/2026 00:00  ✅ En plazo
   Semáforo: 🟢 Verde
```

#### Cumplimiento de Plazos
- Continental (24h): porcentaje + barra
- Intercontinental (48h): porcentaje + barra
- Contadores: `N exitosos` (verde) · `N salvados GVNS` (morado) · `N rechazados` (rojo)

#### Métricas Globales
- Total Equipaje, Entregadas, En Tránsito, Retrasadas, No Embarcadas
- Se actualizan con cada evento SSE `tick`

---

## Controlador

### Acciones del usuario

| Acción | Handler | Efecto |
|---|---|---|
| Clic en aeropuerto del mapa | `handleAeropuertoClick(iata)` | Abre panel aeropuerto, suscribe SSE a ese aeropuerto |
| Clic en arco de ruta | `handleVueloClick(vueloId)` | Abre panel vuelo |
| Buscar texto | `handleBusqueda(texto)` | Filtra aeropuertos/vuelos/envíos, muestra chips |
| Seleccionar chip envío | `handleEnvioSelect(id)` | Llama `GET /api/simulacion/{id}/envio/{idEnvio}` |
| Zoom in/out | `handleZoom(nivel)` | Cambia nivel de detalle del mapa; si cambia aeropuerto en foco, reconecta SSE |
| Filtro continental | `handleFiltro(continente)` | Filtra aeropuertos y rutas visibles |

### Ciclo de vida SSE

```typescript
useEffect(() => {
  if (!isRunning || !aeropuertoSeleccionado) return

  // Conectar al stream del aeropuerto en foco
  const source = sseService.conectar(simulacionId, aeropuertoSeleccionado)

  source.addEventListener('tick', (e) => {
    const data = JSON.parse(e.data)
    dispatch({ type: 'ACTUALIZAR_TICK', payload: data })
  })

  source.addEventListener('cambio_semaforo', (e) => {
    dispatch({ type: 'ACTUALIZAR_SEMAFORO', payload: JSON.parse(e.data) })
  })

  source.addEventListener('fin_simulacion', (e) => {
    dispatch({ type: 'FIN_SIMULACION', payload: JSON.parse(e.data) })
    source.close()
  })

  return () => source.close()   // limpieza al desmontar o cambiar aeropuerto
}, [isRunning, aeropuertoSeleccionado, simulacionId])
```

### Llamadas API

| Momento | Endpoint | Uso |
|---|---|---|
| Al montar la página | `GET /api/aeropuertos` | Carga los 30 aeropuertos para el mapa |
| Al montar la página | `GET /api/vuelos` | Carga rutas para pintar arcos |
| Al seleccionar envío | `GET /api/simulacion/{id}/envio/{idEnvio}?origen={iata}` | Panel detalle de envío |
| Al seleccionar aeropuerto | `GET /api/simulacion/{id}/aeropuerto/{iata}` | Panel detalle de aeropuerto |
| Continuo (SSE) | `GET /api/simulacion/{id}/eventos?aeropuerto={iata}` | Actualizaciones en tiempo real |

---

## TODOs

- [ ] Reemplazar `data/aeropuertos.ts` y `data/vuelos.ts` por llamadas reales a la API
- [ ] Implementar `sseService.ts` con manejo de reconexión automática (EventSource no reconecta solo en todos los browsers)
- [ ] Implementar zoom-based rendering en `Map.tsx` (actualmente muestra todos los elementos siempre)
- [ ] Conectar panel de Envío al endpoint real del Ejecutor
- [ ] Implementar overlay "Re-calculando rutas..." al recibir evento SSE `replanificacion`
- [ ] Reemplazar métricas hardcodeadas en Cumplimiento de Plazos con datos del SSE
