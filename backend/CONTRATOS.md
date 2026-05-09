# Contratos Compartidos — Backend TASF.B2B

Este archivo define las convenciones que aplican a **todos** los servicios del backend (BFF, Carga Masiva, Planificador, Ejecutor).

---

## 1. Estructura de Respuesta Genérica

Todos los endpoints REST devuelven este envelope:

```json
{
  "success": true,
  "data":    { },
  "message": "Ejecutor - tick 2430 procesado correctamente",
  "error":   null
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `success` | `bool` | `true` si la operación fue exitosa, `false` en cualquier error |
| `data` | `object \| array \| null` | Payload de la respuesta. `null` cuando `success = false` |
| `message` | `string` | Mensaje de contexto: indica en qué componente/operación estamos. Siempre presente |
| `error` | `string \| null` | Stack trace o descripción del error (`e.printStackTrace()`). `null` cuando `success = true` |

### Ejemplo exitoso

```json
{
  "success": true,
  "data": {
    "simulacion_id": 1,
    "estado": "ejecutando",
    "tick_actual": 2430
  },
  "message": "Ejecutor - simulación iniciada correctamente",
  "error": null
}
```

### Ejemplo de error

```json
{
  "success": false,
  "data": null,
  "message": "Ejecutor - error al procesar tick 2430",
  "error": "java.lang.NullPointerException: vuelo_id 2847 no encontrado en índice de vuelos\n\tat pe.edu.pucp.tasf.ejecutor.TickEngine.procesarSalidas(TickEngine.java:142)\n\t..."
}
```

---

## 2. Códigos HTTP

| Código | Cuándo usarlo |
|---|---|
| `200 OK` | Operación completada, respuesta con `data` |
| `202 Accepted` | Operación iniciada en background (planificación, carga masiva) |
| `400 Bad Request` | Parámetros inválidos o faltantes |
| `409 Conflict` | Datos ya existentes / estado incompatible |
| `412 Precondition Failed` | Dependencia no cumplida (ej: cargar vuelos sin aeropuertos) |
| `500 Internal Server Error` | Error no controlado del servidor |

Todos devuelven el envelope genérico, incluyendo los errores.

---

## 3. Convención de Puertos

| Servicio | Puerto |
|---|---|
| Planificador (Java) | 8080 |
| BFF (Go) | 8081 |
| Carga Masiva (Go) | 8082 |
| Ejecutor (Go) | 8083 |
| MySQL | 3306 |
| Frontend (Nginx) | 80 |
