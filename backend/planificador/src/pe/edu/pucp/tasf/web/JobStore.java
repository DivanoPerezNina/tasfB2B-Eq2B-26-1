package pe.edu.pucp.tasf.web;

import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Almacén en memoria de jobs de planificación.
 *
 * <p>Cada llamada a {@code POST /api/planificacion/iniciar} crea un Job
 * que corre en un hilo separado. El cliente puede consultar el estado
 * con {@code GET /api/planificacion/status/{jobId}} y recuperar el
 * resultado con {@code GET /api/planificacion/resultado/{jobId}}.
 *
 * <p>Los jobs completados permanecen en memoria hasta que el servidor
 * se reinicia (suficiente para una sesión de lab).
 */
@Component
public class JobStore {

    public enum Estado { EN_PROCESO, COMPLETADO, ERROR }

    /** Estado observable de un job de planificación. */
    public static class Job {
        public final String  id;
        public volatile Estado  estado     = Estado.EN_PROCESO;
        public volatile int     progreso   = 0;   // 0-100
        public volatile String  mensaje    = "Iniciando...";
        /** JSON completo listo para devolver; solo válido si estado == COMPLETADO. */
        public volatile String  resultadoJson;
        /** Mensaje de error; solo válido si estado == ERROR. */
        public volatile String  errorMsg;

        Job(String id) { this.id = id; }
    }

    private final ConcurrentHashMap<String, Job> jobs = new ConcurrentHashMap<>();

    /** Crea un nuevo job y lo registra. Devuelve el job para que el caller lo rellene. */
    public Job crear() {
        String id  = UUID.randomUUID().toString();
        Job    job = new Job(id);
        jobs.put(id, job);
        return job;
    }

    /** Busca un job por ID. Devuelve null si no existe. */
    public Job obtener(String id) {
        return jobs.get(id);
    }
}
