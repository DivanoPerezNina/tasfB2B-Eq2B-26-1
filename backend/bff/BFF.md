# BFF — Especificación del Módulo

**Lenguaje:** Go  
**Puerto:** 8081  
**Responsable:** [asignar integrante]

> Todas las respuestas siguen el envelope `{success, data, message, error}` definido en [`backend/CONTRATOS.md`](../CONTRATOS.md).

---

## 1. Responsabilidad

Punto de entrada único del frontend. Recibe todas las peticiones HTTP/SSE del navegador y las enruta al servicio interno correspondiente sin modificar el payload. **No contiene lógica de negocio.**

Excepciones donde el BFF actúa por cuenta propia (sin delegar a otro servicio):
- `GET /api/aeropuertos` y `GET /api/vuelos` — lee directo de MySQL (datos fríos que el frontend necesita al montar la página)
- `GET /api/health` — consulta el estado de los 3 servicios internos y devuelve un resumen

---

## 2. Tabla Maestra de Rutas

### Datos de dominio (propios del BFF)

| Método | Ruta BFF | Origen | Descripción |
|---|---|---|---|
| GET | `/api/aeropuertos` | MySQL directo | Lista de 30 aeropuertos para el mapa |
| GET | `/api/vuelos` | MySQL directo | Lista de vuelos para pintar arcos en el mapa |
| GET | `/api/health` | BFF + ping servicios | Estado de salud del sistema completo |

### Carga Masiva → puerto 8082

| Método | Ruta BFF | Ruta interna | Descripción |
|---|---|---|---|
| POST | `/api/carga/upload/aeropuertos` | `/upload/aeropuertos` | Subir aeropuertos.txt |
| POST | `/api/carga/upload/vuelos` | `/upload/vuelos` | Subir vuelos.txt |
| POST | `/api/carga/upload/envios` | `/upload/envios` | Subir `_envios_XXXX_.txt` |
| GET | `/api/carga/sesion/{token}` | `/upload/sesion/{token}` | Estado de una sesión de carga |
| GET | `/api/carga/estado` | `/estado` | Totales actuales en BD |
| GET | `/api/carga/plantillas/{tipo}` | `/plantillas/{tipo}` | Descargar plantilla de archivo |
| DELETE | `/api/carga/datos` | `/datos` | Limpiar todos los datos |

### Planificador → puerto 8080

| Método | Ruta BFF | Ruta interna | Descripción |
|---|---|---|---|
| POST | `/api/planificacion/iniciar` | `/api/planificacion/iniciar` | Lanzar algoritmo GVNS |
| GET | `/api/planificacion/{id}` | `/api/planificacion/{id}` | Estado / resultado del plan |
| POST | `/api/planificacion/{id}/replanificar` | `/api/planificacion/{id}/replanificar` | Re-planificar por cancelación |

### Ejecutor → puerto 8083

| Método | Ruta BFF | Ruta interna | Descripción |
|---|---|---|---|
| POST | `/api/simulacion/configurar` | `/api/simulacion/configurar` | Configurar velocidad y umbrales |
| POST | `/api/simulacion/{id}/iniciar` | `/api/simulacion/{id}/iniciar` | Iniciar simulación |
| POST | `/api/simulacion/{id}/pausar` | `/api/simulacion/{id}/pausar` | Pausar |
| POST | `/api/simulacion/{id}/reanudar` | `/api/simulacion/{id}/reanudar` | Reanudar |
| POST | `/api/simulacion/{id}/detener` | `/api/simulacion/{id}/detener` | Detener y liberar memoria |
| GET | `/api/simulacion/{id}/estado` | `/api/simulacion/{id}/estado` | Estado actual del tick |
| GET | `/api/simulacion/{id}/envio/{id_envio}` | `/api/simulacion/{id}/envio/{id_envio}` | Detalle de un envío |
| GET | `/api/simulacion/{id}/aeropuerto/{iata}` | `/api/simulacion/{id}/aeropuerto/{iata}` | Detalle de un aeropuerto |
| POST | `/api/simulacion/{id}/cancelacion` | `/api/simulacion/{id}/cancelacion` | Notificar cancelación |
| GET | `/api/simulacion/{id}/eventos` | `/api/simulacion/{id}/eventos` | **SSE proxy** (ver sección 4) |

---

## 3. Endpoints Propios

### GET /api/aeropuertos

Lee la tabla `aeropuertos` de MySQL y devuelve los 30 registros. El frontend usa esta respuesta para pintar los puntos del mapa al montar la página.

**Respuesta `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "iata": "SKBO",
      "ciudad": "Bogota",
      "pais": "Colombia",
      "continente": 1,
      "gmt_offset": -5,
      "capacidad_almacen": 430,
      "lat": 4.701389,
      "lng": -74.146944
    }
  ],
  "message": "BFF - aeropuertos cargados desde base de datos",
  "error": null
}
```

**Respuesta si la BD no tiene datos `200 OK` con lista vacía:**
```json
{
  "success": true,
  "data": [],
  "message": "BFF - no hay aeropuertos en BD, cargue datos en /configuracion",
  "error": null
}
```

---

### GET /api/vuelos

Lee la tabla `vuelos` de MySQL. El frontend usa esta respuesta para pintar los arcos de rutas en el mapa.

**Respuesta `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "origen_iata": "SKBO",
      "destino_iata": "SEQM",
      "salida_minutos": 1140,
      "llegada_minutos": 420,
      "capacidad_max": 220,
      "mismo_continente": true
    }
  ],
  "message": "BFF - vuelos cargados desde base de datos",
  "error": null
}
```

---

### GET /api/health

Verifica que los 3 servicios internos respondan. Útil para el deploy y para diagnóstico.

**Respuesta `200 OK` (todo bien):**
```json
{
  "success": true,
  "data": {
    "bff": "ok",
    "carga_masiva": "ok",
    "planificador": "ok",
    "ejecutor": "ok",
    "mysql": "ok"
  },
  "message": "BFF - todos los servicios operativos",
  "error": null
}
```

**Respuesta `200 OK` (algún servicio caído):**
```json
{
  "success": false,
  "data": {
    "bff": "ok",
    "carga_masiva": "ok",
    "planificador": "error",
    "ejecutor": "ok",
    "mysql": "ok"
  },
  "message": "BFF - uno o más servicios no responden",
  "error": "planificador: connection refused (localhost:8080)"
}
```

---

## 4. Proxy SSE

El frontend abre la conexión SSE al BFF, no directamente al Ejecutor. El BFF actúa como intermediario transparente: abre su propia conexión al Ejecutor y reenvía cada evento al cliente.

```
Browser
  │  GET /api/simulacion/{id}/eventos?aeropuerto=SKBO
  │  Accept: text/event-stream
  ▼
BFF (Go)
  │  abre conexión SSE → GET ejecutor:8083/api/simulacion/{id}/eventos?aeropuerto=SKBO
  │  lee eventos del Ejecutor línea a línea (bufio.Scanner)
  │  reenvía cada línea al browser sin modificar
  ▼
Ejecutor
  emite eventos tick, cambio_semaforo, fin_simulacion, replanificacion
```

### Comportamiento ante desconexión del cliente

Si el browser cierra la conexión SSE (navegación, cierre de pestaña):
1. El BFF detecta que el cliente se desconectó (error al escribir en el response)
2. El BFF cierra su conexión con el Ejecutor
3. El Ejecutor libera ese suscriptor

Si el Ejecutor se cae o cierra la conexión:
1. El BFF recibe EOF del stream del Ejecutor
2. El BFF cierra la conexión con el browser
3. El browser reintenta con `EventSource` automáticamente (comportamiento nativo)

---

## 5. CORS

El frontend corre en Nginx (puerto 80) y el BFF en el puerto 8081. Sin cabeceras CORS el browser bloquea todas las peticiones.

El BFF agrega estas cabeceras a **todas** las respuestas:

```
Access-Control-Allow-Origin:  http://localhost  (VM: dominio o IP de la VM)
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Para las peticiones `OPTIONS` (preflight), el BFF responde `204 No Content` inmediatamente sin delegar al servicio interno.

> En desarrollo local en Windows el origen será `http://localhost:5173` (Vite dev server). Configurar `CORS_ORIGIN` como variable de entorno para no hardcodear.

---

## 6. Estructura de Carpetas

```
bff/
├── cmd/
│   └── bff/
│       └── main.go              # Entry point: configura rutas y arranca servidor
├── internal/
│   ├── handler/
│   │   ├── dominio.go           # GET /api/aeropuertos, GET /api/vuelos (MySQL directo)
│   │   ├── health.go            # GET /api/health
│   │   └── proxy.go             # Proxy genérico HTTP y SSE hacia servicios internos
│   ├── db/
│   │   └── conexion.go          # Pool de conexiones MySQL (solo lectura)
│   └── config/
│       └── config.go            # Lee variables de entorno
├── go.mod
└── BFF.md                       # este archivo
```

---

## 7. Variables de Configuración

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `8081` | Puerto del BFF |
| `DB_HOST` | `localhost` | Host MySQL |
| `DB_PORT` | `3306` | Puerto MySQL |
| `DB_NAME` | `tasfb2b` | Base de datos |
| `DB_USER` | `tasf` | Usuario MySQL |
| `DB_PASS` | — | Contraseña (obligatoria) |
| `CARGA_MASIVA_URL` | `http://localhost:8082` | URL del servicio Carga Masiva |
| `PLANIFICADOR_URL` | `http://localhost:8080` | URL del Planificador |
| `EJECUTOR_URL` | `http://localhost:8083` | URL del Ejecutor |
| `CORS_ORIGIN` | `http://localhost` | Origen permitido para CORS |

---

## 8. TODOs

- [ ] **TODO-1** — Implementar `proxy.go` como proxy HTTP genérico: recibe request del browser, clona headers, reenvía al servicio interno, devuelve respuesta. Un solo handler reutilizable para todas las rutas proxy
- [ ] **TODO-2** — Implementar proxy SSE en `proxy.go`: mantener conexión larga con el Ejecutor y hacer flush de cada evento al browser (`http.Flusher`)
- [ ] **TODO-3** — Configurar CORS dinámico desde variable de entorno `CORS_ORIGIN` para soportar tanto desarrollo local (`localhost:5173`) como VM (`localhost` o IP)
- [ ] **TODO-4** — `GET /api/health` debe tener timeout corto (2s) al hacer ping a cada servicio para no bloquear al browser si un servicio está caído
