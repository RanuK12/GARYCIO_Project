# GARYCIO — Contexto handoff (otra IA puede tomar desde acá)

**Última actualización:** 2026-04-26
**Estado bot:** ONLINE en producción con cap=10 (smoke test del dueño en curso)
**Repo:** github.com/RanuK12/GARYCIO_Project
**Server:** Hetzner CPX22 @ 204.168.183.96 (Ubuntu 24.04, 2vCPU, 4GB RAM, 80GB)

---

## Qué es GARYCIO

Sistema de WhatsApp para gestión de donantes de orina (recolección para reciclaje agropecuario) en Argentina. ~6,000 donantes activas. Empresa nueva, en fase de despliegue progresivo.

**Operación día a día:**
- Donantes escriben al WhatsApp Business → bot atiende reclamos / avisos / consultas / registro nuevas
- Choferes recolectan según rutas optimizadas (OptimoRoute + Ituran GPS)
- Admin (Stefano) gestiona desde un panel admin dentro del propio chat de WhatsApp

**Dueño del proyecto:** Emilio (italiano, número +393445721753, NO admin durante el smoke test actual). Hermano Stefano (argentino, +5491126330388, admin permanente).

---

## Stack técnico

- **Runtime:** Node.js 22 + TypeScript 5.7 (compilación a `dist/`)
- **Framework HTTP:** Express
- **DB:** PostgreSQL 16 (peer auth localhost) + Drizzle ORM
- **WhatsApp:** 360dialog (proveedor — NO Meta directo, empresa aún no verificada por Meta)
- **IA:** OpenAI gpt-4o (clasificación de intención + interpretación contextual de mensajes)
- **Process mgr:** PM2 (fork mode, no cluster) con `pm2-logrotate` + `pm2-root.service` para reboot resilience
- **Tests:** Jest 28 suites / 292 tests (`npm test`)
- **CI:** GitHub Actions `.github/workflows/ci.yml` (tsc + tests + coverage thresholds 40%)

---

## El incidente original (22-23/4/2026)

Bot reactivado tras pausa, generó 1945 errores en WhatsApp:
- 1773 × **131047** (re-engagement required, ventana 24h cerrada)
- 53 × **131056** (rate limit business/consumer pair)
- 175 mensajes enviados a donantes reales que NO debían (TEST_MODE mal aplicado)

**Causas raíz:**
1. `TEST_MODE` no bloqueaba a no-admins (bug `isWhitelisted`)
2. `131047` y `131056` no marcados como permanentes → bot reintentaba sin parar
3. Sin pre-check de ventana 24h antes de `sendMessage`
4. Sin throttle de notificaciones a admin (spam de alertas)
5. Sin dedup de mensajes entrantes (procesaba reintentos del webhook)

---

## Bloques de hardening aplicados (P0–P2 + Meta + Canary)

### P0 — Hotfixes críticos

| ID | Descripción | Archivo principal |
|---|---|---|
| P0.1 | TEST_MODE bloquea no-admins en `isWhitelisted` | `src/services/bot-control.ts` |
| P0.2 | 131030/131026/132000/100/131047/131056 marcados permanentes | `src/bot/client.ts` |
| P0.3 | Pre-check ventana 24h antes de sendMessage | `src/services/whatsapp-window.ts` |
| P0.4 | Dedup hash 5min + throttle 30/min en notificarAdmins | `src/services/reportes-ceo.ts` |
| P0.5 | Validación zod del JSON de IA + mapeo enums DB | `src/services/ia-enum-mapper.ts` |
| P0.9 | `resetConversationalStateOnStart` borra flows en curso | `src/bot/conversation-manager.ts` |
| P0.10 | Detección humana via webhook statuses + pausa 30min | `src/services/bot-takeover.ts` |
| P0.11 | Historial 48h/8 msgs como contexto IA | `src/bot/conversation-manager.ts` |
| P0.12 | Debounce **3s** por phone (era 10, bajó tras incidente 25/4) | `src/services/inbound-debounce.ts` |
| P0.13 | Pre-pausa de phones donde humano respondió últimas 24h | `src/bot/conversation-manager.ts` |

### P1 — Robustez

| ID | Descripción | Archivo |
|---|---|---|
| P1.1 | pg-boss persistent queue (NO integrado actualmente, webhook llama directo) | `src/services/queue.ts` |
| P1.2 | Circuit breaker OpenAI (no integrado) | `src/services/circuit-breaker.ts` |
| P1.3 | LRU cache IA + pre-clasificador heurístico | `src/services/ia-cache.ts` |
| P1.4 | Tests baseline 42% coverage + jest.setup.ts | `jest.config.ts`, `jest.setup.ts` |
| P1.5 | GitHub Actions CI | `.github/workflows/ci.yml` |
| P1.6 | Rate limiter adaptativo a 131056 | `src/services/rate-limit-adaptive.ts` |

### P2 — IA / escalación

| ID | Descripción | Archivo |
|---|---|---|
| P2.1 | Triggers de escalación inmediata (legal, financiero, urgencia, frustración, disconformidad, baja) | `src/services/escalation-triggers.ts` |
| P2.2 | Fallback confidence:low → escala a humano | `src/bot/conversation-manager.ts` |
| P2.3 | Continuidad contexto humano (ya existía) | `src/services/human-escalation.ts` |

### Meta compliance (límites WhatsApp Cloud API)

`WHATSAPP_LIMITS` centralizado en `src/bot/client.ts`:
- Buttons: max 3
- List rows: max 10 totales (sumando sections)
- body interactive: 1024 chars / text body: 4096 / caption: 1024 / filename: 240
- title button: 20 / row title: 24 / row description: 72
- Truncan + log error → evita Meta error 100

Verificación firma X-Hub-Signature-256 lista pero **inactiva** (no aplica con 360dialog).

### Sistema de capacidad first-come-first-served (commit 9c9bd63 origen)

- DB: tablas `donantes_bot_activos` + `configuracion_sistema (clave='LIMITE_DONANTES_BOT')`
- `activarDonanteBot` envuelto en transacción con `LOCK TABLE … SHARE ROW EXCLUSIVE` (post-incidente 25/4 que entró 11 con cap=10)
- Política de overflow: **silencio total** (no read receipt, no typing, no respuesta) — el donante #11 ve su mensaje en gris ✓✓ delivered
- Endpoint admin `POST /admin/capacidad { limite: N }` cambia el cap on-the-fly sin restart
- Menú admin WhatsApp opción "Capacidad del bot" tiene shortcuts del plan progresivo

### UX / monitoreo

- `markAsReadWithTyping` en webhook para que la donante vea ✓✓ azul + "escribiendo…" durante el debounce de 3s
- `whatsapp-quality.ts` chequea quality rating cada 6h, alerta admins si != GREEN
- `/admin/dashboard` agrega capacidad + quality + takeovers + rate limit + memoria + DLQ + counters en una llamada
- `pm2-logrotate` instalado (20M × 14 gzip diario)
- Backup script `/usr/local/bin/backup-garycio.sh` (pg_dump peer auth, validación tamaño, rotación 14 días, soporte rclone off-site si `OFFSITE_RCLONE_REMOTE` está seteado en `/etc/garycio.backup.env`)
- rclone v1.60.1 instalado, falta config destino off-site

---

## Incidente 25/4 (durante smoke test)

Al primer arranque tras hardening, problemas:
1. Cap=10 NO se aplicó → entraron 20+ donantes (bug rama legacy en `isWhitelisted`)
2. Bot procesó mensajes pendientes de horas atrás (360dialog reentregó al volver)
3. `TEST_MODE` en runtime decía `false` aunque .env decía `true` (PM2 cluster cwd ≠ raíz proyecto)
4. Race condition: 11 vs 10 con dos requests simultáneos
5. Conversación con donante "Belén Turletto" totalmente rota — bot guardó "Pero no trajeron mi regalo" como dirección, no extrajo nombres con "Soy X", concatenó mensajes con cambio de tema por debounce de 10s

**Fixes aplicados (commits 9a7c1bb + e6def8a):**
- Eliminada rama legacy `whitelistActive && whitelistLimit<=0 → return true` que bypaseaba el cap
- `LOCK TABLE … SHARE ROW EXCLUSIVE` en `activarDonanteBot` para serializar inserts
- `BOOT_TIMESTAMP_SEC` + `MAX_INBOUND_AGE_SEC=5min` en webhook para descartar mensajes pre-boot/viejos
- P0.13 pre-pausa de teléfonos con outbound humano reciente al arrancar
- `ecosystem.config.js`: `cwd: "/opt/garycio"` + `exec_mode: "fork"` explícito
- `env.ts` carga dotenv probando 3 paths (cwd, dir-relativo, /opt/garycio/.env)
- **Flow `nueva-donante` reescrito** para usar IA contextual en CADA step (no solo en mensajes complejos):
  - `interpretarPasoConIA(mensaje, paso, data, phone)` con prompt contextual al paso (`nombre`/`direccion`/`confirmacion`)
  - Retorna `{ accion: continuar|cancelar|queja|ya_donante|consulta|no_entiendo, valor, confianza }`
  - Detecta cambio de tema a queja → abandona registro y deriva humano
  - Extrae nombre limpio sin "Soy X" / "Me llamo X"
  - Confirmación tolerante a "1 lo que sea" (no solo "1" exacto)
  - "0" cancela desde cualquier step
- Debounce reducido **10s → 3s** para no concatenar mensajes con cambio de tema

---

## Estructura de archivos clave

```
src/
├── bot/
│   ├── client.ts          ← sendMessage, sendTemplate, sendInteractive*, WHATSAPP_LIMITS
│   ├── webhook.ts         ← entry point HTTP, filtro timestamp, dispatch a handler
│   ├── handler.ts         ← processIncomingMessage: dedup, anti-spam, lock por phone, isBotPaused
│   ├── conversation-manager.ts ← state machine, dispatch flows, IA classifier, P0.9/13
│   └── flows/
│       ├── nueva-donante.ts ← REESCRITO con IA contextual (e6def8a)
│       ├── reclamo.ts
│       ├── aviso.ts
│       ├── difusion.ts
│       ├── admin.ts       ← panel admin con plan progresivo
│       └── ...
├── services/
│   ├── bot-control.ts     ← isWhitelisted, capacidad, pause/resume/emergency-stop
│   ├── bot-takeover.ts    ← P0.10 detección humana
│   ├── escalation-triggers.ts ← P2.1 patrones queja/legal/baja/etc
│   ├── inbound-debounce.ts    ← P0.12 (window 3s)
│   ├── ia-cache.ts        ← P1.3 LRU
│   ├── rate-limit-adaptive.ts ← P1.6
│   ├── whatsapp-window.ts ← P0.3 ventana 24h
│   ├── whatsapp-quality.ts ← cron 6h
│   ├── clasificador-ia.ts ← classifyIntent gpt-4o
│   ├── reportes-ceo.ts    ← notificarAdmins con dedup+throttle (P0.4)
│   └── ...
├── database/
│   ├── schema.ts          ← drizzle schemas: 33 tablas
│   └── migrate.ts
├── config/
│   ├── env.ts             ← zod-validated env, dotenv multi-path
│   └── logger.ts          ← pino
└── index.ts               ← main: testConnection, P0.9 reset, app.listen, scheduler
```

---

## Endpoints admin críticos (todos requieren `X-Admin-Key: <ADMIN_API_KEY>`)

| Método | Path | Función |
|---|---|---|
| GET | `/health` | DB + counters + memoria (público) |
| GET | `/admin/dashboard` | Vista agregada de TODO |
| GET | `/admin/capacidad` | activos / limite / disponibles |
| POST | `/admin/capacidad` `{ limite: N }` | Cambiar cap on-the-fly |
| GET | `/admin/donantes-activos?page=1` | Lista de donantes con slot |
| DELETE | `/admin/donantes-activos/:telefono` | Liberar slot |
| GET | `/admin/bot/status` | Estado pause/running/emergency_stop |
| POST | `/admin/bot/pause` | Pausa (responde mantenimiento a no-admins) |
| POST | `/admin/bot/resume` | Reanuda |
| POST | `/admin/bot/emergency-stop` | Mata bot, requiere reinicio manual |
| GET | `/admin/whatsapp/quality` | Quality rating actual |
| POST | `/admin/whatsapp/quality/check` | Fuerza chequeo + alerta |
| GET | `/admin/bot-takeover/status` | Phones pausados por humano |
| POST | `/admin/bot-takeover/resume` `{ phone }` | Levanta pausa específica |
| GET | `/admin/rate-limit/status` | Backoffs por phone activos |
| POST | `/admin/dlq/retry` | Reintenta dead-letter queue |
| GET | `/admin/donantes/buscar?q=...` | Búsqueda por nombre/tel/dir |
| GET | `/admin/donantes/altas-bajas?desde=&hasta=` | Métricas |
| GET | `/admin/human-escalations` | Lista escalaciones activas |
| POST | `/admin/human-escalations/resolve` `{ phone, resolvedBy }` | Cierra |

---

## Estado producción AHORA (al momento de este doc)

```
HEAD: e6def8a feat(nueva-donante): IA contextual en cada step + escapes globales
PM2: garycio-bot ONLINE (PID 521561, fork mode, ~134MB RAM)
DB:
  conversation_states: 0 filas (limpio)
  donantes_bot_activos: 0 activos (limpio)
  configuracion_sistema.LIMITE_DONANTES_BOT: 10
  human_escalations activas: 135 (legacy del incidente original, ignorables)
  DLQ: 198 descartados + 152 exitosos (legacy), 0 pendientes
.env:
  TEST_MODE=false
  TEST_PHONES=5491126330388
  ADMIN_PHONES=5491126330388 (italiano REMOVIDO temporalmente para test del dueño como donante)
  CEO_PHONE=5491126330388
  WHATSAPP_PROVIDER=360dialog
  AI_CLASSIFIER_ENABLED=true
P0.13 al boot: 30 phones pre-pausados (humano respondió últimas 24h)
```

---

## Bugs conocidos / deuda

1. **API_KEY de 360dialog hardcodeada en repo histórico** — `scripts/watchdog.sh` ya leído del .env, pero versiones viejas en git history la contienen. Rotar la key cuando se pueda. (Repo es privado, no expuesto según el dueño.)
2. **Off-site backup pendiente** — solo backup local. rclone instalado, falta `rclone config` + `OFFSITE_RCLONE_REMOTE` en `/etc/garycio.backup.env`.
3. **Sin HTTPS / SSL en nginx** — webhook entra HTTP plano por puerto 80 → :3000. Esperando dominio.
4. **pg-boss queue NO está activa** — `src/services/queue.ts` existe pero webhook llama directo a `processIncomingMessage`. Si el proceso muere a mitad de procesar, ese mensaje se pierde.
5. **Quality rating monitoring** activo (cron 6h) pero nunca testeado en producción real.
6. **Mark-as-read + typing indicator** activos solo dentro del cap; donantes fuera del cap (silencio total) no reciben ✓✓ azul tampoco.
7. **Flow `nueva-donante`** reescrito con IA, pero **NO probado en producción real con donantes** después del rewrite. El smoke test actual del dueño es el primer test real.
8. **Tests de `nueva-donante`** pasan via fallback regex porque `AI_CLASSIFIER_ENABLED=false` en `jest.setup.ts`. Los paths con IA solo se cubren en producción, no hay mock.
9. **Detección "donante existente con estado='nueva'"**: si una donante real tiene su nombre+dir cargados pero su `estado` quedó en `'nueva'` (workflow operativo), el bot la trata como nueva. Workaround manual: admin la pasa a `'inactiva'` o `'activa'` desde DB.

---

## Plan progresivo de re-launch

| Nivel | Cap | Cuándo subir |
|---|---|---|
| 1 (HOY) | 10 | Smoke con dueño + primeras donantes reales |
| 2 | 50 | Si 24h sin errores |
| 3 | 200 | Si 24h sin errores |
| 4 | 1000 | Si 24h sin errores |
| 5 | 50000 (= 100%) | Si 24h sin errores |

Aplicar desde menú admin → "Capacidad del bot" o `POST /admin/capacidad`.

**Criterios para NO subir:**
- Quality rating ≠ GREEN
- Errores 131047 acumulándose
- Memoria > 1.2 GB sostenida
- Reportes de donantes confundidas
- Más de 1 PM2 restart en 24h

**Rollback rápido:** menú admin → "Capacidad" → ajustar a 0 (nadie nuevo entra, las que están adentro siguen). Hard stop: `pm2 stop garycio-bot`.

---

## Comandos típicos de operación

```bash
# Ssh
ssh root@204.168.183.96   # password: ver credenciales privadas (NO en repo)

# Estado bot
ssh root@204.168.183.96 "pm2 list && pm2 logs garycio-bot --lines 50 --nostream"

# Dashboard
curl -H "X-Admin-Key: <KEY>" http://204.168.183.96:3000/admin/dashboard | jq

# Cambiar cap
curl -X POST -H "X-Admin-Key: <KEY>" -H "Content-Type: application/json" \
  -d '{"limite": 50}' http://204.168.183.96:3000/admin/capacidad

# Stop / start / restart
ssh root@204.168.183.96 "pm2 stop garycio-bot"
ssh root@204.168.183.96 "pm2 start garycio-bot"
ssh root@204.168.183.96 "pm2 restart garycio-bot"

# Backup manual
ssh root@204.168.183.96 "/usr/local/bin/backup-garycio.sh"

# Deploy nuevo código
ssh root@204.168.183.96 "cd /opt/garycio && git pull && rm -rf dist && npm run build && pm2 restart garycio-bot"
```

---

## Si una IA va a tomar este proyecto desde acá

**Prioridades sugeridas en orden:**

1. **Monitorear el smoke test actual** del dueño como donante. Si la conversación rompe, ver `src/bot/flows/nueva-donante.ts` (reescrito) y ver dónde falla.
2. **Rotar la D360-API-KEY** de 360dialog (queda en git history versiones viejas).
3. **Off-site backup**: configurar rclone con un destino (B2 / S3 / Drive / Hetzner Storage Box) + setear `/etc/garycio.backup.env` con `OFFSITE_RCLONE_REMOTE=...`.
4. **Mocks de IA en tests**: el flow `nueva-donante` con IA tiene cero cobertura de tests. Mockear `fetch` a OpenAI con respuestas deterministas y agregar casos.
5. **Cuando suba el cap a 200+**: activar pg-boss queue (`src/services/queue.ts`) para no perder mensajes si el proceso muere.
6. **HTTPS/SSL** cuando haya dominio: `certbot --nginx`.
7. **Reescribir flows `reclamo` / `aviso` / `difusion` con IA contextual** igual que `nueva-donante`. Hoy son regex-only.

**Reglas que aprendí trabajando con el dueño Emilio:**
- Bot OFF por default. NO arrancar sin permiso explícito.
- Cap progresivo, no full deploy. Empezar siempre chico y subir.
- Silencio total para donantes fuera del cap (no mensajes "estamos ocupados", no read receipt).
- Si humano respondió mientras bot apagado, bot NO toma esa conversación.
- Usar IA contextual, no flows rígidos. Pagamos gpt-4o, usémoslo.
- Antes de tocar producción: verificar el incidente que NO debe repetirse (22-23/4 de los 1773 errores 131047, y 25/4 con la donante "Belén turletto").

---

## Documentos relacionados (en `/Users/emilioranucoli/Desktop/ADA-AUDITS/`)

- `INFORME_INCIDENTE_GARYCIO_2026-04-23.md` — incidente original
- `EVALUACION_SENIOR_GARYCIO_2026-04-23.md` — auditoría senior
- `PROMPT_MAESTRO_GARYCIO.md` — plan original P0-P6 + credenciales
- `GARYCIO_INFORME_FINAL_P0-P2.md` — informe de P0-P2 con addendums
- `GARYCIO_AUDIT_META_COMPLIANCE.md` — auditoría de reglas Meta
- `GARYCIO_PLAN_RELANZAMIENTO_PROGRESIVO.md` — plan progresivo de cap
- `P0.8_ROTACION_SECRETOS.md` — runbook de rotación de credenciales
- `P1.4_TESTS_PENDIENTES.md` — drift de flow tests (resuelto)
- `GARYCIO_CONTEXT_HANDOFF.md` ← este documento
