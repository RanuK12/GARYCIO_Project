#!/bin/bash
# Backup diario de la DB garycio.
#
# 1) pg_dump con sudo -u postgres (peer auth, sin password en cron).
# 2) Validación de tamaño mínimo.
# 3) Rotación local de 14 días.
# 4) (Opcional) Upload off-site con rclone si OFFSITE_RCLONE_REMOTE está seteado.
#
# Setup off-site (una vez por server):
#   apt install rclone
#   rclone config            # crear remoto, ej. nombre "garycio-backup"
#   echo 'OFFSITE_RCLONE_REMOTE=garycio-backup:garycio-backups' > /etc/garycio.backup.env
#
# Si la variable está vacía, el upload se salta (solo backup local).

set -euo pipefail

BACKUP_DIR="/root/backups"
LOG_FILE="/root/backup-garycio.log"
RETAIN_DAYS=14
MIN_SIZE_BYTES=1024  # un dump real es >> 1 KB

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/garycio-$TS.sql.gz"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"; }

log "BACKUP START → $OUT"

# Cargar config off-site si existe
[ -f /etc/garycio.backup.env ] && source /etc/garycio.backup.env

# 1) Dump local
sudo -u postgres pg_dump garycio | gzip > "$OUT"

SIZE=$(stat -c%s "$OUT")
if [ "$SIZE" -lt "$MIN_SIZE_BYTES" ]; then
  log "ERROR: backup local demasiado chico ($SIZE bytes). Borrando."
  rm -f "$OUT"
  exit 1
fi
log "Local OK: $OUT ($SIZE bytes)"

# 2) Off-site
if [ -n "${OFFSITE_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copy "$OUT" "$OFFSITE_RCLONE_REMOTE/" --quiet; then
      log "Off-site OK: rclone copy a $OFFSITE_RCLONE_REMOTE/"
    else
      log "ERROR: rclone copy falló — backup local conservado"
    fi
  else
    log "WARN: OFFSITE_RCLONE_REMOTE seteado pero rclone no instalado (apt install rclone)"
  fi
else
  log "Off-site: NO configurado (setear OFFSITE_RCLONE_REMOTE en /etc/garycio.backup.env)"
fi

# 3) Rotación local
DELETED=$(find "$BACKUP_DIR" -name "garycio-*.sql.gz" -mtime +"$RETAIN_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "Rotación: borrados $DELETED backups locales > $RETAIN_DAYS días"
fi

log "BACKUP DONE"
