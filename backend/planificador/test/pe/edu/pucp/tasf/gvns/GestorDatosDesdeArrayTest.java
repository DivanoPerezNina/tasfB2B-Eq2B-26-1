package pe.edu.pucp.tasf.gvns;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Cubre el camino de carga del esquema Sa/Sc tras pasar de {@code Map<String,Object>}
 * a {@link EnvioDTO} y a arrays dimensionados al volumen real (cambios #2 y #4).
 *
 * No toca disco: rellena {@code mapaIataAId} a mano, así el test es rápido y
 * determinista. Falla si la carga deja de mapear IATA→id, de descartar envíos
 * inválidos, o si vuelve a reservar los 20 M fijos por defecto.
 */
class GestorDatosDesdeArrayTest {

    /** GestorDatos con dos aeropuertos registrados, sin leer archivos. */
    private static GestorDatos conAeropuertos() {
        GestorDatos d = new GestorDatos();
        d.mapaIataAId.put("AAAA", 1);
        d.mapaIataAId.put("BBBB", 2);
        d.numAeropuertos = 2;
        return d;
    }

    @Test
    void arraysArrancanVaciosNoEn20M() {
        // #4: ningún new GestorDatos() debe costar 560 MB por defecto.
        GestorDatos d = new GestorDatos();
        assertEquals(0, d.envioOrigen.length, "los arrays de envíos deben arrancar vacíos");
        assertEquals(0, d.envioDeadlineUTC.length);
    }

    @Test
    void cargaMapeaCamposYDimensionaAlVolumenReal() {
        GestorDatos d = conAeropuertos();
        d.cargarEnviosDesdeArray(List.of(
                new EnvioDTO("AAAA", "BBBB", 5, 1000L, 2440L),
                new EnvioDTO("BBBB", "AAAA", 3, 1500L, 4380L)));

        assertEquals(2, d.numEnvios);
        assertEquals(2, d.envioOrigen.length, "arrays dimensionados al tamaño del bloque");
        // primer envío
        assertEquals(1, d.envioOrigen[0]);
        assertEquals(2, d.envioDestino[0]);
        assertEquals(5, d.envioMaletas[0]);
        assertEquals(1000L, d.envioRegistroUTC[0]);
        assertEquals(2440L, d.envioDeadlineUTC[0]);
        // segundo envío
        assertEquals(2, d.envioOrigen[1]);
        assertEquals(1, d.envioDestino[1]);
    }

    @Test
    void descartaEnviosConIataDesconocidaONula() {
        GestorDatos d = conAeropuertos();
        d.cargarEnviosDesdeArray(List.of(
                new EnvioDTO("AAAA", "BBBB", 1, 0L, 1440L), // válido
                new EnvioDTO("AAAA", "ZZZZ", 1, 0L, 1440L), // destino desconocido
                new EnvioDTO(null,  "BBBB", 1, 0L, 1440L))); // origen nulo

        assertEquals(1, d.numEnvios, "solo el envío con ambos IATA conocidos entra");
    }

    @Test
    void listaVaciaNoFalla() {
        GestorDatos d = conAeropuertos();
        d.cargarEnviosDesdeArray(List.of());
        assertEquals(0, d.numEnvios);
        assertEquals(0, d.envioOrigen.length);
    }

    @Test
    void exigeAeropuertosCargados() {
        GestorDatos sinAeropuertos = new GestorDatos();
        assertThrows(IllegalStateException.class,
                () -> sinAeropuertos.cargarEnviosDesdeArray(
                        List.of(new EnvioDTO("AAAA", "BBBB", 1, 0L, 1440L))));
    }
}
