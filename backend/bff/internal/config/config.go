package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port           string
	DBHost         string
	DBPort         string
	DBName         string
	DBUser         string
	DBPass         string
	CargaMasivaURL string
	PlanificadorURL string
	EjecutorURL    string
	CORSOrigin     string
}

func Load() *Config {
	return &Config{
		Port:            env("PORT", "8081"),
		DBHost:          env("DB_HOST", "tasfb2b.cpll0i02mkbl.us-east-1.rds.amazonaws.com"),
		DBPort:          env("DB_PORT", "3306"),
		DBName:          env("DB_NAME", "tasfb2b"),
		DBUser:          env("DB_USER", "Hamilton"),
		DBPass:          env("DB_PASS", "i5aLJibP1fwf05OBkYKu"),
		CargaMasivaURL:  env("CARGA_MASIVA_URL", "http://localhost:8082"),
		PlanificadorURL: env("PLANIFICADOR_URL", "http://localhost:8084"),
		EjecutorURL:     env("EJECUTOR_URL", "http://localhost:8083"),
		CORSOrigin:      env("CORS_ORIGIN", "*"),
	}
}

func (c *Config) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4",
		c.DBUser, c.DBPass, c.DBHost, c.DBPort, c.DBName)
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
