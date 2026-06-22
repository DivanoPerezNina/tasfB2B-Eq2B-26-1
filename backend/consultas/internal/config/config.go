package config

import (
	"fmt"
	"os"
)

// Config del servicio de consultas. Lee de la BD (local por defecto) los envíos
// por ventana de tiempo, aprovechando el índice idx_registro_utc.
type Config struct {
	Port   string
	DBHost string
	DBPort string
	DBName string
	DBUser string
	DBPass string
}

func Load() *Config {
	return &Config{
		Port:   env("PORT", "8085"),
		DBHost: env("DB_HOST", "127.0.0.1"),
		DBPort: env("DB_PORT", "3306"),
		DBName: env("DB_NAME", "tasfb2b"),
		DBUser: env("DB_USER", "tasf"),
		DBPass: env("DB_PASS", ""),
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
