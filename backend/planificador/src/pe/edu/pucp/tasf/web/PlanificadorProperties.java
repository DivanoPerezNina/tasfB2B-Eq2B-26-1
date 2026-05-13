package pe.edu.pucp.tasf.web;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Propiedades de configuración del planificador leídas desde
 * {@code application.properties} o variables de entorno.
 *
 * <pre>
 * tasf.planificador.ruta-aeropuertos = /tmp/tasf/aeropuertos.txt
 * tasf.planificador.ruta-vuelos      = /tmp/tasf/vuelos.txt
 * tasf.planificador.ruta-envios      = /tmp/tasf/_envios_preliminar_
 * tasf.planificador.fecha-dataset-inicio = 20260101   (YYYYMMDD)
 * tasf.planificador.criterio-default = EDF
 * </pre>
 */
@ConfigurationProperties(prefix = "tasf.planificador")
public class PlanificadorProperties {

    private String rutaAeropuertos = "/tmp/tasf/aeropuertos.txt";
    private String rutaVuelos      = "/tmp/tasf/vuelos.txt";
    private String rutaEnvios      = "/tmp/tasf/_envios_preliminar_";
    /** Fecha inicio del dataset (YYYYMMDD). Warm-up arranca desde aquí. */
    private int    fechaDatasetInicio = 20260101;
    private String criterioDefault    = "EDF";

    // ── Getters y setters ─────────────────────────────────────────────────────

    public String getRutaAeropuertos()          { return rutaAeropuertos; }
    public void   setRutaAeropuertos(String v)  { this.rutaAeropuertos = v; }

    public String getRutaVuelos()               { return rutaVuelos; }
    public void   setRutaVuelos(String v)        { this.rutaVuelos = v; }

    public String getRutaEnvios()               { return rutaEnvios; }
    public void   setRutaEnvios(String v)        { this.rutaEnvios = v; }

    public int    getFechaDatasetInicio()        { return fechaDatasetInicio; }
    public void   setFechaDatasetInicio(int v)   { this.fechaDatasetInicio = v; }

    public String getCriterioDefault()           { return criterioDefault; }
    public void   setCriterioDefault(String v)   { this.criterioDefault = v; }
}
