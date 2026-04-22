#!/bin/bash
# ================================================
# GARYCIO Watchdog - Kill Switch Automatico
# Si el bot esta caido 3 veces seguidas, notifica y detiene
# ================================================
STATE_FILE="/tmp/garycio_watchdog_failures"
MAX_FAILURES=3
HEALTH_URL="http://localhost:3000/health"
WHATSAPP_API="https://waba-v2.360dialog.io/v1/messages"
API_KEY="EX67SXZAIwWVX9ZyKzeUCp8AAK"
ADMIN_PHONES=("393445721753" "5491126330388" "5491151042517" "5491130128112" "5491154017202")
LOG_FILE="/root/watchdog.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

send_whatsapp() {
  local phone="$1"
  local msg="$2"
  curl -s -X POST "$WHATSAPP_API"  -H "D360-API-KEY: $API_KEY"  -H "Content-Type: application/json"  -d "{
      \"messaging_product\": \"whatsapp\",
      \"recipient_type\": \"individual\",
      \"to\": \"$phone\",
      \"type\": \"text\",
      \"text\": { \"body\": \"$msg\" }
    }" > /dev/null 2>&1
}

notify_admins() {
  local msg="$1"
  for phone in "${ADMIN_PHONES[@]}"; do
    send_whatsapp "$phone" "$msg"
  done
}

# Check if PM2 process exists
pm2_describe=$(pm2 describe garycio-bot 2>/dev/null | grep -c "online")
if [ "$pm2_describe" -eq 0 ]; then
  log "Bot no esta corriendo (PM2). Nada que monitorear."
  rm -f "$STATE_FILE"
  exit 0
fi

# Check health endpoint
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null)

if [ "$http_code" == "200" ]; then
  # Bot healthy
  if [ -f "$STATE_FILE" ]; then
    failures=$(cat "$STATE_FILE")
    if [ "$failures" -ge 1 ]; then
      log "Bot recuperado despues de $failures fallas"
      notify_admins "✅ GARYCIO Watchdog: Bot recuperado y respondiendo correctamente."
    fi
    rm -f "$STATE_FILE"
  fi
  exit 0
fi

# Bot unhealthy
failures=1
if [ -f "$STATE_FILE" ]; then
  failures=$(($(cat "$STATE_FILE") + 1))
fi
echo "$failures" > "$STATE_FILE"
log "Health check fallo (HTTP $http_code). Falla #$failures"

if [ "$failures" -ge "$MAX_FAILURES" ]; then
  log "MAX FAILURES ALCANZADO ($MAX_FAILURES). Deteniendo bot y notificando admins."
  
  # Notificar primero (antes de detener, por si falla)
  notify_admins "ð¨ GARYCIO KILL SWITCH ACTIVADO ð¨\n\nEl bot fallo $MAX_FAILURES veces seguidas en health check.\nHTTP: $http_code\nFecha: $(date '+%Y-%m-%d %H:%M:%S')\n\nEl bot sera detenido AUTOMATICAMENTE.\nReinicio manual requerido."
  
  # Detener bot
  pm2 stop garycio-bot
  pm2 save
  
  # Notificar que fue detenido
  sleep 3
  notify_admins "ð´ GARYCIO BOT DETENIDO\n\nEl bot fue detenido automaticamente por el watchdog.\nNO se reiniciara solo.\nAccion manual requerida."
  
  rm -f "$STATE_FILE"
fi
