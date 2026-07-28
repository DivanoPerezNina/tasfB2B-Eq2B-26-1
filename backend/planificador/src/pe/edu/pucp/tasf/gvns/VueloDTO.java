package pe.edu.pucp.tasf.gvns;

/**
 * Ruta tal como llega en el body de {@code POST /api/planificacion/desde-datos}.
 *
 * <p>Existe para el escenario Día a Día, donde las rutas salen de la tabla
 * {@code vuelos_operacion} (vía el servicio Consultas) en vez del archivo
 * {@code vuelos.txt}. Periodo y Colapso no mandan este campo y siguen leyendo
 * el archivo — ver {@link GestorDatos#cargarVuelosDesdeLista}.
 *
 * <p>{@code salida} y {@code llegada} son minutos desde 00:00 en hora LOCAL
 * del origen y del destino respectivamente, igual que en el archivo; la
 * conversión a UTC la hace {@code GestorDatos} con el gmt_offset de cada
 * aeropuerto.
 */
public record VueloDTO(
        long id,
        String origen,
        String destino,
        int salida,
        int llegada,
        int capacidad) {

    public VueloDTO(String origen, String destino, int salida, int llegada, int capacidad) {
        this(0L, origen, destino, salida, llegada, capacidad);
    }
}
