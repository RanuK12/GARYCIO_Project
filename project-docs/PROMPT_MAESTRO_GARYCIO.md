# PROMPT MAESTRO — REPARACIÓN INTEGRAL DEL BOT GARYCIO

**Cómo usar este prompt:**
Pasalo completo a una IA capaz (Claude Sonnet 4.6+, GPT-5, o Opus 4.7) que tenga acceso al servidor por SSH. Que ejecute tarea por tarea en orden, sin saltarse ninguna. Después de cada tarea, que confirme con evidencia (diff, log, test output) antes de pasar a la siguiente.

---

## CONTEXTO CRÍTICO (no ignorar)

Sos un ingeniero senior encargado de reparar el bot **GARYCIO**, un sistema de WhatsApp que atiende ~6000 donantes de residuos reciclables en Argentina. El bot corre en un VPS Ubuntu 24.04 en `204.168.183.96`, con stack Node.js 22 + TypeScript 5.7 + PostgreSQL 16 + Drizzle ORM + OpenAI GPT-4o + 360dialog WhatsApp API.

**El 23 de abril de 2026 hubo un incidente grave:** por un bug en la whitelist, el bot respondió a 175 donantes reales durante 70 minutos, con 1945 errores de envío, clasificaciones erradas y escalaciones humanas perdidas por rate limit. El bot está APAGADO y no puede volver a encenderse hasta que estén hechos TODOS los arreglos P0 y validados por el dueño (Emilio).

**Tu regla número uno:** el bot **no debe responder a ninguna donante** hasta que Emilio lo autorice explícitamente. TEST_MODE debe permanecer `true` y sólo 2 teléfonos (los de los admins) pueden recibir mensajes del bot. Cualquier cambio que toque el flujo productivo debe probarse primero en un `staging` local o en otro VPS.

**Tu regla número dos:** no pidas aprobación para comandos read-only (grep, ls, logs, tests). Sí pedí confirmación antes de: reencender el bot, hacer migraciones destructivas, rotar claves, reiniciar postgres, hacer `rm -rf`, push a ramas protegidas.

**Tu regla número tres:** cada tarea completada debe cerrar con: (a) diff de los archivos tocados, (b) comando de verificación ejecutado, (c) salida esperada. Si algo no da como esperás, parás y reportás antes de seguir.

---

## ACCESO AL SERVIDOR

```
ssh root@204.168.183.96
password: Fletero91!
```

Código en `/opt/garycio`. Logs en `/opt/garycio/logs/`. Env en `/opt/garycio/.env`.

---

## TAREAS EN ORDEN ESTRICTO

### P0 — HOTFIXES BLOQUEANTES (sin esto el bot no se enciende)

#### P0.1 — Defensa en profundidad de TEST_MODE
- **Objetivo:** que sea físicamente imposible que el bot mande un mensaje a alguien que no sea admin mientras TEST_MODE=true.
- **Acciones:**
  1. Verificar que `src/bot/client.ts` tiene `assertTestWhitelist(to)` al inicio de `sendMessage`, `sendInteractiveButtons`, `sendInteractiveList`. Si falta en alguna → agregarlo.
  2. Confirmar que `src/services/bot-control.ts:isWhitelisted()` tiene corte duro a `false` cuando TEST_MODE=true y el número no está en TEST_PHONES ni es admin.
  3. Agregar **test unitario** en `tests/bot-control.test.ts` que verifique: `isWhitelisted("5491999999999")` retorna `false` con TEST_MODE=true; `isWhitelisted("393445721753")` retorna `true`.
  4. Hacer que `npm test` falle si ese test falla, y remover `--passWithNoTests` de `package.json`.
- **Verificación:** `npm test` corre y pasa. Diff incluye ambos archivos.

#### P0.2 — Respetar `isPermanent` en retries
- **Objetivo:** nunca reintentar errores 131047, 131056, 131026, 131030, 132000, 100.
- **Acciones:**
  1. Buscar la función de retry (probablemente en `src/bot/client.ts` o `src/bot/queue.ts` o `src/bot/handler.ts`). Confirmar dónde está la lógica `retry:1, retry:2, retry:3`.
  2. Antes de reintentar, verificar `if (err instanceof WhatsAppAPIError && err.isPermanent) { logger.warn(...); throw err; }`. No reintentar.
  3. Test: mockear `callWhatsAppAPI` para que lance `WhatsAppAPIError(..., 131047)`, verificar que sólo se llama 1 vez.
- **Verificación:** test pasa, diff visible.

#### P0.3 — Pre-check de ventana 24h de WhatsApp
- **Objetivo:** no intentar enviar respuesta libre si pasaron >24h del último mensaje del usuario. Si pasaron, loguear y no enviar (o enviar template aprobado cuando exista).
- **Acciones:**
  1. Agregar columna `last_customer_message_at TIMESTAMPTZ` a la tabla `donantes` o `conversation_states` (la que mejor encaje en el modelo actual). Actualizar en el webhook cada vez que llega un mensaje del usuario.
  2. Antes de `sendMessage`, leer ese timestamp. Si `now - last > 24h` → no enviar. Loguear `{level: warn, msg: "Fuera de ventana 24h, mensaje no enviado", phone}`.
  3. Agregar flag `force: true` en `sendMessage` para templates aprobados (bypass de este check).
- **Verificación:** test unitario con fecha simulada.

#### P0.4 — Throttle/coalescing de notificaciones admin
- **Objetivo:** que múltiples escalaciones al admin se agrupen en un solo mensaje cada 20 segundos, nunca disparando 131056.
- **Acciones:**
  1. Crear `src/services/admin-notifier.ts` con una cola en memoria + `setTimeout` de 20s. Cada `notifyAdmin(text)` acumula. Al expirar el timer, envía un solo mensaje con todos los ítems agrupados.
  2. Reemplazar todos los `sendMessage(adminPhone, ...)` de escalaciones/errores por `notifyAdmin(text)`.
  3. Si el mensaje agrupado supera 4096 chars (límite WhatsApp), partirlo.
  4. Test: lanzar 50 `notifyAdmin` seguidos, verificar que `sendMessage` se llama 1 sola vez después de 20s.
- **Verificación:** test pasa.

#### P0.5 — Mapper IA → enum DB + validación zod
- **Objetivo:** que nunca más un `tipo_reclamo` inválido genere `invalid input value for enum`.
- **Acciones:**
  1. Leer todos los enums de postgres relevantes: `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'tipo_reclamo'::regtype;` y otros.
  2. Crear `src/services/ia-to-db-mapper.ts` con mapas declarativos: `{ "no_pasaron": "no_pasaron", "pelela": "pelela", "multiple_issues": "otro", ...}`. Si la IA devuelve algo que no está en el mapa → devolver `"otro"` + loguear warning con el valor original.
  3. Agregar validación zod a la respuesta del clasificador IA antes de usarla. Si no matchea el schema → tratar como `confidence:low + needsHuman:true` + escalar.
- **Verificación:** test con respuesta IA inventada ("inventado_xyz") que retorna "otro" y loguea warning.

#### P0.6 — Ownership tablas PostgreSQL
- **Objetivo:** todas las tablas del schema `public` propiedad del user `garycio`.
- **Acciones:**
  1. `sudo -u postgres psql -d garycio -c "ALTER TABLE ia_training_examples OWNER TO garycio;"`
  2. Idem para `audio_mensajes`.
  3. Verificar con `\dt` que ambas aparecen con owner `garycio`.
  4. Correr el clasificador IA contra un mensaje de prueba, confirmar que no loguea "permission denied".
- **Verificación:** salida `\dt` + log limpio.

#### P0.7 — Alinear ADMIN_PHONES entre `.env` y `watchdog.sh`
- **Objetivo:** única fuente de verdad en `.env`.
- **Acciones:**
  1. Modificar `scripts/watchdog.sh` para que lea `ADMIN_PHONES` de `/opt/garycio/.env` en vez de hardcodear.
  2. Verificar que los 3 teléfonos extras que están hardcodeados hoy (`5491151042517, 5491130128112, 5491154017202`) NO deberían estar. Consultar con Emilio antes de removerlos.
- **Verificación:** diff del script + confirmación de Emilio.

#### P0.8 — Rotar secretos
- **Objetivo:** rotar todo lo que estuvo expuesto en `.env` durante el incidente y antes.
- **Acciones:**
  1. Rotar `OPENAI_API_KEY` en platform.openai.com.
  2. Rotar `WHATSAPP_TOKEN` / API key en 360dialog.
  3. Cambiar password de DB postgres y SSH (que son distintos del actual `Fletero91!`).
  4. Deshabilitar password auth de SSH, sólo key auth.
  5. Actualizar `.env` y restartear servicios. **NO reiniciar el bot.** Sólo los otros (postgres).
- **Verificación:** `cat /etc/ssh/sshd_config | grep PasswordAuth` → `no`.

---

### P1 — ESTABILIDAD Y TESTS (antes de ampliar whitelist)

#### P1.1 — Cola persistente con `pg-boss`
- **Objetivo:** que si el proceso cae, los mensajes en flight no se pierdan ni se dupliquen.
- **Acciones:**
  1. `npm install pg-boss` (usa la misma DB postgres que ya tenés, no hace falta Redis).
  2. Refactorizar webhook: recibir mensaje → `boss.send('process-message', {phone, text, messageId})` → respuesta 200.
  3. Worker separado: `boss.work('process-message', handler)`.
  4. Configurar `retryLimit: 3` en boss con `retryBackoff: exponential` PERO excluir errores permanentes.
- **Verificación:** matar el proceso a mitad de procesamiento, verificar que al reiniciar el mensaje se procesa una sola vez.

#### P1.2 — Circuit breaker para OpenAI
- **Objetivo:** si OpenAI está caído, no tirar 15s de timeout por cada mensaje.
- **Acciones:**
  1. Usar librería `opossum` o implementar circuit breaker simple: 3 fallos seguidos → abrir circuito 60s → timeout rápido.
  2. Cuando el circuito está abierto, fallback a reglas heurísticas simples (regex de saludo, palabras clave "reclamo", "gracias", "baja"). Confidence=low → escalar a humano.
  3. Loguear cambios de estado del circuito como eventos destacados.
- **Verificación:** test que simula OpenAI down, confirma que no hay timeouts largos.

#### P1.3 — Cache de clasificaciones
- **Objetivo:** si una donante manda "1" (confirmar difusión) → no llamar a GPT-4o cada vez.
- **Acciones:**
  1. Pre-clasificador heurístico: si el mensaje matchea regex conocidos (números 1-4, "ok", "gracias", "hola") → clasificación directa sin IA.
  2. Cache LRU en memoria (key = hash del mensaje normalizado) con TTL 1h.
- **Verificación:** métrica de "IA calls saved" en logs.

#### P1.4 — Tests unitarios mínimos
- **Objetivo:** cobertura >= 60% en `services/` y `bot/`.
- **Acciones:**
  1. Tests para: `isWhitelisted`, `isPermanent`, `normalizePhone`, `markAsProcessed`, `ia-to-db-mapper`, parser de webhook.
  2. Mocks de OpenAI y WhatsApp API.
- **Verificación:** `npm test -- --coverage`.

#### P1.5 — GitHub Actions CI
- **Objetivo:** que ningún commit rompa lo anterior.
- **Acciones:**
  1. Workflow `.github/workflows/ci.yml` que corre `npm run build && npm test && npm run lint` en cada PR.
  2. Bloquear merge a `main` si CI falla.
- **Verificación:** PR de prueba, CI corre.

---

### P2 — CALIDAD DE IA (antes de ampliar whitelist)

#### P2.1 — Frases gatillo de escalación forzada
- **Objetivo:** ciertas frases saltan IA y escalan directo a humano.
- **Acciones:**
  1. Lista de patterns en `src/services/escalation-triggers.ts`:
     - `/hablar con (alguien|una persona|humano)/i`
     - `/no quiero ser (donante|parte)/i`
     - `/quiero (dar.?me )?de baja/i`
     - `/POR FAVOR/` (case-sensitive)
     - `/!{3,}/`
     - Mayúsculas sostenidas >10 chars consecutivos
  2. Si matchea cualquiera → bypass IA, escalar con reason `"forced_trigger"`.
- **Verificación:** tests con los mensajes del caso 5491131017192 ("No quiero ser donante!!!!!", "Necesito hablar con alguien POR FAVOR!!!!!!") — ambos deben escalar.

#### P2.2 — Fallback por `confidence:low`
- **Objetivo:** si la IA no está segura, no improvisar.
- **Acciones:**
  1. Si `confidence === "low"` → no ejecutar flujo, escalar a humano con contexto: "mensaje no clasificable con seguridad".
- **Verificación:** test con mensaje ambiguo mockeado.

#### P2.3 — Continuidad de contexto
- **Objetivo:** si la donante escribió hace <5min, seguir el hilo en vez de reclasificar desde cero.
- **Acciones:**
  1. Antes de clasificar, leer `conversation_states` de esa donante. Si `status === "escalado_humano"` → NO responder, sólo loguear "ya escalada, humano pendiente".
  2. Si `currentFlow !== null` → seguir ese flow, no reclasificar.
- **Verificación:** test de conversación con 3 mensajes seguidos, verificar un solo escalado.

---

### P3 — POLÍTICA WHATSAPP (paralelo a P1/P2, depende de Meta)

#### P3.1 — Registrar y aprobar templates de re-engagement en Meta
- **Acciones:**
  1. Template 1: "Hola, recibimos tu mensaje. Te respondemos en breve."
  2. Template 2: "Hola {{name}}, queríamos avisarte que tu reclamo está siendo gestionado."
  3. Subirlos por panel 360dialog, esperar aprobación (48h típico).
- **Verificación:** status "APPROVED" en panel 360dialog.

#### P3.2 — Uso de templates para abrir ventana
- **Acciones:**
  1. En `client.ts` agregar `sendTemplate(phone, templateName, vars)`.
  2. Usar cuando el pre-check P0.3 detecta ventana cerrada.
- **Verificación:** test e2e con donante de prueba fuera de ventana.

---

### P4 — INFRAESTRUCTURA Y OBSERVABILIDAD

#### P4.1 — PM2 con `min_uptime` y `max_restarts`
- **Acciones:**
  1. `ecosystem.config.js`: agregar `min_uptime: '60s', max_restarts: 3, autorestart: true`.
  2. Si el bot restarta 3 veces en 60s → PM2 lo deja caído (evita restart loops).
- **Verificación:** matar el proceso 4 veces rápido, confirmar que PM2 no lo reinicia la 4ta.

#### P4.2 — Logs con rotación
- **Acciones:**
  1. `pm2 install pm2-logrotate`
  2. Config: `max_size: 10M, retain: 10, compress: true, rotateInterval: '0 0 * * *'`.
- **Verificación:** `pm2 get pm2-logrotate:max_size` = 10M.

#### P4.3 — Métricas Prometheus + Grafana
- **Acciones:**
  1. `npm install prom-client`.
  2. Exponer `/metrics` en puerto interno (no público). Métricas clave:
     - `whatsapp_errors_total{code}` — counter por código de error
     - `ia_classifications_total{intent, confidence}` — counter
     - `escalations_total{reason}` — counter
     - `openai_request_duration_seconds` — histogram
     - `bot_messages_received_total` — counter
     - `bot_messages_sent_total{status}` — counter
  3. Instalar Grafana + Prometheus en el mismo VPS (o VPS separado). Dashboard con paneles básicos.
- **Verificación:** dashboard muestra datos reales.

#### P4.4 — Alertas básicas
- **Acciones:**
  1. Alertmanager → notificar a admin si:
     - errores 131047/min > 5
     - errores 131056/min > 1
     - escalaciones sin procesar > 10
     - bot down > 2min
  2. Canal: WhatsApp al admin (usando el mismo bot) o email.
- **Verificación:** simular condición, confirmar alerta.

#### P4.5 — Nginx rate limit
- **Acciones:**
  1. En `/etc/nginx/sites-available/garycio`:
     ```nginx
     limit_req_zone $binary_remote_addr zone=webhook:10m rate=30r/s;
     location /webhook {
         limit_req zone=webhook burst=50 nodelay;
         proxy_pass http://localhost:3000;
     }
     ```
  2. `nginx -t && systemctl reload nginx`.
- **Verificación:** ataque sintético con `ab -n 1000 -c 100` → 503 después del burst.

#### P4.6 — Backups automáticos de DB
- **Acciones:**
  1. Script `/usr/local/bin/backup-garycio.sh` ya existe en cron. Verificar que: (a) corre efectivamente, (b) backups quedan guardados fuera del VPS (S3/Backblaze), (c) probar restore en VPS secundario cada 30 días.
- **Verificación:** último backup existe, restore probado.

---

### P5 — REFACTOR ESTRUCTURAL (mes 1-2, no bloqueante)

#### P5.1 — Split de `conversation-manager.ts`
Partir en: `routing.ts`, `flow-dispatcher.ts`, `intent-handlers/reclamo.ts`, `/aviso.ts`, `/consulta.ts`, `/saludo.ts`. Cada handler < 150 líneas.

#### P5.2 — Staging environment
Segundo VPS idéntico (o mismo VPS con PM2 `garycio-staging` + DB `garycio_staging`). Merge a `main` → deploy auto a staging. Merge a `release` → deploy manual a prod.

#### P5.3 — Secrets management
Mover `.env` a systemd credentials o HashiCorp Vault. Nunca commitear, nunca leer con usuarios no-root.

---

### P6 — PLAN DE RE-ENCENDIDO CONTROLADO

Una vez completo P0 + P1.1-P1.4 + P2 + P4.3 + P4.4:

**Fase A (día 1-2):** `TEST_MODE=true`, solo Emilio + Stefano. Probar manualmente:
- Saludo, agradecimiento, consulta, reclamo, baja, hablar_persona.
- Escalación con multiple_issues.
- Mensaje fuera de ventana 24h → verificar que NO se envía nada y se loguea.
- Verificar dashboard en Grafana.

**Fase B (día 3-5):** ampliar `TEST_PHONES` a 5 donantes voluntarias conocidas. Avisarles que están en beta. Monitorear en vivo.

**Fase C (día 6-10):** ampliar a 20 donantes/día con operador humano de guardia las primeras 12h.

**Fase D (día 10+):** apertura general sólo con dashboard activo + operador de guardia primeras 72h.

**Criterios de "go" antes de cada fase:**
- Cero errores 131047 en la fase anterior.
- Cero errores 131056 en la fase anterior.
- Escalaciones procesadas dentro de 2 min.
- Tasa de `confidence:low` < 10%.

---

## CÓMO REPORTAR PROGRESO

Después de cada tarea Pn.m:
```
✅ P0.1 completado
Archivos modificados: src/bot/client.ts, tests/bot-control.test.ts, package.json
Diff: <diff resumido>
Test ejecutado: npm test -- bot-control
Salida: PASS bot-control.test.ts (3 tests)
Próximo: P0.2
```

Si una tarea no puede completarse por decisión de negocio o info faltante, detenete y preguntá a Emilio. No improvises.

---

## FILOSOFÍA GUÍA (repetir en voz alta antes de cada cambio)

> "Este bot atiende a 6000 personas reales que ya fueron traicionadas una vez.
> Si dudás entre ser útil y ser seguro, elegí seguro.
> Un bot que no responde es mil veces mejor que un bot que responde mal.
> Cada mensaje enviado es una conversación que afecta a una persona real."
