# GARYCIO — Informe final del prompt maestro (bloques P0, P1, P2)

**Fecha:** 2026-04-24
**Autor:** Claude (Opus 4.7) — sesión de reparación post-incidente 22-23/4/2026
**Estado del bot en servidor:** APAGADO (verificado — puerto 443 rechaza, nginx 502)
**Ubicación del código:** local en `/Users/emilioranucoli/Desktop/Oficina Ranuk_Proyectos/GARYCIO_Project`

---

## Resumen ejecutivo

Durante el incidente del 22-23/4 el bot envió 175 respuestas a donantes reales
(debía estar en TEST_MODE solo a admins) generando 1945 errores de WhatsApp,
de los cuales 1773 fueron `131047` (ventana 24h cerrada: re-engagement required).
No fue un problema de rate limit como supuso inicialmente el dueño; fue el bot
intentando responder en texto libre a conversaciones fuera de ventana.

Este informe cubre TRES bloques del prompt maestro: P0 (hotfixes críticos, 8+4
tareas), P1 (robustez, 6 tareas) y P2 (IA/escalación, 3 tareas). Todo está
implementado en local, NO deployado al servidor. El servidor sigue apagado.

## Política acordada con el dueño

1. **Bot reactivo puro**: responde solo a inbound nuevos, nunca inicia.
   Cada inbound del donante abre/reabre la ventana 24h → respuesta en texto
   libre sin template. NO necesitamos templates para el re-encendido.

2. **Olvido al start**: cuando el bot se enciende, descarta todos los flows
   en progreso y mensajes pre-existentes en la cola. Lo viejo queda como
   dato en `mensajes_log` pero no le interesa al bot.

3. **Respeto a humanos**: si hay escalación activa o si un humano envió un
   mensaje reciente (detección automática), el bot no se mete.

4. **Paciencia con el donante**: debounce 10s antes de responder, para que
   donantes que escriben en múltiples mensajes cortos tengan tiempo de
   terminar.

## Trabajo entregado

### P0 — Hotfixes críticos

| ID | Descripción | Archivos | Tests |
|----|-------------|----------|-------|
| P0.1 | Fix TEST_MODE whitelist | `bot/client.ts` | — |
| P0.2 | 131047/131056 como permanentes (no retry) | `bot/client.ts` | bot-client-retries (7) |
| P0.3 | Pre-check ventana 24h antes de sendMessage | `bot/client.ts`, `services/whatsapp-window.ts` (nuevo) | whatsapp-window (3) |
| P0.4 | Dedup + throttle en notificarAdmins | `services/reportes-ceo.ts` | reportes-ceo (3) |
| P0.5 | Validación zod del JSON de IA + mapeo de enums | `services/clasificador-ia.ts`, `services/ia-enum-mapper.ts` (nuevo) | ia-enum-mapper (18) |
| P0.6 | Fix ownership de tablas PostgreSQL | `scripts/fix-table-ownership.sql` (nuevo) | — |
| P0.7 | Watchdog con ADMIN_PHONES dinámico | `scripts/watchdog.sh` (nuevo) | — |
| P0.8 | Runbook de rotación de secretos | `ADA-AUDITS/P0.8_ROTACION_SECRETOS.md` (doc) | — |
| **P0.9** | **Reset conversacional al start** | `bot/conversation-manager.ts`, `services/queue.ts`, `index.ts` | queue-reset (3) |
| **P0.10** | **Detección de intervención humana + pausa 30min** | `services/bot-takeover.ts` (nuevo), `bot/client.ts`, `bot/webhook.ts`, `bot/handler.ts` | bot-takeover (7) |
| **P0.11** | **Historial 48h como contexto para IA** | `bot/conversation-manager.ts` | — |
| **P0.12** | **Debounce 10s por teléfono** | `services/inbound-debounce.ts` (nuevo), `index.ts` | inbound-debounce (5) |

### P1 — Robustez

| ID | Descripción | Archivos | Tests |
|----|-------------|----------|-------|
| P1.1 | pg-boss cola persistente | `services/queue.ts` (nuevo), `bot/webhook.ts`, `index.ts` | queue (4) |
| P1.2 | Circuit breaker OpenAI | `services/circuit-breaker.ts` (nuevo), `services/clasificador-ia.ts` | circuit-breaker (6) |
| P1.3 | Cache LRU + pre-clasificador heurístico | `services/ia-cache.ts` (nuevo), `services/clasificador-ia.ts` | ia-cache (7) |
| P1.4 | Jest setup global + coverage baseline 42% | `jest.config.ts`, `jest.setup.ts` (nuevo) | — |
| P1.5 | GitHub Actions CI | `.github/workflows/ci.yml` (nuevo) | — |
| P1.6 | Rate limiter adaptativo a 131056 | `services/rate-limit-adaptive.ts` (nuevo), `bot/client.ts` | rate-limit-adaptive (4) |

### P2 — IA / Escalación

| ID | Descripción | Archivos | Tests |
|----|-------------|----------|-------|
| P2.1 | Frases gatillo (legal/financiero/urgencia/frustración/disconformidad/baja) | `services/escalation-triggers.ts` (nuevo), `bot/conversation-manager.ts` | escalation-triggers (8) |
| P2.2 | Fallback confidence:low → escala en todos los intents no-deterministas | `bot/conversation-manager.ts` | — |
| P2.3 | Continuidad con humano (ya existente en línea 260) | — | — |

### Métricas

- **Tests nuevos:** ~75 tests agregados
- **Total suite:** 264 tests, 240 pasan (90.9%)
- **24 tests fallan** en `tests/flows/*` — drift pre-existente, ver `P1.4_TESTS_PENDIENTES.md`
- **Coverage:** 41.73% stmts / 42.1% lines (baseline conservador en `jest.config.ts`)
- **Typecheck:** `tsc --noEmit` limpio

## Archivos nuevos (local, sin deploy)

```
src/services/whatsapp-window.ts        P0.3
src/services/ia-enum-mapper.ts         P0.5
src/services/queue.ts                  P1.1
src/services/circuit-breaker.ts        P1.2
src/services/ia-cache.ts               P1.3
src/services/rate-limit-adaptive.ts    P1.6
src/services/bot-takeover.ts           P0.10
src/services/inbound-debounce.ts       P0.12
src/services/escalation-triggers.ts    P2.1
scripts/fix-table-ownership.sql        P0.6
scripts/watchdog.sh                    P0.7
jest.setup.ts                          P1.4
.github/workflows/ci.yml               P1.5
```

## Tareas pendientes (P3–P6)

Estas NO se implementaron en esta sesión — son bloques de mayor alcance,
muchos infraestructura/organización. Recomiendo hacerlos en ciclos
separados:

### P3 — Templates (solo necesarios para outbound proactivo)
- P3.1 Registrar templates Meta (`garycio_bienvenida_v1`, etc.)
- P3.2 `sendTemplate()` para re-engagement
- P3.3 Helper `sendOrReengage(phone, msg)`

**Nota:** para el re-encendido reactivo inmediato NO son necesarios. Solo
para cuando se quieran enviar avisos matutinos de ruta a donantes con
ventana cerrada.

### P4 — Monitoreo e infra
- P4.1 PM2 min_uptime + max_restarts
- P4.2 pm2-logrotate
- P4.3 Prometheus + Grafana
- P4.4 Alertmanager
- P4.5 Nginx rate limit
- P4.6 Backups DB off-site

### P5 — Estructura
- P5.1 Refactor de `conversation-manager.ts` (738 líneas, dividir)
- P5.2 Staging environment
- P5.3 Vault / SOPS para secretos

### P6 — Re-encendido controlado (plan propuesto)

Ver sección siguiente.

---

## Plan propuesto para re-encender el bot (P6)

### Pre-requisitos antes del encendido

1. **Revisión de código local** (que vos leas lo cambiado, especialmente
   `bot-takeover.ts`, `inbound-debounce.ts`, `queue.ts`, `client.ts`).

2. **Merge a branch de staging** (crear si no existe) y correr CI
   (`.github/workflows/ci.yml`).

3. **Deploy a servidor con bot APAGADO**:
   - `git pull` en servidor
   - `npm ci`
   - `npm run build`
   - **NO arrancar PM2 todavía**

4. **Rotación de secretos** (P0.8): OpenAI key, WhatsApp token, ADMIN_API_KEY
   si no se hizo aún. Ver `P0.8_ROTACION_SECRETOS.md`.

5. **Migración DB**:
   - Correr `scripts/fix-table-ownership.sql` como superuser de Postgres
   - Verificar que `pgboss` schema puede ser creado (pg-boss lo hace auto al
     primer start, necesita permisos)

6. **Pre-start limpieza (opcional)**:
   - Verificar `human_escalations` activas: `SELECT * FROM human_escalations WHERE estado='activa'`
     → si hay muchas de la semana del incidente, decidir si resolverlas o
     dejarlas como "bot no se mete"
   - Mensaje en `mensajes_log` queda intacto (histórico)

### Fase A — Canary a admins (24h)

- Poner `TEST_MODE=true` y `ADMIN_PHONES=393445721753,<otros admins>`
- Arrancar `pm2 start`
- Simular conversación desde admin phones
- Verificar logs: NO hay 131047, NO hay envíos a donantes reales
- Verificar que en frío:
  - `resetConversationalStateOnStart()` logea "P0.9 — Estado conversacional reseteado"
  - pg-boss se conecta y arranca worker
  - `isConversationWindowOpen` responde correctamente

### Fase B — Smoke test con 5-10 donantes voluntarias (24h)

- Agregar sus teléfonos a `ADMIN_PHONES` temporalmente
- Pedirles que escriban un mensaje fresco (para abrir ventana 24h)
- Bot responde — verificar:
  - Debounce 10s funciona (si mandan varios msgs seguidos, se concatenan)
  - Clasificación IA correcta
  - No hay 131047
  - Si un admin responde manual vía dashboard/Business App → bot se pausa
  - Si pasa 30min sin humanos → bot vuelve a responder

### Fase C — Subset controlado (50-100 donantes, 48h)

- Sacar `TEST_MODE=true`
- `ADMIN_PHONES` de vuelta solo admins reales
- Para elegir el subset: donantes que hayan escrito en las últimas 24h
  (ventana abierta garantizada, sin riesgo 131047)
- Monitorear:
  - Ratio de escalaciones por IA (P2.2)
  - Triggers disparados (P2.1)
  - Circuit breaker OpenAI
  - Takeover automático

### Fase D — Rampa completa

- Remover subset
- Activar bot para todos los inbound
- Monitoreo continuo primeras 72h
- Threshold para abortar: >5 errores 131047 en 10min → apagar y auditar

### Watchdog

`scripts/watchdog.sh` (P0.7) notifica por WhatsApp a admins si:
- Proceso PM2 muere >2 veces en 5min
- No hay heartbeat en 30min
- Errores 131047 superan umbral

## Cómo usar las nuevas piezas

### Pausar el bot para una donante manualmente
```typescript
import { pauseBotForPhone } from "./src/services/bot-takeover";
pauseBotForPhone("393445721753", "admin-manual-pause");
```

### Verificar estado
```typescript
import { takeoverStats } from "./src/services/bot-takeover";
import { rateLimitStats } from "./src/services/rate-limit-adaptive";
import { debounceStats } from "./src/services/inbound-debounce";
```

### Re-activar donante escalada
```typescript
import { resolveHumanEscalation } from "./src/services/human-escalation";
await resolveHumanEscalation("393445721753", "admin-name");
```

## Addendum 2026-04-25 — Canary cap progresivo

Política nueva acordada con el dueño: al encender el bot solo maneja
las **primeras N donantes** que escriban. Las que vengan después
quedan en silencio total (no respuesta, no escalación). Cuando el
dueño confirma que va todo bien, sube el cap por endpoint hasta
liberar al total de donantes.

**Implementación local (sin deploy):**

- [src/services/canary-cap.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/services/canary-cap.ts):
  Set en memoria + counter de skips por phone. Admins (`ADMIN_PHONES`)
  y `CEO_PHONE` bypassean sin consumir slot.
- [src/bot/handler.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/bot/handler.ts):
  hook entre `isBotPaused` y el anti-spam. `tryAcquireCanarySlot(phone)`
  decide si procesar o silenciar. Notifica admins cuando se llena el set.
- [src/bot/conversation-manager.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/bot/conversation-manager.ts)
  `resetConversationalStateOnStart()`: ahora también `_resetCanary()`
  (consistente con la política de olvido al start).
- [src/index.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/index.ts):
  endpoints admin (todos requieren `X-Admin-Key`):
  - `GET  /admin/canary/status` — lista de phones activas, skipped, cap.
  - `POST /admin/canary/cap   { cap: 20 }` — sube/baja el cap on-the-fly.
  - `POST /admin/canary/enabled { enabled: true|false }` — kill switch.
  - `POST /admin/canary/release { phone: "..." }` — libera un slot.
  - `POST /admin/canary/reset` — vacía el set sin reiniciar.
- Env nuevas (en [src/config/env.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/config/env.ts)):
  - `CANARY_ENABLED=true` — activar canary
  - `CANARY_CAP=10` — cap inicial
- Tests: [tests/canary-cap.test.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/tests/canary-cap.test.ts) — 9 casos.

### Flujo operativo del re-launch

| Momento | Cap | Acción |
|---------|-----|--------|
| Encendemos el bot | `CANARY_CAP=10`, `CANARY_ENABLED=true` | Bot responde solo a las primeras 10 donantes que escriban. |
| Cuando entra la 10ª | — | Notificación auto a admins: "🚥 Canary cap alcanzado (10)". |
| Donantes 11+ escriben | — | Silencio total del bot. Admin las atiende a mano si quiere, o las deja para después. |
| Confirmás que va todo bien | `POST /admin/canary/cap {cap: 50}` | Bot empieza a tomar más donantes hasta 50. |
| Más confianza | `POST /admin/canary/cap {cap: 500}` | Sigue subiendo. |
| Listo para todo el padrón | `POST /admin/canary/enabled {enabled: false}` | Sin límite, modo normal. |

### Edge cases cubiertos

- **Ya estaba en el set y vuelve a escribir**: pasa siempre, aunque el cap esté lleno.
- **Admin/CEO escribe**: bypassa, no consume slot.
- **Bot se cae y PM2 reinicia**: P0.9 vacía DB + `_resetCanary()`. Las próximas 10 donantes que escriban toman los slots (alineado con "olvido al start").
- **Donante rebota varias veces sin slot**: `skipped[phone]` se incrementa, visible en `/admin/canary/status` para ver cuántas quedaron afuera.

## Addendum 2026-04-24 (post-informe)

- **Race de arranque corregido** en [src/index.ts](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/src/index.ts):
  ahora `resetConversationalStateOnStart()` + `startInboundWorker()` corren
  ANTES de `app.listen(PORT)`. Así se elimina la ventana de segundos donde
  un webhook entrante podía encolar un job que después el filtro
  `workerStartedAt` descartaba silenciosamente.
- **P4.1 PM2 hardening** en [ecosystem.config.js](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/ecosystem.config.js):
  `min_uptime 60s`, `max_restarts 10`, `restart_delay 5000`,
  `exp_backoff_restart_delay 2000`, `kill_timeout 10000`, `merge_logs`.
- **P4.2 log rotation** en [scripts/setup-pm2-logrotate.sh](../Oficina%20Ranuk_Proyectos/GARYCIO_Project/scripts/setup-pm2-logrotate.sh):
  instala `pm2-logrotate` (20M × 14 gzip, rotación diaria). Correr una vez
  por server: `bash scripts/setup-pm2-logrotate.sh`.
- **Verificación**: `tsc --noEmit` limpio. Tests nuevos P0-P2: 40/40 verdes.
  Fallos totales: 28/276 (drift de flows pre-existente, no blocker).
- **2026-04-24 (segunda pasada)** — drift de flows tests resuelto:
  - `tests/bot-client-retries.test.ts`: agregado `_resetRateLimit()` en
    `beforeEach` (state leak post-test 131056 que dejaba al phone en backoff
    y hacía cortocircuito antes de `fetch`).
  - `tests/flows/aviso.test.ts`, `tests/flows/reclamo.test.ts`,
    `tests/flows/nueva-donante.test.ts`, `tests/flows/difusion.test.ts`,
    `tests/flows/admin-flow.test.ts`: actualizados a `res.interactive.body` /
    `res.interactive.buttons` / `res.interactive.sections` reflejando que
    los flows ahora usan listas y botones interactivos en vez de texto plano.
    Mock de DB en admin convertido a thenable para soportar
    `await db.select().from().where()` con destructuring.
  - **Estado final: 273/273 tests verdes** en `npx jest`.

## Riesgos residuales

1. **Debounce 10s aumenta latencia percibida** para donantes que escriben un
   solo mensaje corto. Trade-off aceptado.

2. **Detección de intervención humana depende de 360dialog webhook statuses**.
   Si 360dialog cambia el formato de statuses, puede fallar. Tests mockean
   el input — revisar en primera conexión real.

3. **Cache LRU en memoria** (ia-cache, bot-takeover): no sobrevive a
   reinicio. Aceptable porque P0.9 intencionalmente tira estado al start.

4. **pg-boss requiere schema `pgboss`** en Postgres. Primer start lo crea.
   Necesita privilegios de CREATE SCHEMA. Si falla por permisos, correr
   como superuser primero: `CREATE SCHEMA pgboss;`.

5. ~~**24 tests de flows siguen rojos**~~ — RESUELTO el 24/4 (2da pasada).

## Referencias

- `ADA-AUDITS/P0.8_ROTACION_SECRETOS.md` — runbook de secretos
- `ADA-AUDITS/P1.4_TESTS_PENDIENTES.md` — detalle de tests con drift
- `jest.config.ts` — thresholds y setup

---

**Próxima acción sugerida:** revisar este informe + lo cambiado en local.
Cuando des luz verde, ejecuto el deploy a staging / servidor y Fase A.
