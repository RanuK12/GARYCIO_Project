# GARYCIO — Contexto handoff (otra IA puede tomar desde acá)

**Última actualización:** 2026-04-26 20:00 ART
**Estado bot:** ONLINE en producción con cap=10
**Repo:** github.com/RanuK12/GARYCIO_Project
**Server:** Hetzner CPX22 @ 204.168.183.96 (Ubuntu 24.04, 2vCPU, 4GB RAM, 80GB)

---

## Qué es GARYCIO

Sistema de WhatsApp para gestión de donantes de orina (recolección para reciclaje agropecuario) en Argentina. ~6,000 donantes activas. Empresa nueva, en fase de despliegue progresivo.

**Operación día a día:**
- Donantes escriben al WhatsApp Business → bot atiende reclamos / avisos / consultas / registro nuevas
- Choferes recolectan según rutas optimizadas (OptimoRoute + Ituran GPS)
- Admin (Stefano) gestiona desde un panel admin dentro del propio chat de WhatsApp

**Dueño del proyecto:** Emilio (italiano, número +393445721753, admin). Hermano Stefano (argentino, +5491126330388, admin permanente).

---

## Stack técnico

- **Runtime:** Node.js 22 + TypeScript 5.7 (compilación a `dist/`)
- **Framework HTTP:** Express
- **DB:** PostgreSQL 16 (peer auth localhost) + Drizzle ORM
- **WhatsApp:** 360dialog (proveedor — NO Meta directo, empresa aún no verificada por Meta)
- **IA:** OpenAI gpt-4o (clasificación de intención + respuestas contextuales + training dinámico)
- **Process mgr:** PM2 (fork mode, no cluster) con `pm2-logrotate` + `pm2-root.service` para reboot resilience
- **Tests:** Jest 28 suites / 292 tests (`npm test`)
- **CI:** GitHub Actions `.github/workflows/ci.yml` (tsc + tests + coverage thresholds 40%)

---

## Motor de IA Contextual (implementado 26/4/2026)

### Arquitectura
El bot usa un motor de IA contextual (`src/services/respuesta-ia-contextual.ts`) que:

1. **Carga training examples dinámicos** de la tabla `ia_training_examples` en la DB
2. **Inyecta contexto del donante** en el System Prompt (días de recolección, dirección, estado)
3. **Genera respuestas naturales** adaptadas al tono de GARYCIO usando gpt-4o
4. **Fallback inteligente:** Si la IA falla, usa templates de estilo predefinidos

### Orquestación de flujos (`conversation-manager.ts`)
- **Bifurcación lógica:** Donantes registrados omiten `contacto_inicial` y van directo a IA
- **Escape inteligente:** Si una donante nueva hace un reclamo durante onboarding, el bot rompe el flujo rígido y responde con IA
- **Intenciones válidas:** `saludo`, `consulta`, `reclamo`, `agradecimiento`, `despedida`, `aviso`, `solicitud_baja`

### Tabla `ia_training_examples`
- 27 ejemplos activos cubriendo los casos más comunes
- Cada ejemplo: `mensaje_usuario` + `intencion_correcta` + `respuesta_esperada` + `prioridad`
- Se gestionan desde el panel admin (Gestionar IA → Ver/Agregar/Desactivar/Eliminar)

---

## Panel Admin WhatsApp (modernizado 26/4/2026)

### Menú principal (9 opciones, máximo WhatsApp es 10)
```
🔐 Panel de Administración GARYCIO

Gestión:
  ├── Contactos nuevos (Revisar, agendar, XLS)
  └── Reclamos pendientes (Ver, resolver, limpiar)

Operación:
  ├── Resumen del día (Stats, mensajes, IA, servidor)
  └── Reporte diario PDF

Control:
  ├── Control del bot (Pausar, reiniciar, limpiar)
  ├── Estado del servidor (RAM, uptime, DB)
  ├── Capacidad del bot (Ver y ajustar límite)
  ├── Audios pendientes (Revisar y marcar atendidos)
  └── Gestionar IA (Entrenar, simular, escalar)
```

### Resumen del día (reemplazó "Resumen rápido")
Métricas accionables en un vistazo:
- Donantes activas + habilitadas en bot
- Mensajes hoy (entrantes/salientes)
- Tasa de éxito IA (resueltos vs escalados, %)
- Reclamos abiertos, bajas pendientes, audios sin atender
- Training examples activos
- Mini-status servidor (RAM + uptime)

### Reclamos — paginación + resolución
- Paginación de 10 en 10 (S=siguiente, A=anterior)
- Seleccionar por número → marcar como resuelto
- L = limpiar resueltos viejos (> 7 días)
- Total real mostrado

### Audios — paginación + bulk
- Paginación de 10 en 10
- T = marcar TODOS como atendidos (bulk)
- Seleccionar por número → marcar individual

### Control del bot — Hub de comandos
Menú desplegable con acciones reales:

| Acción | Qué hace |
|--------|----------|
| ⏸️ Pausar bot | Responde "en mantenimiento" |
| ▶️ Reanudar bot | Vuelve a atender |
| 🧹 Limpiar audios viejos | Marca > 3 días como atendidos |
| 🧹 Limpiar reclamos | Elimina resueltos > 7 días |
| 🧹 Limpiar escalaciones | Resuelve activas > 48h |
| 📋 Whitelist | Ajustar límite progresivo |

### Estado del servidor
- Status del proceso (online/paused)
- Uptime formateado
- RAM: MB usados / 1500MB (%)
- Heap memory usage
- DB size + total donantes
- Health check en vivo (llama a /health)
- Versión

### Gestionar IA
- **Simular clasificación** — prueba segura sin enviar a nadie
- **Agregar ejemplo** — wizard de 3 pasos (mensaje → intención → respuesta)
- **Ver ejemplos** — lista TODOS (✅ activos / ⏸️ inactivos) con detalle, activar/desactivar/eliminar
- **Reclasificar fallos** — corrige clasificaciones incorrectas y auto-crea training example
- **Escalaciones activas** — ver y resolver donantes escaladas
- **Feedback IA** — ver fallos e interpretaciones recientes

---

## Bugs resueltos en sesión 26/4/2026

| Bug | Fix | Archivo |
|-----|-----|---------|
| "Recibimos tu mensaje" + menú admin = doble respuesta | Cortesía solo si NO hay interactive | `handler.ts` L312-317 |
| "Control del bot" no navegaba correctamente | Títulos exactos en menuMap | `admin.ts` menuMap |
| Capacidad mostraba mensaje duplicado | `reply=""` cuando hay interactive | `admin.ts` handleCapacidadBot |
| Admin pausado por P0.13 bot-takeover | Admins exentos de pausa | `handler.ts` L178 |
| "↩️ Volver al menú" no funcionaba | Handler para todas las variantes | `admin.ts` |
| Menú devolvía menú al seleccionar opción de lista | `list_reply.id` priorizado sobre `title` | `webhook.ts` L273 |
| "Ver ejemplos" mostraba 4 botones (WhatsApp max 3) | Toggle inteligente activar/desactivar | `admin.ts` handleVerEjemplosIA |

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
| P0.13 | Pre-pausa de phones donde humano respondió últimas 24h (admins exentos) | `src/bot/conversation-manager.ts` |

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

### Sistema de capacidad first-come-first-served

- DB: tablas `donantes_bot_activos` + `configuracion_sistema (clave='LIMITE_DONANTES_BOT')`
- `activarDonanteBot` envuelto en transacción con `LOCK TABLE … SHARE ROW EXCLUSIVE`
- Política de overflow: **silencio total** (no read receipt, no typing, no respuesta)
- Menú admin WhatsApp opción "Capacidad del bot" tiene shortcuts del plan progresivo

---

## Incidente 25/4 (durante smoke test)

Al primer arranque tras hardening, problemas:
1. Cap=10 NO se aplicó → entraron 20+ donantes (bug rama legacy en `isWhitelisted`)
2. Bot procesó mensajes pendientes de horas atrás (360dialog reentregó al volver)
3. `TEST_MODE` en runtime decía `false` aunque .env decía `true` (PM2 cluster cwd ≠ raíz proyecto)
4. Race condition: 11 vs 10 con dos requests simultáneos

**Fixes aplicados:**
- Eliminada rama legacy que bypaseaba el cap
- `LOCK TABLE … SHARE ROW EXCLUSIVE` en `activarDonanteBot`
- `BOOT_TIMESTAMP_SEC` + `MAX_INBOUND_AGE_SEC=5min` en webhook
- P0.13 pre-pausa de teléfonos con outbound humano reciente al arrancar
- **Flow `nueva-donante` reescrito** con IA contextual en CADA step
- Debounce reducido **10s → 3s**

---

## Estructura de archivos clave

```
src/
├── bot/
│   ├── client.ts              ← sendMessage, sendTemplate, sendInteractive*, WHATSAPP_LIMITS
│   ├── webhook.ts             ← entry point HTTP, filtro timestamp, list_reply.id (NO title)
│   ├── handler.ts             ← processIncomingMessage: dedup, anti-spam, lock, admin exempt
│   ├── conversation-manager.ts ← state machine, dispatch flows, IA classifier, P0.9/13
│   └── flows/
│       ├── nueva-donante.ts   ← Reescrito con IA contextual
│       ├── reclamo.ts
│       ├── aviso.ts
│       ├── difusion.ts
│       ├── admin.ts           ← Panel admin modernizado (paginación, hub control, stats)
│       └── ...
├── services/
│   ├── respuesta-ia-contextual.ts ← Motor IA con training dinámico (NUEVO)
│   ├── ia-training.ts         ← CRUD training examples + cache 5min
│   ├── bot-control.ts         ← isWhitelisted, capacidad, pause/resume/emergency-stop
│   ├── bot-takeover.ts        ← P0.10 detección humana (admins exentos)
│   ├── escalation-triggers.ts ← P2.1 patrones queja/legal/baja/etc
│   ├── inbound-debounce.ts    ← P0.12 (window 3s)
│   ├── ia-cache.ts            ← P1.3 LRU
│   ├── rate-limit-adaptive.ts ← P1.6
│   ├── whatsapp-window.ts     ← P0.3 ventana 24h
│   ├── whatsapp-quality.ts    ← cron 6h
│   ├── clasificador-ia.ts     ← classifyIntent gpt-4o
│   ├── reportes-ceo.ts        ← notificarAdmins con dedup+throttle (P0.4)
│   └── ...
├── database/
│   ├── schema.ts              ← drizzle schemas: 33+ tablas
│   └── migrate.ts
├── config/
│   ├── env.ts                 ← zod-validated env, dotenv multi-path
│   └── logger.ts              ← pino
└── index.ts                   ← main: testConnection, P0.9 reset, app.listen, scheduler
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

## Step map del panel Admin (admin.ts)

| Step | Handler | Función |
|------|---------|---------|
| 0 | handleBienvenida | Menú principal interactivo |
| 1 | handleMenu | Router de opciones |
| 10-12 | handleContactosNuevos / DetalleContacto / ConfirmarActivacion | Gestión contactos nuevos |
| 20-21 | handleBuscarDonante / DetalleDonante | Búsqueda donantes |
| 30 | handleReclamosPendientes | Reclamos con paginación |
| 31 | handleAccionReclamo | Resolver/paginar/limpiar reclamos |
| 40 | handleBajasPendientes | Bajas pendientes |
| 50 | handleProgresoRutas | Progreso rutas |
| 60 | handleResultadosEncuesta | Resultados encuesta |
| 70 | handleGenerarReporte | PDF diario |
| 80 | handleRevisarFeedbackIA | IA feedback |
| 90 | handleBotControlMenu | Whitelist input handler |
| 91 | handleAgregarEjemploIA | Wizard agregar ejemplo |
| 92 | handleVerEjemplosIA | Listar todos con estado |
| 93 | handleAccionEjemploIA | Activar/desactivar/eliminar |
| 94 | handleAccionAudio | Audios: marcar/paginar/bulk |
| 95 | handleAjustarLimiteBot | Ajustar capacidad |
| 99 | handleVolverOFinalizar | Navegación genérica |
| 100 | handleGestionarIA | Hub IA dispatcher |
| 101 | handleSimularClasificacion | Simular clasificación |
| 102 | handleReclasificarFeedback | Corregir clasificaciones |
| 103 | handleVerEscalaciones | Ver escalaciones |
| 104 | handleResolverEscalacion | Resolver escalación |
| 110 | handleControlBotHub | Hub de acciones de control |
| 111 | handleEstadoServidor | Stats técnicas del servidor |

---

## Estado producción AHORA (al momento de este doc)

```
PM2: garycio-bot ONLINE (fork mode, ~170MB RAM, 1500MB limit)
DB: garycio (23MB PostgreSQL 16)
  donantes: ~6000 registrados, ~3500 activas
  donantes_bot_activos: cap=10
  ia_training_examples: 27 activos
  human_escalations: purgadas periódicamente
.env:
  TEST_MODE=false
  ADMIN_PHONES=5491126330388,393445721753
  CEO_PHONE=5491126330388
  WHATSAPP_PROVIDER=360dialog
  AI_CLASSIFIER_ENABLED=true
Infraestructura:
  Swap: 2GB activo
  Nginx: reverse proxy :80 → :3000
  UFW: solo 22, 80, 443
  PM2 memory limit: 1500MB
  SSL: pendiente (requiere dominio)
```

---

## Webhook: flujo de un mensaje entrante

```
1. POST /webhook → res.sendStatus(200) inmediato
2. Filtro antigüedad (BOOT_TIMESTAMP_SEC + MAX_AGE_SEC=5min)
3. Tipo de mensaje:
   - reaction → ignorar
   - call → ignorar
   - audio → guardar en DB + avisar CEO + pedir texto
   - sticker/video/location → "no soportado, escribí texto"
4. extractTextFromMessage:
   - text → message.text.body
   - button_reply → title (o id)
   - list_reply → ID (prioridad) luego title (fallback)
5. isWhitelisted(phone) → si no, silencio total
6. markAsReadWithTyping(messageId)
7. debounceInbound(3s) → processIncomingMessage(batched)
```

---

## Bugs conocidos / deuda

1. **API_KEY de 360dialog hardcodeada en repo histórico** — rotar cuando se pueda.
2. **Off-site backup pendiente** — solo backup local. rclone instalado, falta config destino.
3. **Sin HTTPS / SSL en nginx** — esperando dominio.
4. **pg-boss queue NO está activa** — webhook llama directo a `processIncomingMessage`.
5. **Tests de `nueva-donante`** pasan via fallback regex (no hay mock de IA).
6. **Detección "donante existente con estado='nueva'"**: si una donante real tiene datos pero `estado='nueva'`, el bot la trata como nueva. El bot responde correctamente pidiéndole que se registre, y si dice "ya soy donante", la registra como contacto nuevo para que el equipo la verifique manualmente.

---

## Plan progresivo de re-launch

| Nivel | Cap | Cuándo subir |
|---|---|---|
| 1 (ACTUAL) | 10 | Smoke con dueño + primeras donantes reales |
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

**Rollback rápido:** menú admin → "Capacidad" → ajustar a 0. Hard stop: `pm2 stop garycio-bot`.

---

## Comandos típicos de operación

```bash
# SSH
ssh root@204.168.183.96

# Estado bot
pm2 status && pm2 logs garycio-bot --lines 50 --nostream

# Dashboard
curl -H "X-Admin-Key: <KEY>" http://localhost:3000/admin/dashboard | jq

# Cambiar cap
curl -X POST -H "X-Admin-Key: <KEY>" -H "Content-Type: application/json" \
  -d '{"limite": 50}' http://localhost:3000/admin/capacidad

# Deploy nuevo código (desde local)
scp archivo.ts root@204.168.183.96:/tmp/garycio-upload/
ssh root@204.168.183.96 "cp /tmp/garycio-upload/archivo.ts /opt/garycio/src/... && cd /opt/garycio && npm run build && pm2 restart garycio-bot"

# Stop / start / restart
pm2 stop garycio-bot
pm2 start garycio-bot
pm2 restart garycio-bot

# Backup manual
/usr/local/bin/backup-garycio.sh

# DB queries útiles
sudo -u postgres psql -d garycio -c "SELECT count(*) FROM donantes WHERE donando_actualmente = true;"
sudo -u postgres psql -d garycio -c "SELECT * FROM human_escalations WHERE estado = 'activa';"
sudo -u postgres psql -d garycio -c "SELECT count(*) FROM ia_training_examples WHERE activo = true;"
```

---

## Si una IA va a tomar este proyecto desde acá

**Prioridades sugeridas en orden:**

1. **Probar el panel admin** — escribir "admin" al bot y verificar que todas las opciones funcionan (Resumen del día, Control del bot, Estado del servidor, Reclamos, Audios, Gestionar IA).
2. **Monitorear la IA** — desde Gestionar IA → Feedback IA, ver si hay fallos frecuentes y agregar training examples si es necesario.
3. **Rotar la D360-API-KEY** — queda en git history.
4. **Off-site backup** — configurar rclone destino.
5. **Cuando suba el cap a 200+** — activar pg-boss queue.
6. **HTTPS/SSL** cuando haya dominio — `certbot --nginx`.
7. **Reescribir flows `reclamo` / `aviso` / `difusion` con IA contextual** como `nueva-donante`.

**Reglas que aprendí trabajando con el dueño Emilio:**
- Bot OFF por default. NO arrancar sin permiso explícito.
- Cap progresivo, no full deploy. Empezar siempre chico y subir.
- Silencio total para donantes fuera del cap.
- Si humano respondió mientras bot apagado, bot NO toma esa conversación.
- Usar IA contextual, no flows rígidos.
- Panel admin = centro de control principal. Todo debe ser accionable desde WhatsApp.
- Nunca usar `phone` sin `normalizePhone()`.
- Nunca habilitar PM2 cluster mode sin Redis compartido.
- Todo cambio en handler.ts debe preservar: dedup → anti-spam → lock → timeout → escalation.
- Si agregás un Map en memoria, agregá cleanup periódico + hard limit.

---

## Documentos relacionados

**En el proyecto (`project-docs/`):**
- `GARYCIO_CONTEXT_HANDOFF.md` ← este documento

**En `/Users/emilioranucoli/Desktop/ADA-AUDITS/`:**
- `INFORME_INCIDENTE_GARYCIO_2026-04-23.md` — incidente original
- `EVALUACION_SENIOR_GARYCIO_2026-04-23.md` — auditoría senior
- `PROMPT_MAESTRO_GARYCIO.md` — plan original P0-P6 + credenciales
- `GARYCIO_INFORME_FINAL_P0-P2.md` — informe de P0-P2 con addendums
- `GARYCIO_AUDIT_META_COMPLIANCE.md` — auditoría de reglas Meta
- `GARYCIO_PLAN_RELANZAMIENTO_PROGRESIVO.md` — plan progresivo de cap
- `P0.8_ROTACION_SECRETOS.md` — runbook de rotación de credenciales
