# GARYCIO — Plan de re-lanzamiento progresivo

**Fecha:** 2026-04-25
**Contexto:** post-incidente 22-23/4/2026. Bot reiniciado con cap controlado.
**Total a manejar:** ~6,000 donantes activas en el padrón.

---

## Niveles del plan

| # | Cap | Cuándo | Cómo aplicar |
|---|-----|--------|--------------|
| 1 | **10** | Arranque (HOY) | Ya en DB. Bot OFF → ON. |
| 2 | **50** | Si 24h sin errores | Menú admin → Capacidad → "2) Cap 50" |
| 3 | **200** | Si 24h sin errores | Menú admin → "3) Cap 200" |
| 4 | **1000** | Si 24h sin errores | Menú admin → "4) Cap 1000" |
| 5 | **100% (50000)** | Si 24h sin errores | Menú admin → "5) 100% (sin tope)" |

Los slots no se "vacían" al subir el cap. Las que ya están adentro siguen.
Las que estaban afuera y vuelvan a escribir entran (mientras haya
disponibles en el nuevo límite).

## Cómo monitorear entre niveles (24h)

Antes de subir al siguiente nivel, en cada chequeo manual mirá:

| Métrica | Dónde | Verde |
|---------|-------|-------|
| Quality rating WhatsApp | Cron cada 6h te avisa si baja, o `GET /admin/whatsapp/quality` | GREEN |
| Errores 131047 (re-engagement) | Logs + dashboard counters | 0 (con pre-check ya no debería aparecer) |
| Errores 131056 (rate limit) | Dashboard `rate_limit.phones_in_backoff` | 0 o pocos transitorios |
| Memoria del bot | Dashboard `memory.heap_used_mb` | < 800 MB (max_restart 1500MB) |
| Reinicios PM2 | `pm2 list` columna `↺` | sin incremento |
| DLQ pendientes | Dashboard `dead_letter_queue.pendiente` | 0 |
| Escalaciones activas humanas | Dashboard `escalaciones_activas` | razonable; revisar cada una |
| Bot-takeover de números | Dashboard `bot_takeover.phones_paused` | OK que existan, indica humanos atendiendo |
| Tu WhatsApp Web | A ojo | Sin respuestas raras, sin spam, sin loops |

**Criterio de NO subir cap:**
- Quality rating != GREEN
- Errores 131047 o 131056 acumulándose en logs
- Memoria > 1.2 GB sostenida
- Más de 1 reinicio PM2 en 24h
- DLQ creciendo
- Algún caso reportado donde el bot dijo algo claramente mal

**Criterio de rollback (bajar cap o pausar):**
- Quality rating RED
- > 5 reportes de donantes confundidas en cola
- Errores 131047 > 10/hora (significa que el pre-check de ventana 24h falló)

## Cómo aplicar cada nivel — 3 vías

### Vía 1 — Desde tu chat de admin (la más simple)
```
[Escribís al bot] admin
[Bot] ¡Hola Emilio! → menú admin
[Tap] Capacidad del bot
[Bot] Muestra barra de progreso + lista
[Tap] 2) Cap 50  (o el nivel que toque)
[Bot] ✅ Plan progresivo aplicado: límite ahora *50* donantes.
```

### Vía 2 — Endpoint HTTP
```bash
curl -X POST http://204.168.183.96:3000/admin/capacidad \
  -H "X-Admin-Key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"limite": 50}'
```

### Vía 3 — Directo en DB (último recurso)
```bash
ssh root@204.168.183.96 \
  "sudo -u postgres psql -d garycio -c \"UPDATE configuracion_sistema SET valor='50' WHERE clave='LIMITE_DONANTES_BOT';\""
```

## Ver salud en cualquier momento

```
GET http://204.168.183.96:3000/admin/dashboard
```
Devuelve JSON con: capacidad, quality rating, takeovers, rate limit, memoria,
counters, escalaciones, DLQ. Una sola llamada para chequear todo.

## Rollback rápido

```
[Chat admin] → Capacidad del bot → "✏️ Ajustar a otro número" → escribir 0
```
Cap 0 = nadie NUEVO entra. Las que están adentro siguen siendo manejadas.

```
[Chat admin] → Control del bot → Pausa
```
Pausa = el bot responde un mensaje de "mantenimiento" a no-admins. Sigue
escuchando, pero no procesa flows.

```bash
ssh root@204.168.183.96 "pm2 stop garycio-bot"
```
Apagado total. Las donantes ven sus mensajes en gris ✓✓ delivered, sin respuesta.

## Comportamiento de la donante #11+ (silencio total)

Confirmado en código (`webhook.ts` post-`isWhitelisted`):
- ❌ **NO** se le envía el mensaje "estamos atendiendo capacidad máxima"
- ❌ **NO** se le marca como leído (sin ✓✓ azules)
- ❌ **NO** se le manda el typing indicator
- ✅ Su mensaje queda en estado *delivered* (gris ✓✓) en su WhatsApp
- ✅ Se loguea internamente como `ignored` para no reprocesarla

Esto evita consumir su ventana 24h y deja al humano atender después si quiere.

## Lo que pasa al iniciar el bot

1. **P0.9** — Borra `conversation_states` (ya está vacío, no-op).
2. **HTTP server arranca** en puerto 3000 → nginx proxea → 360dialog tiene
   webhook configurado a `http://204.168.183.96/webhook`.
3. **Scheduler** programa: seguimiento reclamos, recordatorios vuelta,
   notificación nuevas, reintento DLQ, progreso rutas, **chequeo quality
   cada 6h**.
4. **`donantes_bot_activos`** está vacía → primeras 10 inbounds van llenando.
5. **`pm2-logrotate`** ya online → logs no crecen sin control.
6. **Watchdog** corre cada minuto vía cron:
   - Si bot está apagado: log y exit.
   - Si bot está caído (no responde /health 3 veces): notifica admins +
     `pm2 stop`.

## Si algo se pudre durante el rollout

| Situación | Acción inmediata |
|-----------|------------------|
| Bot loop de respuestas raras | Menú admin → Pausa |
| Quality rating cae a YELLOW | Bajar cap a 10 con menú admin |
| Quality rating cae a RED | `pm2 stop garycio-bot` + revisar logs |
| Errores en log | `ssh root@204.168.183.96 "pm2 logs garycio-bot --err --lines 100 --nostream"` |
| Donante específica con bot loco | Liberá su slot: `DELETE /admin/donantes-activos/<phone>` |

---

**Estado al momento de este doc:**
- DB: `LIMITE_DONANTES_BOT = 10`, `donantes_bot_activos` vacía, `conversation_states` vacía
- TEST_MODE: a definir antes del start (true = solo admins; false = primeras 10 reales)
- Bot: OFF
- Backup local diario OK; off-site pendiente que elijas destino rclone
