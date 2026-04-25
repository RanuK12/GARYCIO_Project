# AGENTS.md — GARYCIO WhatsApp Bot

> Documento vivo para agentes de código. Actualizado: 2026-04-22.

---

## Estado del Proyecto

**Versión:** 0.2.0 (refactor core completo)  
**Stack:** Node.js 22, TypeScript, Express 4, PostgreSQL 16 (Drizzle ORM), PM2, Pino  
**Servidor:** Hetzner CPX22 — 2vCPU, 4GB RAM, 80GB SSD, Ubuntu 24.04  
**IP:** `204.168.183.96`  
**Path producción:** `/opt/garycio`

**Estado actual:** Bot **DETENIDO**. Todo configurado y corregido. Listo para levantar con `pm2 start garycio-bot` cuando la empresa dé el OK.  
**Backup código viejo:** `/opt/garycio-backup-20260422`

---

## QA Destrucción Completado (66 escenarios, 6 fases)

Documentos:
- `docs/QA_DESTRUCCION_FASE1.md` — State Management
- `docs/QA_DESTRUCCION_FASE2_FASE3.md` — Webhooks/Dedup + LLM/Intenciones
- `docs/QA_DESTRUCCION_FASE4_FASE5_FASE6.md` — LLM Failure + Caos Humano + Stress
- `docs/SERVER_AUDIT_2026.md` — Auditoría infraestructura
- `docs/VERIFICACION_FINAL_2026.md` — Verificación post-deploy

---

## Fixes Implementados (código)

### 🔴 Critical
1. **F3.11 — `handler.ts` needsHuman early return**  
   Ahora envía reply contextual + notificación CEO/chofer + `saveFlowData` antes de retornar. Anti-spam preservado (no llama `recordInteraction`).

2. **F3.5 — `clasificador-ia.ts` intent inválido**  
   Cuando el LLM devuelve un `intent` no válido, se descarta **TODO** su output y se usa `classifyFallback()` 100% (incluyendo `needsHuman`, `sentiment`, `confidence`).

3. **F1.1 — Phone format loop**  
   Nuevo `src/utils/phone.ts` con `normalizePhone()`. Canonicaliza a formato `54911XXXXXXXX` (sin `+`). Aplicado en webhook, handler, contacto-donante, flows.

4. **F1.2 — Estado "nueva" trap**  
   `lookupRolPorTelefono()` devuelve `{ rol: "donante", estado }` para `estado === "nueva"`. `conversation-manager.ts` redirige al flow `nueva_donante` en lugar de loop infinito.

### 🟠 High
5. **F6.2 — Lock timeout** (`queue.ts`): 60s → **120s**
6. **F2.10/F6.4 — memCache dedup hard limit** (`dedup.ts`): Eviction inmediata si `size >= 5000`
7. **F6.4 — escalatedCache cleanup** (`human-escalation.ts`): `setInterval` 30min + hard limit 2000
8. **F3.6 — Entidades whitelist** (`conversation-manager.ts`): `VALID_TIPO_RECLAMO` y `VALID_TIPO_AVISO`
9. **F4.1 — Reason "ia_fail"** (`conversation-manager.ts` + `clasificador-ia.ts`): `confidence === "low"` → reason `"ia_fail"`
10. **F6.7 — Graceful shutdown** (`index.ts`): 5s de espera antes de `process.exit(1)` en `uncaughtException` / `unhandledRejection`
11. **F5.5 — Spam anti-IA** (`handler.ts`): Contador de mensajes entrantes (`incomingCount`). Rechazo a los 20 mensajes/30min.
12. **F5.6/F5.7 — Whitespace/emoji spam** (`handler.ts` + `webhook.ts`): Ignora vacío, solo espacios, puntuación, y secuencias de hasta 20 emojis.
13. **F6.3 — Doble mensaje DB caída** (`handler.ts`): Eliminado `sendMessage` duplicado en catch global. `escalateToHuman()` es la única fuente de mensaje al usuario.

### 🟡 Medium
14. **Tests de flujos** (`env.ts`): No hace `process.exit(1)` cuando `NODE_ENV === "test"`

---

## Infraestructura Configurada

| Componente | Estado | Notas |
|------------|--------|-------|
| Swap | ✅ 2GB | `/swapfile` |
| Nginx | ✅ Activo | Reverse proxy `localhost:3000`, `client_max_body_size 5M` |
| UFW | ✅ Activo | Solo 22, 80, 443 |
| PM2 startup | ✅ Configurado | `pm2 startup systemd && pm2 save` |
| PM2 memory limit | ✅ 1500M | Antes 512M (causa de 33 reinicios) |
| PostgreSQL | ✅ 16 | DB `garycio` 23MB |
| SSL/Let's Encrypt | ⏳ Pendiente | Requiere dominio + OK empresa |

---

## Stress Tests Superados

- **100 usuarios × 10 mensajes = 1,000**: 200 OK, 0 errores, 355 RPS, p95=549ms
- **Mismo usuario × 20 mensajes seguidos**: 200 OK, 0 errores, lock serializa correctamente
- Memoria post-test: 174MB (límite 1500M)

---

## Decisiones Críticas de Arquitectura

### NO habilitar PM2 cluster mode sin Redis
Los caches en memoria (`conversationCache`, `memCache`, `escalatedCache`, `interactionCount`) son por-proceso. En cluster mode:
- Deduplicación falla
- Estado de conversación inconsistente
- Escalaciones no detectadas consistentemente

### DB es fuente de verdad; memoria es acelerador
- `conversationCache` = acelerador. Si se reinicia, se re-hidrata de `conversation_states`.
- `memCache` dedup = acelerador. Si se reinicia, fallback a `processed_messages`.
- `escalatedCache` = acelerador. Si se reinicia, fallback a `human_escalations`.

### Phone normalization obligatorio
Todo número que entra al sistema pasa por `normalizePhone()` antes de cualquier lookup o insert.

---

## Checklist Pre-Deploy Público

- [ ] Reemplazar `WHATSAPP_PHONE_NUMBER_ID=placeholder` por ID real de 360dialog
- [ ] Verificar `WHATSAPP_TOKEN` = D360-API-KEY correcto
- [ ] Cambiar `TEST_MODE=true` → `false`
- [ ] Limpiar `TEST_PHONES` o mantener solo internos
- [ ] Configurar dominio + certbot (`certbot --nginx -d dominio.com`)
- [ ] Configurar webhook en 360dialog: `https://dominio.com/webhook`
- [ ] Normalizar teléfonos existentes en DB (script SQL en `docs/VERIFICACION_FINAL_2026.md`)
- [ ] Opcional: limpiar `processed_messages` y `conversation_states` de pruebas
- [ ] Monitorear `human_escalations` rate (<5% target)

---

## Estructura de Código Relevante

```
src/
  utils/phone.ts              # Normalizador de teléfonos (NUEVO)
  config/env.ts               # Variables de entorno (zod schema)
  config/logger.ts            # Pino logger
  database/
    schema.ts                 # Drizzle schema (+ processed_messages, human_escalations)
    migrate.ts                # SQL migrations
  bot/
    webhook.ts                # Express router WhatsApp (normaliza phone, ignora vacío)
    handler.ts                # Failsafe ingress (dedup, anti-spam, lock, timeout, escalation)
    conversation-manager.ts   # State machine persistente (DB source of truth)
    queue.ts                  # Per-user mutex (120s timeout)
    flows/                    # Flow handlers
  services/
    clasificador-ia.ts        # Strict LLM router (temp 0, JSON mode, fallback regex)
    dedup.ts                  # LRU mem + DB (hard limit 5000)
    human-escalation.ts       # Circuit breaker (cleanup cada 30min)
    contacto-donante.ts       # Auto-registro + lookup con normalización
  index.ts                    # Express app + admin endpoints + graceful shutdown
```

---

## Comandos Útiles

```bash
# SSH al servidor
ssh root@204.168.183.96

# Bot
pm2 status
pm2 logs garycio-bot --lines 50
pm2 restart garycio-bot
pm2 monit

# Health local
curl http://localhost:3000/health

# DB
sudo -u postgres psql -d garycio -c "SELECT * FROM human_escalations WHERE estado = 'activa';"
sudo -u postgres psql -d garycio -c "SELECT count(*) FROM processed_messages;"
sudo -u postgres psql -d garycio -c "SELECT count(*) FROM conversation_states;"

# Build (local o servidor)
npm run build

# Tests (excluir flujos pre-existentes)
npx jest --testPathIgnorePatterns='tests/flows' --forceExit
```

---

## Reglas para Futuros Agentes

1. **Nunca uses `phone` sin `normalizePhone()`** en lookups, inserts, o comparaciones.
2. **Nunca habilites `instances: max` en PM2** sin Redis compartido.
3. **Todo cambio en handler.ts debe preservar:** dedup → anti-spam → lock → timeout → escalation.
4. **Todo cambio en clasificador-ia.ts debe mantener:** temp 0, JSON mode, fallback deterministico.
5. **Si modificás tablas en schema.ts, actualizá migrate.ts.**
6. **Si agregás un Map en memoria, agregá cleanup periódico + hard limit.**
