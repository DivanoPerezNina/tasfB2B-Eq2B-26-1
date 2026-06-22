package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port            string
	PlanificadorURL string
	ConsultasURL    string
	TickIntervalMs  int
	SSEMaxClientes  int
}

func Load() *Config {
	return &Config{
		Port:            env("PORT", "8083"),
		PlanificadorURL: env("PLANIFICADOR_URL", "http://localhost:8084"),
		ConsultasURL:    env("CONSULTAS_URL", "http://localhost:8085"),
		TickIntervalMs:  envInt("TICK_INTERVAL_MS", 1000),
		SSEMaxClientes:  envInt("SSE_MAX_CLIENTES", 50),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("variable requerida no definida: %s", key))
	}
	return v
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

var _ = mustEnv // evitar "declared and not used"
