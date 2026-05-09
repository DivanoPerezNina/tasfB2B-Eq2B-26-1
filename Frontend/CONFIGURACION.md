# Componente: Configuración

**Ruta:** `/configuracion`  
**Archivo:** `src/app/pages/SimulationConfig.tsx`  
**Estado:** UI prototipada con datos hardcodeados

---

## Modelo

### Datos que maneja

```typescript
interface ConfiguracionState {
  // Pestaña General
  escenario: 'TIEMPO_REAL' | 'PERIODO_3D' | 'PERIODO_5D' | 'PERIODO_7D' | 'COLAPSO'
  velocidad: number          // 1..N (solo relevante en TIEMPO_REAL y COLAPSO)
  duracionRealMin: number    // 30..90 (solo en escenarios PERIODO)
  fechaInicio: Date

  // Pestaña Umbrales
  umbralVerde: number        // 0.0..1.0 (default 0.60)
  umbralRojo: number         // 0.0..1.0 (default 0.85)

  // Estado de carga de datos (Pestaña Planes de Vuelo)
  estadoCarga: EstadoCarga

  // Estado de la barra de estado superior
  simulacionActiva: SimulacionResumen | null
}

interface EstadoCarga {
  aeropuertos: { cargados: number; total: 30; estado: 'pendiente'|'ok'|'error' }
  vuelos: { cargados: number; estado: 'pendiente'|'ok'|'error' }
  envios: { total: number; porAeropuerto: Record<string, number>; listoParaSimular: boolean }
}

interface SimulacionResumen {
  id: number
  tiempoSimulado: Date
  escenario: string
  velocidad: string   // "1x", "1.6 min/seg", etc.
}
```

---

## Vista

### Layout general

```
┌─ Nav ────────────────────────────────────────────────────────────┐
│  [Simulación]  [Configuración*]            [Claro|Oscuro|Sistema] │
└──────────────────────────────────────────────────────────────────┘
┌─ Título ─────────────────────────────────────────────────────────┐
│ Configuración de Simulación                                       │
│ Parámetros operacionales del sistema GVNS                         │
│                                    [Descartar]  [Guardar y Aplicar]│
└──────────────────────────────────────────────────────────────────┘
┌─ Barra de estado ────────────────────────────────────────────────┐
│ 🕐 Tiempo: 09/05/2026 14:10:36  | Escenario: Tiempo Real | Vel: 1x│
│                                           [▶ Iniciar] [↺ Reiniciar]│
└──────────────────────────────────────────────────────────────────┘
┌─ Pestañas ───────────────────────────────────────────────────────┐
│  [⚙ General]  [📤 Planes de Vuelo]  [📊 Umbrales]  [📅 Historial] │
└──────────────────────────────────────────────────────────────────┘
┌─ Contenido de pestaña activa ────────────────────────────────────┐
│  (ver detalle por pestaña abajo)                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### Pestaña: General

Campos visibles **siempre**:
- **Escenario de Simulación** (dropdown)
  - Día a Día (Tiempo Real)
  - Simulación de Periodo — 3 días
  - Simulación de Periodo — 5 días
  - Simulación de Periodo — 7 días
  - Simulación hasta el Colapso
- **Velocidad de Simulación** — input numérico `N x veces más rápido` *(solo para Tiempo Real y Colapso)*
- **Fecha y Hora de Inicio** — datetime picker

Campos adicionales que aparecen **solo al seleccionar un escenario de Periodo**:
- **Duración real de la simulación** — slider o input `30 – 90 minutos`
- Texto informativo calculado dinámicamente:
  `"Ejemplo: 3 días en 45 min → avance de 1.6 min simulados por segundo real"`

---

### Pestaña: Planes de Vuelo

Es la interfaz con el componente **Carga Masiva** del backend.

```
┌─ Estado actual de datos en BD ──────────────────────────────────┐
│  Aeropuertos:  ✅ 30 / 30 cargados                               │
│  Vuelos:       ✅ 4,800 vuelos cargados                           │
│  Envíos:       ⏳ 12 / 30 archivos procesados  (4,200,000 reg.)  │
│                [████████░░░░░░░░░░░░] 40%                        │
└──────────────────────────────────────────────────────────────────┘

┌─ Subir aeropuertos ─────────────────────────────────────────────┐
│  [📎 Seleccionar aeropuertos.txt]   [📥 Descargar plantilla]     │
│  Formato esperado: id·IATA·ciudad·país·alias·GMT·cap·lat·lng     │
└──────────────────────────────────────────────────────────────────┘

┌─ Subir planes de vuelo ─────────────────────────────────────────┐
│  [📎 Seleccionar vuelos.txt]        [📥 Descargar plantilla]     │
│  Formato esperado: ORIG-DEST-HH:MM-HH:MM-capacidad              │
│  ⚠ Requiere que los aeropuertos estén cargados                   │
└──────────────────────────────────────────────────────────────────┘

┌─ Subir archivos de envíos ──────────────────────────────────────┐
│  [📎 Seleccionar _envios_*.txt (1 por aeropuerto)]              │
│  Nombre requerido: _envios_{IATA}_.txt                           │
│  [📥 Descargar plantilla]                                         │
│                                                                   │
│  Progreso por aeropuerto:                                         │
│  SKBO ✅  SEQM ✅  SVMI ⏳  SBBR ❌  ...                         │
└──────────────────────────────────────────────────────────────────┘

[🗑 Limpiar todos los datos]   ← requiere confirmación
```

---

### Pestaña: Umbrales

Configura los límites del semáforo que aplican al mapa y a los reportes.

```
┌─ Umbrales de Ocupación de Almacén ─────────────────────────────┐
│                                                                   │
│  🟢 Verde  (capacidad OK)   → ocupación < [60]%                  │
│  🟡 Ámbar  (capacidad media) → entre verde y rojo                │
│  🔴 Rojo   (capacidad alta) → ocupación > [85]%                  │
│                                                                   │
│  Vista previa:                                                    │
│  [0%────────────────60%──────────────85%────────100%]            │
│   ████████████████████ ░░░░░░░░░░░░░░ ▓▓▓▓▓▓▓▓▓▓▓▓▓            │
│        verde                ámbar           rojo                  │
└──────────────────────────────────────────────────────────────────┘
```

Los umbrales se envían al Ejecutor al iniciar la simulación como parte de `POST /api/simulacion/configurar`.

---

### Pestaña: Historial

Lista de simulaciones anteriores guardadas en BD.

```
┌─ Historial de Simulaciones ────────────────────────────────────┐
│  # │ Fecha         │ Escenario   │ Días │ Tasa éxito │ Estado   │
│  3 │ 08/05/2026    │ Periodo 3D  │  3   │  96.5%     │ ✅ OK    │
│  2 │ 07/05/2026    │ Tiempo Real │  —   │  88.2%     │ ✅ OK    │
│  1 │ 06/05/2026    │ Periodo 5D  │  5   │  91.1%     │ ✅ OK    │
│                                              [Ver detalle] [Cargar]│
└──────────────────────────────────────────────────────────────────┘
```

`[Cargar]` restaura la configuración de esa simulación en el formulario General.

---

## Controlador

### Acciones del usuario

| Acción | Handler | Llamada API |
|---|---|---|
| Cambiar escenario | `handleEscenarioChange` | — (local) |
| Subir aeropuertos.txt | `handleUploadAeropuertos` | `POST /api/carga/upload/aeropuertos` |
| Subir vuelos.txt | `handleUploadVuelos` | `POST /api/carga/upload/vuelos` |
| Subir `_envios_*.txt` | `handleUploadEnvios` | `POST /api/carga/upload/envios` (×N archivos, secuencial) |
| Polling estado de carga | `pollEstadoCarga` | `GET /api/carga/estado` (cada 2s mientras hay uploads pendientes) |
| Guardar y Aplicar | `handleGuardar` | `POST /api/planificacion/iniciar` → espera `listo` → `POST /api/simulacion/configurar` |
| Iniciar ▶ | `handleIniciar` | `POST /api/simulacion/{id}/iniciar` → navega a `/` |
| Reiniciar ↺ | `handleReiniciar` | `POST /api/simulacion/{id}/detener` → resetea estado local |
| Descargar plantilla | `handleDescargarPlantilla(tipo)` | `GET /api/carga/plantillas/{tipo}` |
| Limpiar datos | `handleLimpiarDatos` | `DELETE /api/carga/datos` (con confirmación modal) |

### Flujo completo: desde carga hasta simulación corriendo

```
1. Usuario abre /configuracion
2. handleMount → GET /api/carga/estado → muestra datos actuales en BD

3. [Pestaña Planes de Vuelo]
   handleUploadAeropuertos → POST /api/carga/upload/aeropuertos
     → polling GET /api/carga/sesion/{token} hasta estado = "ok"
   handleUploadVuelos      → POST /api/carga/upload/vuelos
     → polling hasta "ok"
   handleUploadEnvios ×30  → POST /api/carga/upload/envios (uno por uno)
     → polling por cada token hasta todos "ok"

4. [Pestaña General] — usuario configura escenario, fecha, duración
5. Guardar y Aplicar
   → POST /api/planificacion/iniciar {escenario, fecha, criterio}
   → polling GET /api/planificacion/{id} hasta estado = "listo" (puede tardar minutos)
   → muestra barra de progreso "Planificando rutas..."

6. Cuando plan listo:
   → POST /api/simulacion/configurar {simulacion_id, modo, dias, duracion_real_min, umbrales}

7. Usuario presiona Iniciar ▶
   → POST /api/simulacion/{id}/iniciar
   → navigate('/')   ← el Dashboard empieza a recibir SSE
```

---

## TODOs

- [ ] Implementar lógica de upload en `handleUploadEnvios` — los 30 archivos deben subirse secuencialmente (no en paralelo) para no saturar el servidor con 2 GB de RAM
- [ ] Implementar polling de estado de carga con `GET /api/carga/estado` y actualizar barra de progreso
- [ ] Conectar escenarios de Periodo a los campos de duración real (actualmente no aparece el campo)
- [ ] Mostrar barra de progreso de planificación mientras el Planificador corre GVNS (puede tardar 5–30 min)
- [ ] Implementar pestaña Historial con `GET /api/simulacion/historial`
- [ ] Validar en frontend que `umbral_verde < umbral_rojo` antes de enviar
- [ ] Manejar el caso `409 Conflict` de Carga Masiva (datos ya existentes) con un modal de confirmación
