#!/usr/bin/env bash
# P4.2 — Instala y configura pm2-logrotate para evitar que logs/combined.log
# crezca sin control en el servidor. Ejecutar una vez por server.
#
# Uso:   bash scripts/setup-pm2-logrotate.sh
set -euo pipefail

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 no encontrado. Instalar primero: npm i -g pm2"
  exit 1
fi

pm2 install pm2-logrotate

pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:workerInterval 30

echo "pm2-logrotate configurado: 20M max / 14 archivos / gzip / rotación diaria."
pm2 conf pm2-logrotate
