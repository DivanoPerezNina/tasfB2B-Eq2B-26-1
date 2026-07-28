package pe.edu.pucp.tasf.gvns;

/**
 * Cancelación de una OCURRENCIA de vuelo (un (vuelo, día) concreto), tal como
 * llega en {@code POST /api/planificacion/desde-datos}.
 *
 * <p>Identifica el vuelo por su <b>ruta</b> ({@code origen}/{@code destino} en
 * IATA) y su minuto de salida UTC absoluto ({@code salidaUTC}), NO por un índice
 * interno: el índice del vuelo (vueloIdx) depende del orden de carga del archivo
 * del planificador y no es estable entre servicios (el frontend y la BD usan otro
 * id). El planificador resuelve la ruta a su {@code vueloIdx} interno y de ahí a
 * la clave {@link PlanificadorGVNSConcurrente#claveVueloDia}, saltando ese
 * (vuelo, día) en la planificación. Cancelar una ocurrencia NO afecta al mismo
 * vuelo en otros días.
 *
 * <p>El día de la ocurrencia se deriva de {@code salidaUTC / 1440}; el minuto del
 * día ({@code salidaUTC % 1440}) sirve para emparejar el vuelo en su horario UTC.
 */
public record CancelacionDTO(Long vueloId, String origen, String destino, long salidaUTC) {

    public CancelacionDTO(String origen, String destino, long salidaUTC) {
        this(null, origen, destino, salidaUTC);
    }
}
