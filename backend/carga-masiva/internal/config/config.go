package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port       string
	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPass     string
	TempDir    string
	BatchSize  int
	MaxUploadMB int64
}

func Load() *Config {
	return &Config{
		Port:        env("PORT", "8082"),
		DBHost:      env("DB_HOST", "tasfb2b.cpll0i02mkbl.us-east-1.rds.amazonaws.com"),
		DBPort:      env("DB_PORT", "3306"),
		DBName:      env("DB_NAME", "tasfb2b"),
		DBUser:      env("DB_USER", "Hamilton"),
		DBPass:      env("DB_PASS", "i5aLJibP1fwf05OBkYKu"),
		TempDir:     env("TEMP_DIR", "/tmp/tasf"),
		BatchSize:   envInt("BATCH_SIZE", 1000),
		MaxUploadMB: int64(envInt("MAX_UPLOAD_MB", 50)),
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
		panic(fmt.Sprintf("variable de entorno requerida no definida: %s", key))
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
