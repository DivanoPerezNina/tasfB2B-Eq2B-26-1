package pe.edu.pucp.tasf.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;

import pe.edu.pucp.tasf.gvns.CancelacionDTO;
import pe.edu.pucp.tasf.gvns.CriterioOrden;
import pe.edu.pucp.tasf.gvns.EnvioAsignado;
import pe.edu.pucp.tasf.gvns.EnvioDTO;
import pe.edu.pucp.tasf.gvns.GestorDatos;
import pe.edu.pucp.tasf.gvns.PlanificadorService;
import pe.edu.pucp.tasf.gvns.ResultadoPlanificacion;
import pe.edu.pucp.tasf.gvns.VueloDTO;

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

        // warmUp: si true, se reconstruye el estado de la red desde el inicio del
        // dataset hasta la fecha elegida (procesa maletas pasadas). Si false (default),
        // tiempo=0 es la fecha elegida y SOLO se procesan maletas desde ese momento
        // en adelante — comportamiento requerido por el enunciado de Sim5D.
        boolean warmUp = body.containsKey("warmUp")
                && Boolean.TRUE.equals(body.get("warmUp"));

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
        final boolean       wUp    = warmUp;

        executor.submit(() -> ejecutarJob(job, dsIniUTC, fIniUTC, numDias, crit, sem, wUp));

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
    // POST /api/planificacion/benchmark
    // ───────────────────────────────────────────────────────────────────────────
    // Mide el TIEMPO DE EJECUCIÓN (Ta) del GVNS para una ventana de datos en
    // minutos UTC absolutos. SÍNCRONO (devuelve cuando termina). Lo usa el módulo
    // de experimentación para calibrar Ta/Sa/Sc/K — NO es parte del flujo normal.
    //
    // Body: { "iniUTC": 29691840, "finUTC": 29695200, "criterio": "EDF" }
    // Resp: { totalEnvios, exitosos, rechazados, taSeg, fase2Seg, fase3Seg }
    // ═══════════════════════════════════════════════════════════════════════════

    @PostMapping("/planificacion/benchmark")
    public ResponseEntity<String> benchmark(@RequestBody Map<String, Object> body) {
        if (body.get("iniUTC") == null || body.get("finUTC") == null) {
            return error(400, "PARAM_FALTANTE", "Se requieren 'iniUTC' y 'finUTC' (minutos UTC)");
        }
        long iniUTC = ((Number) body.get("iniUTC")).longValue();
        long finUTC = ((Number) body.get("finUTC")).longValue();
        if (finUTC <= iniUTC) {
            return error(400, "PARAM_INVALIDO", "finUTC debe ser mayor que iniUTC");
        }

        CriterioOrden criterio;
        try {
            String c = body.containsKey("criterio")
                    ? ((String) body.get("criterio")).toUpperCase()
                    : props.getCriterioDefault().toUpperCase();
            criterio = CriterioOrden.valueOf(c);
        } catch (IllegalArgumentException e) {
            return error(400, "CRITERIO_INVALIDO", "ALEATORIO | EDF | FIFO");
        }
        long semilla = body.containsKey("semilla") ? ((Number) body.get("semilla")).longValue() : 42L;

        PlanificadorService svc = new PlanificadorService(
                props.getRutaAeropuertos(), props.getRutaVuelos(), props.getRutaEnvios());

        // Ta = wall-time total de la planificación (carga de datos + GVNS), que es
        // lo que el orquestador realmente experimenta en cada bloque Sa.
        long t0 = System.nanoTime();
        ResultadoPlanificacion r = svc.planificarVentana(iniUTC, finUTC, criterio, semilla, false);
        double taSeg = (System.nanoTime() - t0) / 1e9;

        String json = "{"
                + "\"iniUTC\":" + iniUTC + ","
                + "\"finUTC\":" + finUTC + ","
                + "\"totalEnvios\":" + r.totalEnvios + ","
                + "\"exitosos\":" + r.exitosos + ","
                + "\"rechazados\":" + r.rechazados + ","
                + "\"taSeg\":" + String.format("%.4f", taSeg) + ","
                + "\"fase2Seg\":" + String.format("%.4f", r.tiempoFase2Seg) + ","
                + "\"fase3Seg\":" + String.format("%.4f", r.tiempoFase3Seg)
                + "}";
        return ok(json);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // POST /api/planificacion/desde-datos
    // ───────────────────────────────────────────────────────────────────────────
    // Planifica recibiendo los ENVÍOS en el body (consultados de la BD por el
    // servicio de Consultas en Go), sin leer archivos. SÍNCRONO: devuelve el
    // plan completo. Lo usará el orquestador del esquema Sa/Sc.
    //
    // Body: { "iniUTC":, "finUTC":, "observacionIniUTC":, "criterio":"EDF",
    //         "envios":[{"origen","destino","maletas","registroUTC","deadlineUTC"}, ...] }
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Body tipado de {@code desde-datos}. Jackson lo deserializa a un record de
     * campos primitivos (vía {@link EnvioDTO}) en vez de un {@code Map<String,Object>}
     * — evita el HashMap + boxing por envío que disparaba el OOM en ventanas grandes.
     */
    public record DesdeDatosRequest(
            Long iniUTC, Long finUTC, Long observacionIniUTC,
            String criterio, Long semilla,
            List<EnvioDTO> envios,
            List<CancelacionDTO> cancelados,
            /** Catálogo de rutas enviado por el Ejecutor. Puede provenir de
             *  vuelos_operacion (Día a Día) o vuelos (Periodo/Colapso). */
            List<VueloDTO> vuelos,
            /** Separa la estrategia operativa rápida del GVNS de Periodo. */
            Boolean modoOperacion) {
    }

    @PostMapping("/planificacion/desde-datos")
    public ResponseEntity<StreamingResponseBody> desdeDatos(@RequestBody DesdeDatosRequest req) {
        if (req == null || req.envios() == null) {
            return streamError(400, "PARAM_FALTANTE", "Se requiere 'envios' (lista)");
        }
        long ini = req.iniUTC() != null ? req.iniUTC() : 0L;
        long fin = req.finUTC() != null ? req.finUTC() : 0L;
        long obs = req.observacionIniUTC() != null ? req.observacionIniUTC() : ini;
        long semilla = req.semilla() != null ? req.semilla() : 42L;

        CriterioOrden criterio;
        try {
            String c = req.criterio() != null
                    ? req.criterio().toUpperCase()
                    : props.getCriterioDefault().toUpperCase();
            criterio = CriterioOrden.valueOf(c);
        } catch (IllegalArgumentException e) {
            return streamError(400, "CRITERIO_INVALIDO", "ALEATORIO | EDF | FIFO");
        }

        final PlanificadorService svc = new PlanificadorService(
                props.getRutaAeropuertos(), props.getRutaVuelos(), props.getRutaEnvios());
        final CriterioOrden crit = criterio;

        // Streaming directo desde el solver: ni lista de EnvioAsignado ni String
        // del plan en memoria (los dos mayores picos de heap a horizontes grandes).
        // El GVNS corre dentro del lambda; un OOM aquí trunca el body (el cliente lo
        // ve como EOF), igual que el comportamiento anterior ante falta de memoria.
        StreamingResponseBody body = os -> {
            try (Writer w = new BufferedWriter(new OutputStreamWriter(os, StandardCharsets.UTF_8))) {
                svc.planificarYStreamDesdeLista(req.envios(), crit, semilla, ini, fin, obs,
                        req.cancelados(), req.vuelos(), Boolean.TRUE.equals(req.modoOperacion()), w);
            }
        };
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }

    /** Error como cuerpo en streaming, para mantener el tipo de retorno del endpoint. */
    private static ResponseEntity<StreamingResponseBody> streamError(int status, String codigo, String mensaje) {
        String json = "{\"error\":\"" + codigo + "\",\"mensaje\":\"" + escapar(mensaje) + "\"}";
        StreamingResponseBody body = os -> os.write(json.getBytes(StandardCharsets.UTF_8));
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
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
     *   <li>Warm-up por <b>lookback</b> (opcional, solo si {@code warmUp == true}):
     *       en vez de replanificar día a día desde el inicio del dataset, se
     *       extiende la ventana de planificación hacia atrás {@code LOOKBACK_MIN}
     *       minutos (≈ viaje más largo posible). Así el plan incluye los envíos
     *       registrados justo antes de la fecha de observación que aún estarían
     *       en tránsito/almacén en ese instante.</li>
     *   <li>Plan: {@code planificarConRutas} sobre {@code [planIniUTC, ventanaFin)}.
     *       El campo {@code observacionIniUTC} del JSON marca el instante donde el
     *       Ejecutor arranca el tiempo real; el tramo previo es el pre-roll de
     *       warm-up que el Ejecutor reproduce a máxima velocidad. Con
     *       {@code warmUp == false}, {@code planIniUTC == fechaIniUTC} y no hay
     *       pre-roll (arranque en frío en la fecha elegida).</li>
     * </ol>
     */
    private void ejecutarJob(JobStore.Job job,
                              long datasetIniUTC, long fechaIniUTC,
                              int numDias, CriterioOrden criterio, long semilla,
                              boolean warmUp) {
        try {
            PlanificadorService svc = new PlanificadorService(
                    props.getRutaAeropuertos(),
                    props.getRutaVuelos(),
                    props.getRutaEnvios());

            // ── Warm-up por LOOKBACK (rápido) ───────────────────────────────
            // En lugar de replanificar día a día desde el inicio del dataset
            // (lento: cientos de días de GVNS), extendemos la ventana hacia
            // atrás unos pocos días — suficiente para cubrir el viaje más largo
            // posible. Así el plan incluye los envíos que YA estarían en tránsito
            // o en almacén en la fecha de observación; el Ejecutor reproduce ese
            // tramo previo a máxima velocidad para sembrar el estado de la red.
            final long LOOKBACK_MIN = 3L * 1440L; // 3 días (cubre el viaje más largo)
            long planIniUTC = fechaIniUTC;
            if (warmUp) {
                planIniUTC = fechaIniUTC - LOOKBACK_MIN;
                if (planIniUTC < datasetIniUTC) planIniUTC = datasetIniUTC;
            }

            long ventanaFin = fechaIniUTC + numDias * 1440L;

            // ── Planificación de la ventana (lookback + periodo visible) ────
            // UNA sola pasada: planificarConRutas carga los archivos y corre el
            // GVNS una vez; las métricas del resumen se derivan de su resultado
            // (antes se llamaba además planificarVentana, duplicando carga+GVNS).
            job.mensaje  = warmUp
                    ? "Planificando con warm-up (lookback de rutas)..."
                    : "Planificando periodo: " + numDias + " día(s)...";
            job.progreso = 30;

            // Rutas completas para el Ejecutor
            List<EnvioAsignado> envios = svc.planificarConRutas(
                    planIniUTC, ventanaFin, criterio, semilla);

            job.progreso = 90;
            job.mensaje  = "Serializando resultado...";

            // Métricas del resumen derivadas de la misma corrida.
            ResultadoPlanificacion meta = PlanificadorService.metaDesdeEnvios(
                    envios, planIniUTC, ventanaFin, criterio);

            // observacionIniUTC = fechaIniUTC: instante donde arranca el tiempo real.
            // capacidades = capacidad real de almacén por aeropuerto (para el Ejecutor).
            job.resultadoJson = PlanificadorService.serializarPlanJSON(
                    envios, meta, fechaIniUTC, svc.capacidadesAlmacen());
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
