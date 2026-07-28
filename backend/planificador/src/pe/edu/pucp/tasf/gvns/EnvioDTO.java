package pe.edu.pucp.tasf.gvns;

/**
 * Envío tal como llega en el body de {@code POST /api/planificacion/desde-datos}.
 *
 * <p>Reemplaza al {@code Map<String,Object>} que Jackson inflaba a un HashMap +
 * 5 objetos <i>boxed</i> por envío (~300-500 B/envío vs ~40 B de datos reales).
 * Con un record de campos primitivos el costo por envío baja a ~1×, clave para
 * que la ventana acumulativa quepa en el heap sin OOM.
 */
public record EnvioDTO(
        String origen,
        String destino,
        int    maletas,
        long   registroUTC,
        long   deadlineUTC,
        String origenActual,
        Long   disponibleDesdeUTC) {

    public EnvioDTO(String origen, String destino, int maletas,
                    long registroUTC, long deadlineUTC) {
        this(origen, destino, maletas, registroUTC, deadlineUTC, null, null);
    }
}
