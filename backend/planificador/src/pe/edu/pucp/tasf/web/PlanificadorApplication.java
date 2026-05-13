package pe.edu.pucp.tasf.web;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Punto de entrada Spring Boot para el motor de planificación GVNS.
 *
 * <p>Expone la API REST en el puerto configurado (por defecto 8084).
 * El motor GVNS en {@code pe.edu.pucp.tasf.gvns} no usa ninguna
 * anotación de Spring; es invocado directamente desde el controlador.
 */
@SpringBootApplication
@EnableConfigurationProperties(PlanificadorProperties.class)
public class PlanificadorApplication {

    public static void main(String[] args) {
        SpringApplication.run(PlanificadorApplication.class, args);
    }
}
