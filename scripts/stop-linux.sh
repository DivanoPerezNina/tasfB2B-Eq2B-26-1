#!/bin/bash
# stop-linux.sh — Detiene todos los servicios TASF.B2B
echo "Deteniendo servicios..."
sudo systemctl stop tasfb2b-planificador tasfb2b-bff tasfb2b-ejecutor tasfb2b-carga-masiva 2>/dev/null || true
echo "Listo."
systemctl is-active tasfb2b-planificador tasfb2b-bff tasfb2b-ejecutor tasfb2b-carga-masiva 2>/dev/null || true
