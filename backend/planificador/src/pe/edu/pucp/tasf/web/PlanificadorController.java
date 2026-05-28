package pe.edu.pucp.tasf.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import pe.edu.pucp.tasf.gvns.CriterioOrden;
import pe.edu.pucp.tasf.gvns.EnvioAsignado;
import pe.edu.pucp.tasf.gvns.GestorDatos;
import pe.edu.pucp.tasf.gvns.PlanificadorService;
import pe.edu.pucp.tasf.gvns.ResultadoPlanificacion;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * API REST del motor de planificación GVNS.
 *
 * <h3>Flujo de uso</h3>
 * <ol>
 *   <li>{@code POST /api/planificacion/iniciar} — lanza el job, devuelve el jobId.</li>
 *   <li>{@code GET  /api/planificacion/status/{jobId}} — poll de progreso (0-100 %).</li>
 *   <li>{@code GET  /api/planificacion/resultado/{jobId}} — plan completo en JSON.</li>
 * </ol>
 *
 * <h3>Endpoints de red</h3>
 * <ul>
 *   <li>{@code GET /api/aeropuertos} — lista de aeropuertos del archivo.</li>
 *   <li>{@code GET /api/vuelos}      — lista de vuelos del archivo.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class PlanificadorController {

    private final PlanificadorProperties props;
    private final JobStore               jobs;
    private final ExecutorService        executor = Executors.newCachedThreadPool();

    public PlanificadorController(PlanificadorProperties props, JobStore jobs) {
        this.props = props;
        this.jobs  = jobs;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // POST /api/planificacion/iniciar
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Lanza un job de planificación asíncrono.
     *
     * <p>Body JSON esperado:
     * <pre>{@code
     * {
     *   "fechaInicio": "2026-01-15",   // ISO date YYYY-MM-DD
     *   "dias":        3,              // días a planificar (1-7)
     *   "criterio":    "EDF",          // ALEATORIO | EDF | FIFO  (opcional)
     *   "semilla":     42              // long, opcional
     * }
     * }</pre>
     *
     * <p>Responde 202 con {@code {"jobId": "...", "estado": "EN_PROCESO"}}.
     */
    @PostMapping("/planificacion/iniciar")
    public ResponseEntity<String> iniciar(@RequestBody Map<String, Object> body) {
        // ── Parsear parámetros ─────────────────────────────────────────────
        String fechaIsoStr = (String) body.get("fechaInicio");
        if (fechaIsoStr == null) {
            return error(400, "PARAM_FALTANTE", "Se requiere 'fechaInicio' (YYYY-MM-DD)");
        }

        int diasSolicitud;
        try {
            diasSolicitud = body.containsKey("dias")
                    ? ((Number) body.get("dias")).intValue()
                    : 1;
        } catch (Exception e) {
            return error(400, "PARAM_INVALIDO", "'dias' debe ser un número entero");
        }
        if (diasSolicitud < 1 || diasSolicitud > 30) {
            return error(400, "PARAM_INVALIDO", "'dias' debe estar entre 1 y 30");
        }

        CriterioOrden criterio;
        try {
            String cStr = body.containsKey("criterio")
                    ? ((String) body.get("criterio")).toUpperCase()
                    : props.getCriterioDefault().toUpperCase();
            criterio = CriterioOrden.valueOf(cStr);
        } catch (IllegalArgumentException e) {
            return error(400, "CRITERIO_INVALIDO", "Valores válidos: ALEATORIO, EDF, FIFO");
        }

        long semilla = body.containsKey("semilla")
                ? ((Number) body.get("semilla")).longValue()
                : 42L;

        // ── Convertir fechaInicio a epoch-minutos UTC ──────────────────────
        long fechaIniUTC;
        try {
            int[] ymdhm = parsearFechaISO(fechaIsoStr);
            // ymdhm = [anio, mes, dia, hora, minuto]; GMT=0 porque el frontend envía en UTC
            fechaIniUTC = GestorDatos.calcularEpochMinutos(ymdhm[0], ymdhm[1], ymdhm[2], ymdhm[3], ymdhm[4], 0);
        } catch (Exception e) {
            return error(400, "FECHA_INVALIDA", "Formato esperado: YYYY-MM-DD o YYYY-MM-DDTHH:MM");
        }

        // ── Calcular inicio del dataset para warm-up ───────────────────────
        int datasetYMD = props.getFechaDatasetInicio();
        int dsAnio = datasetYMD / 10000;
        int dsMes  = (datasetYMD / 100) % 100;
        int dsDia  = datasetYMD % 100;
        long datasetIniUTC = GestorDatos.calcularEpochMinutos(dsAnio, dsMes, dsDia, 0, 0, 0);

        // ── Crear job y lanzar en background ──────────────────────────────
        JobStore.Job job = jobs.crear();
        final long   fIniUTC  = fechaIniUTC;
        final long   dsIniUTC = datasetIniUTC;
        final int    numDias  = diasSolicitud;
        final CriterioOrden crit   = criterio;
        final long          sem    = semilla;

        executor.submit(() -> ejecutarJob(job, dsIniUTC, fIniUTC, numDias, crit, sem));

        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"jobId\":\"" + job.id + "\",\"estado\":\"EN_PROCESO\"}");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /api/planificacion/status/{jobId}
    // ═══════════════════════════════════════════════════════════════════════════

    @GetMapping("/planificacion/status/{jobId}")
    public ResponseEntity<String> status(@PathVariable String jobId) {
        JobStore.Job job = jobs.obtener(jobId);
        if (job == null) return error(404, "JOB_NOT_FOUND", "Job no encontrado: " + jobId);

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"jobId\":\"").append(job.id).append("\",");
        sb.append("\"estado\":\"").append(job.estado).append("\",");
        sb.append("\"progreso\":").append(job.progreso).append(",");
        sb.append("\"mensaje\":\"").append(escapar(job.mensaje)).append("\"");
        if (job.estado == JobStore.Estado.ERROR) {
            sb.append(",\"error\":\"").append(escapar(job.errorMsg)).append("\"");
        }
        sb.append("}");
        return ok(sb.toString());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /api/planificacion/resultado/{jobId}
    // ═══════════════════════════════════════════════════════════════════════════

    @GetMapping("/planificacion/resultado/{jobId}")
    public ResponseEntity<String> resultado(@PathVariable String jobId) {
        JobStore.Job job = jobs.obtener(jobId);
        if (job == null) return error(404, "JOB_NOT_FOUND", "Job no encontrado: " + jobId);
        if (job.estado == JobStore.Estado.EN_PROCESO)
            return error(409, "JOB_EN_PROCESO", "El job aún está en proceso (progreso: " + job.progreso + "%)");
        if (job.estado == JobStore.Estado.ERROR)
            return error(500, "JOB_ERROR", job.errorMsg);

        return ok(job.resultadoJson);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /api/aeropuertos
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Devuelve la lista de aeropuertos cargados desde el archivo.
     * Útil para el BFF y el frontend (mapa de aeropuertos).
     */
    @GetMapping("/aeropuertos")
    public ResponseEntity<String> aeropuertos() {
        try {
            GestorDatos datos = new GestorDatos();
            datos.cargarAeropuertos(props.getRutaAeropuertos());

            StringBuilder sb = new StringBuilder("[");
            for (int i = 1; i <= datos.numAeropuertos; i++) {
                if (i > 1) sb.append(',');
                sb.append("{");
                sb.append("\"id\":").append(i).append(',');
                sb.append("\"iata\":\"").append(datos.iataAeropuerto[i]).append("\",");
                sb.append("\"capacidad\":").append(datos.capacidadAlmacen[i]).append(',');
                sb.append("\"gmt\":").append(datos.gmtAeropuerto[i]).append(',');
                sb.append("\"continente\":").append(datos.continenteAero[i]);
                sb.append("}");
            }
            sb.append("]");
            return ok(sb.toString());
        } catch (Exception e) {
            return error(500, "CARGA_ERROR", e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /api/vuelos
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Devuelve la lista de vuelos cargados desde el archivo.
     */
    @GetMapping("/vuelos")
    public ResponseEntity<String> vuelos() {
        try {
            GestorDatos datos = new GestorDatos();
            datos.cargarAeropuertos(props.getRutaAeropuertos());
            datos.cargarVuelos(props.getRutaVuelos());

            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < datos.numVuelos; i++) {
                if (i > 0) sb.append(',');
                sb.append("{");
                sb.append("\"id\":").append(i).append(',');
                sb.append("\"origen\":\"").append(datos.iataAeropuerto[datos.vueloOrigen[i]]).append("\",");
                sb.append("\"destino\":\"").append(datos.iataAeropuerto[datos.vueloDestino[i]]).append("\",");
                sb.append("\"salidaUTC\":").append(datos.vueloSalidaUTC[i]).append(',');
                sb.append("\"llegadaUTC\":").append(datos.vueloLlegadaUTC[i]).append(',');
                sb.append("\"capacidad\":").append(datos.vueloCapacidad[i]);
                sb.append("}");
            }
            sb.append("]");
            return ok(sb.toString());
        } catch (Exception e) {
            return error(500, "CARGA_ERROR", e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Health check
    // ═══════════════════════════════════════════════════════════════════════════

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ok("{\"status\":\"ok\",\"service\":\"planificador-gvns\"}");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Lógica del job (corre en hilo separado)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Ejecuta el job completo:
     * <ol>
     *   <li>Warm-up: planificar (greedy, sin GVNS) cada día desde el inicio del
     *       dataset hasta {@code fechaIniUTC} exclusive. Esto simula el estado
     *       acumulado de la red antes del periodo visible.</li>
     *   <li>Plan real: {@code planificarConRutas} para {@code numDias} días
     *       desde {@code fechaIniUTC}.</li>
     * </ol>
     */
    private void ejecutarJob(JobStore.Job job,
                              long datasetIniUTC, long fechaIniUTC,
                              int numDias, CriterioOrden criterio, long semilla) {
        try {
            PlanificadorService svc = new PlanificadorService(
                    props.getRutaAeropuertos(),
                    props.getRutaVuelos(),
                    props.getRutaEnvios());

            // ── Warm-up ────────────────────────────────────────────────────
            long diasWarmup  = (fechaIniUTC - datasetIniUTC) / 1440L;
            long diasTotales = diasWarmup + numDias;

            if (diasWarmup < 0) diasWarmup = 0;

            for (long d = 0; d < diasWarmup; d++) {
                long dIni = datasetIniUTC + d * 1440L;
                job.mensaje  = "Warm-up: calculando día " + (d + 1) + " de " + diasWarmup;
                job.progreso = (int) (d * 70 / Math.max(diasTotales, 1));

                // Greedy sin GVNS — solo para construir el "estado pasado"
                svc.planificarDia(dIni, criterio, semilla, false);
            }

            // ── Planificación real del periodo visible ─────────────────────
            job.mensaje  = "Planificando periodo: " + numDias + " día(s)...";
            job.progreso = (int) (diasWarmup * 70 / Math.max(diasTotales, 1));

            long ventanaFin = fechaIniUTC + numDias * 1440L;

            // Meta (métricas)
            ResultadoPlanificacion meta = svc.planificarVentana(
                    fechaIniUTC, ventanaFin, criterio, semilla, false);

            job.progreso = 85;
            job.mensaje  = "Construyendo rutas completas...";

            // Rutas completas para el Ejecutor
            List<EnvioAsignado> envios = svc.planificarConRutas(
                    fechaIniUTC, ventanaFin, criterio, semilla);

            job.progreso = 95;
            job.mensaje  = "Serializando resultado...";

            job.resultadoJson = PlanificadorService.serializarPlanJSON(envios, meta);
            job.progreso      = 100;
            job.mensaje       = "Completado. " + meta.exitosos + "/" + meta.totalEnvios + " envíos asignados.";
            job.estado        = JobStore.Estado.COMPLETADO;

        } catch (Exception e) {
            job.errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            job.estado   = JobStore.Estado.ERROR;
            job.mensaje  = "Error: " + job.errorMsg;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parsea "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM" → [anio, mes, dia, hora, minuto].
     * Si no se incluye la parte de tiempo se asume 00:00.
     */
    private static int[] parsearFechaISO(String iso) {
        // Separar parte de fecha y hora opcional
        int hora = 0, minuto = 0;
        String fechaParte = iso;
        if (iso.length() >= 16 && iso.charAt(10) == 'T') {
            fechaParte = iso.substring(0, 10);
            String[] hm = iso.substring(11, 16).split(":");
            hora   = Integer.parseInt(hm[0]);
            minuto = Integer.parseInt(hm[1]);
        }
        String[] p = fechaParte.split("-");
        if (p.length != 3) throw new IllegalArgumentException("Formato inválido: " + iso);
        return new int[]{
            Integer.parseInt(p[0]),
            Integer.parseInt(p[1]),
            Integer.parseInt(p[2]),
            hora,
            minuto
        };
    }

    /** Escapa caracteres especiales JSON en un String. */
    private static String escapar(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static ResponseEntity<String> ok(String json) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(json);
    }

    private static ResponseEntity<String> error(int status, String codigo, String mensaje) {
        String body = "{\"error\":\"" + codigo + "\",\"mensaje\":\"" + escapar(mensaje) + "\"}";
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body);
    }
}
