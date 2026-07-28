package pe.edu.pucp.tasf.gvns;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fachada del motor de planificación GVNS para uso en aplicaciones web.
 *
 * <p>Reemplaza a {@link Main} como punto de entrada cuando el motor se
 * integra como módulo dentro de un monolito (ej. servlet en Tomcat).
 * No tiene estado estático: cada instancia gestiona su propia red y
 * puede ser inyectada por un contenedor IoC o instanciada manualmente.
 *
 * <h3>Uso típico desde un servlet o controlador:</h3>
 * <pre>{@code
 * PlanificadorService svc = new PlanificadorService(
 *     "/data/aeropuertos.txt",
 *     "/data/vuelos.txt",
 *     "/data/_envios_preliminar_"
 * );
 *
 * // Planificar el día 2026-08-18 con criterio EDF
 * long ini = GestorDatos.calcularEpochMinutos(2026, 8, 18, 0, 0, 0);
 * ResultadoPlanificacion r = svc.planificarDia(ini, CriterioOrden.EDF, 42L, true);
 * response.getWriter().println(r);
 * }</pre>
 *
 * <p><b>Hilo de seguridad:</b> {@code planificarDia} y {@code planificarVentana}
 * crean un {@link GestorDatos} y un {@link PlanificadorGVNSConcurrente} nuevos
 * en cada llamada, por lo que la instancia es segura para uso concurrente.
 */
public class PlanificadorService {

    private final String rutaAeropuertos;
    private final String rutaVuelos;
    private final String rutaEnvios;

    /**
     * @param rutaAeropuertos ruta absoluta o relativa al archivo aeropuertos.txt
     * @param rutaVuelos      ruta absoluta o relativa al archivo vuelos.txt
     * @param rutaEnvios      ruta al directorio _envios_preliminar_ (sin barra final)
     */
    public PlanificadorService(String rutaAeropuertos,
                               String rutaVuelos,
                               String rutaEnvios) {
        this.rutaAeropuertos = rutaAeropuertos;
        this.rutaVuelos      = rutaVuelos;
        this.rutaEnvios      = rutaEnvios;
    }

    // ── API principal ─────────────────────────────────────────────────────────

    /**
     * Planifica todos los envíos registrados en una ventana de 24 horas.
     *
     * @param ventanaIniUTC minuto UTC absoluto de inicio del día
     *                      (usar {@link GestorDatos#calcularEpochMinutos})
     * @param criterio      estrategia de ordenamiento de la Fase 2
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @param validar       {@code true} para ejecutar el validador de invariantes
     * @return resultado inmutable con métricas de la planificación
     */
    public ResultadoPlanificacion planificarDia(long ventanaIniUTC,
                                               CriterioOrden criterio,
                                               long semilla,
                                               boolean validar) {
        return planificarVentana(ventanaIniUTC, ventanaIniUTC + 1440L,
                                 criterio, semilla, validar);
    }

    /**
     * Planifica todos los envíos registrados en una ventana arbitraria.
     *
     * @param ventanaIniUTC minuto UTC de inicio (inclusivo)
     * @param ventanaFinUTC minuto UTC de fin (exclusivo)
     * @param criterio      estrategia de ordenamiento de la Fase 2
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @param validar       {@code true} para ejecutar el validador de invariantes
     * @return resultado inmutable con métricas de la planificación
     */
    public ResultadoPlanificacion planificarVentana(long ventanaIniUTC,
                                                    long ventanaFinUTC,
                                                    CriterioOrden criterio,
                                                    long semilla,
                                                    boolean validar) {
        // ── Cargar red ────────────────────────────────────────────────────────
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarTodosLosEnvios(rutaEnvios, ventanaIniUTC, ventanaFinUTC);

        int totalEnvios = datos.numEnvios;
        if (totalEnvios == 0) {
            return vacio(ventanaIniUTC, ventanaFinUTC, criterio);
        }

        // ── Fase 2: construcción greedy ───────────────────────────────────────
        PlanificadorGVNSConcurrente plan =
                new PlanificadorGVNSConcurrente(datos, semilla, criterio);

        long t0 = System.currentTimeMillis();
        plan.construirSolucionInicial();
        double tFase2 = (System.currentTimeMillis() - t0) / 1000.0;

        int exitososF2 = plan.enviosExitosos.get();

        // ── Fase 3: GVNS (solo si hay rechazados) ────────────────────────────
        long t1 = System.currentTimeMillis();
        int iterMejoras = 0;
        if (exitososF2 < totalEnvios) {
            iterMejoras = plan.ejecutarMejoraGVNS();
        }
        double tFase3 = (System.currentTimeMillis() - t1) / 1000.0;

        int exitososF3 = plan.enviosExitosos.get();

        // ── Distribución por tramos ───────────────────────────────────────────
        int directas = 0, una = 0, dos = 0;
        for (int e = 0; e < totalEnvios; e++) {
            if (plan.solucionVuelos[e][0] == -1) continue;
            int tramos = 0;
            for (int s = 0; s < plan.MAX_SALTOS; s++)
                if (plan.solucionVuelos[e][s] != -1) tramos++;
            if      (tramos == 1) directas++;
            else if (tramos == 2) una++;
            else if (tramos == 3) dos++;
        }

        // ── Validar invariantes (opcional) ────────────────────────────────────
        boolean valida = !validar || AnalizadorRed.validarSolucion(plan, datos);

        return new ResultadoPlanificacion(
                ventanaIniUTC, ventanaFinUTC, criterio,
                totalEnvios,
                exitososF3,
                totalEnvios - exitososF3,
                exitososF3 - exitososF2,
                plan.calcularTransitoTotal(),
                directas, una, dos,
                tFase2, tFase3, iterMejoras,
                valida);
    }

    // ── API extendida: rutas completas para el Ejecutor ──────────────────────

    /**
     * Planifica una ventana y devuelve la lista completa de envíos con sus
     * rutas asignadas. A diferencia de {@link #planificarVentana}, este método
     * retorna los detalles por envío que el Ejecutor necesita para simular
     * el movimiento tick a tick.
     *
     * @param ventanaIniUTC minuto UTC de inicio (inclusivo)
     * @param ventanaFinUTC minuto UTC de fin (exclusivo)
     * @param criterio      estrategia de ordenamiento
     * @param semilla       semilla aleatoria (solo aplica a ALEATORIO)
     * @return lista de envíos con estado y tramos; nunca null
     */
    public List<EnvioAsignado> planificarConRutas(long ventanaIniUTC,
                                                   long ventanaFinUTC,
                                                   CriterioOrden criterio,
                                                   long semilla) {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarTodosLosEnvios(rutaEnvios, ventanaIniUTC, ventanaFinUTC);
        return construirRutas(datos, criterio, semilla);
    }

    /**
     * Igual que {@link #planificarConRutas} pero los envíos vienen en una LISTA
     * (consultados de la BD por el servicio de Consultas) en vez de leerse de
     * archivos. Java no toca disco ni BD para los envíos → menos RAM/IO.
     */
    public List<EnvioAsignado> planificarConRutasDesdeLista(
            List<EnvioDTO> envios, CriterioOrden criterio, long semilla) {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        datos.cargarVuelos(rutaVuelos);
        datos.cargarEnviosDesdeArray(envios);
        return construirRutas(datos, criterio, semilla);
    }

    /** Corre el GVNS sobre datos ya cargados (Fase 2 + GVNS si quedan rechazos). */
    private static PlanificadorGVNSConcurrente correrSolver(GestorDatos datos,
                                                            CriterioOrden criterio, long semilla,
                                                            java.util.Set<Long> diasCancelados) {
        PlanificadorGVNSConcurrente plan =
                new PlanificadorGVNSConcurrente(datos, semilla, criterio);
        plan.setDiasCancelados(diasCancelados);
        plan.construirSolucionInicial();
        if (plan.enviosExitosos.get() < datos.numEnvios) {
            plan.ejecutarMejoraGVNS();
        }
        return plan;
    }

    /** Construye el {@link EnvioAsignado} del envío {@code e} a partir de la solución del solver. */
    static EnvioAsignado construirUno(GestorDatos datos, PlanificadorGVNSConcurrente plan, int e) {
        String origen  = datos.iataAeropuerto[datos.envioOrigen[e]];
        String destino = datos.iataAeropuerto[datos.envioDestino[e]];
        long   regUTC  = datos.envioRegistroUTC[e];
        long   dlUTC   = datos.envioDeadlineUTC[e];

        if (plan.solucionVuelos[e][0] == -1) {
            return new EnvioAsignado(e, origen, destino, datos.envioMaletas[e],
                    regUTC, dlUTC, "Rechazado", new ArrayList<>());
        }

        List<EnvioAsignado.Tramo> tramos = new ArrayList<>(3);
        for (int s = 0; s < plan.MAX_SALTOS; s++) {
            int v = plan.solucionVuelos[e][s];
            if (v == -1) break;

            long salida  = plan.solucionDias[e][s];
            long durMin  = datos.vueloLlegadaUTC[v] - datos.vueloSalidaUTC[v];
            if (durMin < 0) durMin += 1440;
            long llegada = salida + durMin;

            tramos.add(new EnvioAsignado.Tramo(
                    v,
                    datos.iataAeropuerto[datos.vueloOrigen[v]],
                    datos.iataAeropuerto[datos.vueloDestino[v]],
                    salida, llegada));
        }
        return new EnvioAsignado(e, origen, destino, datos.envioMaletas[e],
                regUTC, dlUTC, "Exitoso", tramos);
    }

    /** Corre el GVNS sobre datos ya cargados y construye la lista de rutas. */
    private List<EnvioAsignado> construirRutas(GestorDatos datos,
                                               CriterioOrden criterio, long semilla) {
        int total = datos.numEnvios;
        List<EnvioAsignado> resultado = new ArrayList<>(total);
        if (total == 0) return resultado;

        PlanificadorGVNSConcurrente plan = correrSolver(datos, criterio, semilla, null);
        for (int e = 0; e < total; e++) {
            resultado.add(construirUno(datos, plan, e));
        }
        return resultado;
    }

    /**
     * Serializa la lista de EnvioAsignado a JSON sin dependencias externas.
     * Útil para devolver el plan completo como respuesta HTTP desde el
     * Spring Boot wrapper.
     *
     * @param envios            lista devuelta por {@link #planificarConRutas}
     * @param meta              ResultadoPlanificacion para el bloque "resumen"
     * @param observacionIniUTC minuto UTC donde arranca la simulación VISIBLE en
     *                          tiempo real. Con warm-up es mayor que
     *                          {@code meta.ventanaIniUTC} (el tramo previo es el
     *                          pre-roll que el Ejecutor reproduce acelerado).
     * @return cadena JSON
     */
    public static String serializarPlanJSON(List<EnvioAsignado> envios,
                                             ResultadoPlanificacion meta,
                                             long observacionIniUTC,
                                             Map<String, Integer> capacidades) {
        StringBuilder sb = new StringBuilder(envios.size() * 200);
        try {
            serializarPlanJSON(sb, envios, meta, observacionIniUTC, capacidades);
        } catch (IOException e) {
            throw new UncheckedIOException(e); // StringBuilder no lanza IOException
        }
        return sb.toString();
    }

    /**
     * Igual que {@link #serializarPlanJSON(List, ResultadoPlanificacion, long, Map)}
     * pero escribe el plan a un {@link Appendable} (ej. el {@code Writer} de la
     * respuesta HTTP) en vez de materializar un String. A horizontes grandes el
     * String del plan completo + su copia en {@code toString()} eran ~1 GB de pico
     * transitorio; escribirlo en streaming los elimina. El JSON es byte-idéntico.
     */
    public static void serializarPlanJSON(Appendable out,
                                          List<EnvioAsignado> envios,
                                          ResultadoPlanificacion meta,
                                          long observacionIniUTC,
                                          Map<String, Integer> capacidades) throws IOException {
        appendCabecera(out, meta, observacionIniUTC, capacidades);
        for (int i = 0; i < envios.size(); i++) {
            if (i > 0) out.append(',');
            envios.get(i).appendJSON(out);
        }
        out.append("]}");
    }

    /** Escribe {@code {"resumen":{...},"aeropuertos":[...],"envios":[} — sin cerrar el array. */
    private static void appendCabecera(Appendable out, ResultadoPlanificacion meta,
                                       long observacionIniUTC,
                                       Map<String, Integer> capacidades) throws IOException {
        out.append("{\"resumen\":{");
        out.append("\"totalEnvios\":").append(Integer.toString(meta.totalEnvios));
        out.append(",\"exitosos\":").append(Integer.toString(meta.exitosos));
        out.append(",\"rechazados\":").append(Integer.toString(meta.rechazados));
        out.append(",\"salvadosPorGVNS\":").append(Integer.toString(meta.salvadosPorGVNS));
        out.append(",\"tasaExito\":").append(String.format("%.4f", meta.tasaExito));
        out.append(",\"tiempoFase2Seg\":").append(String.format("%.3f", meta.tiempoFase2Seg));
        out.append(",\"tiempoFase3Seg\":").append(String.format("%.3f", meta.tiempoFase3Seg));
        out.append(",\"ventanaIniUTC\":").append(Long.toString(meta.ventanaIniUTC));
        out.append(",\"ventanaFinUTC\":").append(Long.toString(meta.ventanaFinUTC));
        out.append(",\"observacionIniUTC\":").append(Long.toString(observacionIniUTC));
        out.append("},");

        // Capacidades reales de almacén por aeropuerto (para que el Ejecutor
        // calcule ocupación y semáforo contra el valor correcto, no un default).
        out.append("\"aeropuertos\":[");
        if (capacidades != null) {
            boolean first = true;
            for (Map.Entry<String, Integer> e : capacidades.entrySet()) {
                if (!first) out.append(',');
                first = false;
                out.append("{\"iata\":\"").append(e.getKey())
                   .append("\",\"capacidad\":").append(Integer.toString(e.getValue())).append('}');
            }
        }
        out.append("],");
        out.append("\"envios\":[");
    }

    /**
     * Planifica desde una lista de envíos y escribe el plan en streaming al
     * {@code out}, <b>sin materializar la lista de {@link EnvioAsignado}</b>: cada
     * envío se construye, se serializa y se descarta. A horizontes grandes esa
     * lista era ~600 MB; eliminarla (junto al String del plan, ya en streaming)
     * baja el pico de heap lo suficiente para alcanzar volúmenes mayores antes del
     * colapso. El JSON es byte-idéntico al de {@link #serializarPlanJSON}.
     */
    public void planificarYStreamDesdeLista(List<EnvioDTO> envios, CriterioOrden criterio,
                                            long semilla, long iniUTC, long finUTC,
                                            long observacionIniUTC, List<CancelacionDTO> cancelados,
                                            Appendable out) throws IOException {
        planificarYStreamDesdeLista(envios, criterio, semilla, iniUTC, finUTC,
                observacionIniUTC, cancelados, null, out);
    }

    /**
     * Variante que recibe también las RUTAS en el body (escenario Día a Día,
     * tabla {@code vuelos_operacion}). Si {@code vuelos} es null o vacío se cae
     * al archivo {@code vuelos.txt} — que es lo que hacen Periodo y Colapso,
     * cuyo comportamiento no cambia.
     */
    public void planificarYStreamDesdeLista(List<EnvioDTO> envios, CriterioOrden criterio,
                                            long semilla, long iniUTC, long finUTC,
                                            long observacionIniUTC, List<CancelacionDTO> cancelados,
                                            List<VueloDTO> vuelos,
                                            Appendable out) throws IOException {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        if (vuelos != null && !vuelos.isEmpty()) {
            datos.cargarVuelosDesdeLista(vuelos);
        } else {
            datos.cargarVuelos(rutaVuelos);
        }
        datos.cargarEnviosDesdeArray(envios);

        java.util.Set<Long> diasCancelados = clavesCanceladas(datos, cancelados);
        int total = datos.numEnvios;
        Map<String, Integer> caps = capacidadesDe(datos);

        if (total == 0) {
            ResultadoPlanificacion meta = new ResultadoPlanificacion(
                    iniUTC, finUTC, criterio, 0, 0, 0, 0, 0L, 0, 0, 0, 0.0, 0.0, 0, true);
            appendCabecera(out, meta, observacionIniUTC, caps);
            out.append("]}");
            return;
        }

        PlanificadorGVNSConcurrente plan = correrSolver(datos, criterio, semilla, diasCancelados);

        // Pasada 1: contar exitosos generados por GVNS.
        int exitososGVNS = 0;
        for (int e = 0; e < total; e++) {
            if (plan.solucionVuelos[e][0] != -1) exitososGVNS++;
        }

        // Día a Día manda la lista de vuelos_operacion en el body. Para este modo
        // operativo no se debe quedar iterando indefinidamente ni devolver
        // plan-tramos [] si existe una ruta factible. Mantenemos GVNS: primero se
        // ejecuta la solución inicial + mejora; solo si GVNS no logra asignar todos
        // los envíos se activa un respaldo factible que usa la misma red, capacidad,
        // horarios UTC y cancelaciones. Periodo/Colapso NO cambian.
        boolean modoOperacion = vuelos != null && !vuelos.isEmpty();
        List<EnvioAsignado> salidaOperativa = null;
        int exitososFinal = exitososGVNS;

        if (modoOperacion) {
            // En Día a Día mantenemos GVNS para construir/evaluar la solución,
            // pero la salida que consume el mapa debe ser determinística y debe
            // respetar inmediatamente las cancelaciones. Por eso reconstruimos el
            // plan operativo sobre la misma red/capacidad/cancelados, eligiendo la
            // salida factible más temprana. Esto evita que, tras cancelar un vuelo,
            // el mapa siga recibiendo la ruta anterior aunque haya una salida de
            // respaldo disponible.
            salidaOperativa = construirPlanOperativoConRespaldo(datos, plan, diasCancelados);
            int exitososFallback = contarExitosos(salidaOperativa);
            if (exitososFallback >= exitososGVNS) {
                exitososFinal = exitososFallback;
                System.out.printf(
                        "Día a Día: GVNS=%d/%d; operativo=%d/%d; se devuelve plan operativo determinístico.%n",
                        exitososGVNS, total, exitososFallback, total);
            } else {
                salidaOperativa = null;
            }
        }

        // meta espejo de metaDesdeEnvios: salvados/tiempos en 0 (no se serializan los demás).
        ResultadoPlanificacion meta = new ResultadoPlanificacion(
                iniUTC, finUTC, criterio, total, exitososFinal, total - exitososFinal, 0,
                0L, 0, 0, 0, 0.0, 0.0, 0, true);

        // Pasada 2: escribir cada envío sin retener planes enormes. En Día a Día,
        // si hubo fallback se serializa esa solución; si no, se serializa GVNS puro.
        appendCabecera(out, meta, observacionIniUTC, caps);
        if (salidaOperativa != null) {
            for (int e = 0; e < salidaOperativa.size(); e++) {
                if (e > 0) out.append(',');
                salidaOperativa.get(e).appendJSON(out);
            }
        } else {
            for (int e = 0; e < total; e++) {
                if (e > 0) out.append(',');
                construirUno(datos, plan, e).appendJSON(out);
            }
        }
        out.append("]}");
    }


    // ── Respaldo operativo para Día a Día ───────────────────────────────────

    private static int contarExitosos(List<EnvioAsignado> envios) {
        int n = 0;
        if (envios == null) return 0;
        for (EnvioAsignado e : envios) {
            if (e != null && "Exitoso".equals(e.estado) && !e.tramos.isEmpty()) n++;
        }
        return n;
    }

    /**
     * Construye una solución factible rápida para Operaciones Día a Día cuando
     * GVNS no consigue devolver tramos. No reemplaza al GVNS: se ejecuta después
     * de GVNS y solo como respaldo para no dejar el mapa sin plan si existe una
     * ruta válida en vuelos_operacion.
     */
    private static List<EnvioAsignado> construirPlanOperativoConRespaldo(
            GestorDatos datos,
            PlanificadorGVNSConcurrente plan,
            java.util.Set<Long> diasCancelados) {

        List<EnvioAsignado> res = new ArrayList<>(datos.numEnvios);
        Map<Long, Integer> ocupacion = new HashMap<>();

        for (int e = 0; e < datos.numEnvios; e++) {
            EnvioAsignado asignado = buscarRutaOperativa(datos, e, ocupacion, diasCancelados);
            if (asignado == null && plan != null && plan.solucionVuelos[e][0] != -1) {
                // Si GVNS sí resolvió este envío, preservamos su resultado.
                asignado = construirUno(datos, plan, e);
            }
            if (asignado == null) {
                asignado = new EnvioAsignado(
                        e,
                        datos.iataAeropuerto[datos.envioOrigen[e]],
                        datos.iataAeropuerto[datos.envioDestino[e]],
                        datos.envioMaletas[e],
                        datos.envioRegistroUTC[e],
                        datos.envioDeadlineUTC[e],
                        "Rechazado",
                        new ArrayList<>());
            }
            res.add(asignado);
        }
        return res;
    }

    private static EnvioAsignado buscarRutaOperativa(GestorDatos datos, int e,
                                                      Map<Long, Integer> ocupacion,
                                                      java.util.Set<Long> cancelados) {
        int origen = datos.envioOrigen[e];
        int destino = datos.envioDestino[e];
        int maletas = datos.envioMaletas[e];
        long registro = datos.envioRegistroUTC[e];
        long deadline = datos.envioDeadlineUTC[e];

        // 1) Directo
        for (int v = 0; v < datos.numVuelos; v++) {
            if (datos.vueloOrigen[v] != origen || datos.vueloDestino[v] != destino) continue;
            long sal = proximaSalida(registro, datos.vueloSalidaUTC[v]);
            long lle = sal + duracion(datos, v);
            if (lle > deadline) continue;
            if (!reservarOperativo(datos, v, sal, maletas, ocupacion, cancelados)) continue;
            return envioOperativo(datos, e, tramo(datos, v, sal));
        }

        // 2) Una escala
        for (int v1 = 0; v1 < datos.numVuelos; v1++) {
            if (datos.vueloOrigen[v1] != origen) continue;
            int escala = datos.vueloDestino[v1];
            if (escala == destino || escala == origen) continue;

            long sal1 = proximaSalida(registro, datos.vueloSalidaUTC[v1]);
            long lle1 = sal1 + duracion(datos, v1);
            if (lle1 + 10 > deadline) continue;
            if (!reservarOperativo(datos, v1, sal1, maletas, ocupacion, cancelados)) continue;

            for (int v2 = 0; v2 < datos.numVuelos; v2++) {
                if (datos.vueloOrigen[v2] != escala || datos.vueloDestino[v2] != destino) continue;
                long sal2 = proximaSalida(lle1 + 10, datos.vueloSalidaUTC[v2]);
                long lle2 = sal2 + duracion(datos, v2);
                if (lle2 > deadline) continue;
                if (!reservarOperativo(datos, v2, sal2, maletas, ocupacion, cancelados)) continue;
                return envioOperativo(datos, e, tramo(datos, v1, sal1), tramo(datos, v2, sal2));
            }
            liberarOperativo(v1, sal1, maletas, ocupacion);
        }

        // 3) Dos escalas
        for (int v1 = 0; v1 < datos.numVuelos; v1++) {
            if (datos.vueloOrigen[v1] != origen) continue;
            int escala1 = datos.vueloDestino[v1];
            if (escala1 == origen || escala1 == destino) continue;

            long sal1 = proximaSalida(registro, datos.vueloSalidaUTC[v1]);
            long lle1 = sal1 + duracion(datos, v1);
            if (lle1 + 10 > deadline) continue;
            if (!reservarOperativo(datos, v1, sal1, maletas, ocupacion, cancelados)) continue;

            boolean resolvio = false;
            for (int v2 = 0; v2 < datos.numVuelos && !resolvio; v2++) {
                if (datos.vueloOrigen[v2] != escala1) continue;
                int escala2 = datos.vueloDestino[v2];
                if (escala2 == origen || escala2 == escala1 || escala2 == destino) continue;

                long sal2 = proximaSalida(lle1 + 10, datos.vueloSalidaUTC[v2]);
                long lle2 = sal2 + duracion(datos, v2);
                if (lle2 + 10 > deadline) continue;
                if (!reservarOperativo(datos, v2, sal2, maletas, ocupacion, cancelados)) continue;

                for (int v3 = 0; v3 < datos.numVuelos; v3++) {
                    if (datos.vueloOrigen[v3] != escala2 || datos.vueloDestino[v3] != destino) continue;
                    long sal3 = proximaSalida(lle2 + 10, datos.vueloSalidaUTC[v3]);
                    long lle3 = sal3 + duracion(datos, v3);
                    if (lle3 > deadline) continue;
                    if (!reservarOperativo(datos, v3, sal3, maletas, ocupacion, cancelados)) continue;
                    return envioOperativo(datos, e,
                            tramo(datos, v1, sal1), tramo(datos, v2, sal2), tramo(datos, v3, sal3));
                }
                liberarOperativo(v2, sal2, maletas, ocupacion);
            }
            liberarOperativo(v1, sal1, maletas, ocupacion);
        }

        return null;
    }

    private static EnvioAsignado envioOperativo(GestorDatos datos, int e, EnvioAsignado.Tramo... tramos) {
        List<EnvioAsignado.Tramo> lista = new ArrayList<>(tramos.length);
        for (EnvioAsignado.Tramo t : tramos) lista.add(t);
        return new EnvioAsignado(
                e,
                datos.iataAeropuerto[datos.envioOrigen[e]],
                datos.iataAeropuerto[datos.envioDestino[e]],
                datos.envioMaletas[e],
                datos.envioRegistroUTC[e],
                datos.envioDeadlineUTC[e],
                "Exitoso",
                lista);
    }

    private static EnvioAsignado.Tramo tramo(GestorDatos datos, int v, long salida) {
        return new EnvioAsignado.Tramo(
                v,
                datos.iataAeropuerto[datos.vueloOrigen[v]],
                datos.iataAeropuerto[datos.vueloDestino[v]],
                salida,
                salida + duracion(datos, v));
    }

    private static long duracion(GestorDatos datos, int v) {
        long dur = datos.vueloLlegadaUTC[v] - datos.vueloSalidaUTC[v];
        return dur < 0 ? dur + 1440 : dur;
    }

    private static long proximaSalida(long desdeUTC, int salidaDiaUTC) {
        long minDelDia = Math.floorMod(desdeUTC, 1440L);
        long diaAbs = Math.floorDiv(desdeUTC, 1440L);
        return (minDelDia <= salidaDiaUTC)
                ? diaAbs * 1440L + salidaDiaUTC
                : (diaAbs + 1L) * 1440L + salidaDiaUTC;
    }

    private static boolean reservarOperativo(GestorDatos datos, int v, long salida, int maletas,
                                             Map<Long, Integer> ocupacion,
                                             java.util.Set<Long> cancelados) {
        long key = PlanificadorGVNSConcurrente.claveVueloDia(v, salida);
        if (cancelados != null && cancelados.contains(key)) return false;
        int actual = ocupacion.getOrDefault(key, 0);
        if (actual + maletas > datos.vueloCapacidad[v]) return false;
        ocupacion.put(key, actual + maletas);
        return true;
    }

    private static void liberarOperativo(int v, long salida, int maletas, Map<Long, Integer> ocupacion) {
        long key = PlanificadorGVNSConcurrente.claveVueloDia(v, salida);
        int actual = ocupacion.getOrDefault(key, 0) - maletas;
        if (actual <= 0) ocupacion.remove(key);
        else ocupacion.put(key, actual);
    }

    /**
     * Traduce las cancelaciones (origen, destino, salidaUTC) a claves
     * {@code claveVueloDia} para el solver, resolviendo la ruta al {@code vueloIdx}
     * interno del planificador.
     *
     * <p>Empareja por ruta (origen→destino) y minuto de salida UTC del día
     * (con tolerancia de ±2 min por redondeo). El día de la ocurrencia se toma de
     * {@code salidaUTC / 1440}. Las cancelaciones cuya ruta/horario no exista en el
     * catálogo se ignoran silenciosamente (el archivo de cancelaciones no se valida).
     */
    static java.util.Set<Long> clavesCanceladas(GestorDatos datos, List<CancelacionDTO> cancelados) {
        if (cancelados == null || cancelados.isEmpty()) return java.util.Collections.emptySet();

        java.util.Set<Long> claves = new java.util.HashSet<>(cancelados.size() * 2);
        for (CancelacionDTO c : cancelados) {
            if (c == null || c.origen() == null || c.destino() == null) continue;
            Integer oid = datos.mapaIataAId.get(c.origen());
            Integer did = datos.mapaIataAId.get(c.destino());
            if (oid == null || did == null) continue;

            int salDiaWanted = (int) (((c.salidaUTC() % 1440) + 1440) % 1440);
            for (int v = 0; v < datos.numVuelos; v++) {
                if (datos.vueloOrigen[v] != oid || datos.vueloDestino[v] != did) continue;
                int salDia = ((datos.vueloSalidaUTC[v] % 1440) + 1440) % 1440;
                if (Math.abs(salDia - salDiaWanted) <= 2) {
                    claves.add(PlanificadorGVNSConcurrente.claveVueloDia(v, c.salidaUTC()));
                }
            }
        }
        return claves;
    }

    /** Capacidades IATA → almacén a partir de un GestorDatos ya con aeropuertos cargados. */
    private static Map<String, Integer> capacidadesDe(GestorDatos datos) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (int i = 1; i <= datos.numAeropuertos; i++) {
            m.put(datos.iataAeropuerto[i], datos.capacidadAlmacen[i]);
        }
        return m;
    }

    /**
     * Devuelve un mapa IATA → capacidad de almacén leyendo el archivo de
     * aeropuertos (archivo pequeño; carga independiente y barata). Lo usa el
     * controlador para incluir las capacidades reales en el plan JSON.
     */
    public Map<String, Integer> capacidadesAlmacen() {
        GestorDatos datos = new GestorDatos();
        datos.cargarAeropuertos(rutaAeropuertos);
        Map<String, Integer> m = new LinkedHashMap<>();
        for (int i = 1; i <= datos.numAeropuertos; i++) {
            m.put(datos.iataAeropuerto[i], datos.capacidadAlmacen[i]);
        }
        return m;
    }

    /**
     * Construye el {@link ResultadoPlanificacion} (métricas del "resumen") a
     * partir de la lista de envíos ya planificada por {@link #planificarConRutas},
     * SIN volver a cargar archivos ni re-ejecutar el GVNS.
     *
     * <p>Antes el controlador llamaba {@code planificarVentana} (para las métricas)
     * y {@code planificarConRutas} (para las rutas) por separado: dos cargas de
     * archivos y dos corridas completas de GVNS por job. Este helper deriva las
     * métricas de la única corrida de {@code planificarConRutas}.
     */
    public static ResultadoPlanificacion metaDesdeEnvios(List<EnvioAsignado> envios,
                                                         long ventanaIniUTC,
                                                         long ventanaFinUTC,
                                                         CriterioOrden criterio) {
        int total = envios.size();
        int exitosos = 0, directas = 0, una = 0, dos = 0;
        long transito = 0;
        for (EnvioAsignado e : envios) {
            if (!"Exitoso".equals(e.estado) || e.tramos.isEmpty()) continue;
            exitosos++;
            int n = e.tramos.size();
            if      (n == 1) directas++;
            else if (n == 2) una++;
            else if (n >= 3) dos++;
            EnvioAsignado.Tramo ultimo = e.tramos.get(n - 1);
            transito += (ultimo.llegadaUTC - e.registroUTC);
        }
        return new ResultadoPlanificacion(
                ventanaIniUTC, ventanaFinUTC, criterio,
                total, exitosos, total - exitosos, 0,
                transito, directas, una, dos,
                0.0, 0.0, 0, true);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Resultado vacío cuando no hay envíos en la ventana. */
    private static ResultadoPlanificacion vacio(long ini, long fin,
                                                CriterioOrden criterio) {
        return new ResultadoPlanificacion(ini, fin, criterio,
                0, 0, 0, 0, 0L, 0, 0, 0, 0.0, 0.0, 0, true);
    }
}
