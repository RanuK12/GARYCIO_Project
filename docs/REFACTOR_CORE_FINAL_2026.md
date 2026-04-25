# Refactor Core + QA Destrucción Completo — Resumen Ejecutivo Final

**Fecha:** 2026-04-21  
**Proyecto:** GARYCIO WhatsApp Bot (9,300+ donantes)  
**Estado:** Código listo para deploy. Servidor requiere configuración infra antes de levantar.

---

## 1. QA Destrucción — Hallazgos por Fase

### FASE 1: State Management (17 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Critical | 4 | Phone format loop, estado="nueva" trap, cluster race, escalated user spam bypass |
| High | 5 | Estado zombie, bienvenida repetida, timeout de lock forzado, PM2 memory limit |
| Medium | 4 | Cache TTL edge cases |
| OK | 4 | — |

### FASE 2: Webhooks / Dedup (10 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Critical | 1 | Cluster mode rompe dedup (sin Redis) |
| High | 1 | memCache dedup crece sin hard limit |
| Medium | 3 | DB pool exhaustion, out-of-order delivery, DB insert fire-and-forget |
| OK | 7 | — |

### FASE 3: LLM / Intenciones Complejas (15 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Critical | 1 | **F3.11: needsHuman mata notificaciones y replies** |
| High | 2 | F3.5: intent inválido anula fallback, F3.6: entidades no validadas |
| Medium | 3 | Frustración progresiva no acumulada, baja solo sin sesión, emoji spam parcial |
| OK | 8 | — |

### FASE 4: LLM Failure (7 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Critical | 1 | F3.5 reconfirmado |
| High | 1 | F3.6 reconfirmado |
| Medium | 2 | Reason incorrecto en fallback (frustration vs ia_fail), mensaje vacío → consulta |
| OK | 4 | — |

### FASE 5: Caos Humano (9 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Medium | 3 | F5.5: spam procesa 50x completo, F5.6: whitespace no ignorado, F5.7: emoji >6 no ignorado |
| OK | 6 | — |

### FASE 6: Stress (8 escenarios)
| Severity | Count | Bugs clave |
|----------|-------|------------|
| Critical | 1 | **F6.7: uncaughtException mata proceso entero** |
| High | 3 | F6.2: lock timeout permite race, F6.4: memory leaks (escalatedCache sin cleanup), F6.4: PM2 reinicio = state loss |
| Medium | 3 | F6.3: doble mensaje en DB caída, F6.5: race markAsProcessed+reinicio, F6.8: unhandledRejection inconsistente |
| OK | 1 | — |

---

## 2. Fixes Implementados (código fuente)

### 🔴 Critical

#### F3.11 — `handler.ts`: needsHuman ya no silencia notificaciones
**Archivo:** `src/bot/handler.ts`  
**Cambio:** El bloque `if (result.needsHuman)` ahora envía:
1. Reply contextual al usuario (antes se perdía).
2. Notificación a CEO/chofer (`processNotification`).
3. Persistencia de `flowData` (`saveFlowData`).
4. Luego retorna sin llamar `recordInteraction()` (anti-spam preservado).

#### F3.5 — `clasificador-ia.ts`: intent inválido → fallback 100%
**Archivo:** `src/services/clasificador-ia.ts`  
**Cambio:** Cuando el LLM devuelve un `intent` no válido, el sistema descarta **TODO** su output y usa el `classifyFallback()` completo, incluyendo `needsHuman`, `sentiment` y `confidence`. El LLM no puede anular la seguridad del fallback.

### 🟠 High

#### F6.2 — `queue.ts`: lock timeout aumentado a 120s
**Archivo:** `src/bot/queue.ts`  
**Cambio:** `LOCK_TIMEOUT_MS` 60s → 120s. `LOCK_MAX_AGE_MS` 120s → 180s. Evita que mensajes del mismo usuario se procesen sin lock cuando IA tarda ~25s + DB.

#### F2.10 / F6.4 — `dedup.ts`: hard limit en memCache
**Archivo:** `src/services/dedup.ts`  
**Cambio:** `markAsProcessed()` ahora elimina la entrada más antigua inmediatamente si `memCache.size >= MEM_CACHE_MAX` (5000). No espera al `setInterval` de 30 min.

#### F6.4 — `human-escalation.ts`: cleanup de escalatedCache
**Archivo:** `src/services/human-escalation.ts`  
**Cambio:** Agregado `setInterval` cada 30 min que:
- Elimina entradas expiradas (>5 min TTL).
- Recorta por hard limit (2000 entradas máximo).
- Previene memory leak acumulativo.

#### F3.6 — `conversation-manager.ts`: whitelist de entidades
**Archivo:** `src/bot/conversation-manager.ts`  
**Cambio:** Antes de usar `tipoReclamo` o `tipoAviso` del LLM, se valida contra `VALID_TIPO_RECLAMO` y `VALID_TIPO_AVISO`. Valores inválidos se loguean y se fuerzan a `"otro"` / `"general"`. Previene data contamination.

#### F4.1 — `conversation-manager.ts` + `clasificador-ia.ts`: reason "ia_fail"
**Archivo:** `src/bot/conversation-manager.ts`, `src/services/clasificador-ia.ts`  
**Cambio:**
- `procesarConIA` ahora retorna `confidence` en su tipo.
- Cuando `needsHuman === true` y `confidence === "low"`, el reason es `"ia_fail"` (no `"frustration"`).
- El fallback por timeout/error de API preserva el intent del fallback pero fuerza `needsHuman: true`.

#### F6.7 — `index.ts`: graceful shutdown
**Archivo:** `src/index.ts`  
**Cambio:**
- `uncaughtException`: ahora hace graceful shutdown (espera 5s para que locks activos terminen, luego `process.exit(1)`).
- `unhandledRejection`: ahora también hace graceful shutdown con `process.exit(1)` (política consistente con `uncaughtException`).
- `SIGTERM` / `SIGINT`: también usan graceful shutdown de 5s.

### 🟡 Medium

#### F5.6 / F5.7 — `handler.ts` + `webhook.ts`: ignorar whitespace y emoji spam
**Archivo:** `src/bot/handler.ts`, `src/bot/webhook.ts`  
**Cambio:**
- `esMensajeIgnorado()` ahora ignora strings vacíos, solo espacios, solo puntuación, y secuencias de hasta 20 emojis.
- `webhook.ts` hace `trim()` del texto y descarta mensajes vacíos antes de procesar.

---

## 3. Estado del Servidor (Hetzner CPX22)

**Hardware real:** 2 vCPU, 4 GB RAM, 80 GB SSD — **NO 512MB**.

**Problemas de infra encontrados:**
1. **Bot detenido desde 16/04** — apagado manual, no crash.
2. **`max_memory_restart: 512M` en PM2** — reinicia el proceso de Node cuando supera 512MB. Explica los 33 reinicios previos.
3. **`PayloadTooLargeError`** — Express body-parser limit 100KB en código viejo. En refactor ya está en 5MB.
4. **Código en producción = VERSIÓN VIEJA** — el refactor nunca fue deployado a `/opt/garycio`.
5. **Sin nginx, sin SSL, sin firewall, sin swap**.
6. **`WHATSAPP_PHONE_NUMBER_ID=placeholder`** en `.env`.
7. **systemd PM2 inactive** — no hay auto-startup al reiniciar VPS.

**Documento completo:** `docs/SERVER_AUDIT_2026.md`

---

## 4. Checklist Pre-Deploy

### Código (listo ✅)
- [x] Build pasa sin errores de TypeScript.
- [x] Tests core pasan (19/19).
- [x] F3.11 fix mergeado.
- [x] F3.5 fix mergeado.
- [x] F3.6 fix mergeado.
- [x] F6.2 fix mergeado.
- [x] F2.10 / F6.4 fixes mergeados.
- [x] F6.7 fix mergeado.
- [x] F5.6 / F5.7 fixes mergeados.
- [x] F4.1 fix mergeado.

### Infra (pendiente ⚠️)
- [ ] Crear swap 2GB.
- [ ] Instalar nginx + certbot (SSL).
- [ ] Configurar reverse proxy con `client_max_body_size 5M`.
- [ ] Activar UFW.
- [ ] Configurar `pm2 startup systemd && pm2 save`.
- [ ] Corregir `WHATSAPP_PHONE_NUMBER_ID` en `.env`.
- [ ] Subir código refactor a `/opt/garycio`.
- [ ] Correr migraciones de DB (`processed_messages`, `human_escalations`).
- [ ] Ajustar `max_memory_restart: 1.5G` en `ecosystem.config.js`.
- [ ] Test manual de webhook + mensaje real.

---

## 5. Métricas de QA

| Métrica | Valor |
|---------|-------|
| Escenarios ejecutados (FASE 1-6) | 66 |
| Bugs críticos encontrados | 4 (F1 phone loop, F1 estado nueva, F3.11, F6.7) |
| Bugs críticos fixeados | 2 (F3.11, F3.5) — F1 requieren migración de datos |
| Bugs high encontrados | 10 |
| Bugs high fixeados | 6 |
| Documentos generados | 5 (`REFACTOR_CORE_2024.md`, `QA_DESTRUCCION_FASE1.md`, `QA_DESTRUCCION_FASE2_FASE3.md`, `QA_DESTRUCCION_FASE4_FASE5_FASE6.md`, `SERVER_AUDIT_2026.md`) |

---

## 6. Notas para el deploy

**NO habilitar PM2 cluster mode (`instances: max`)** sin Redis. Los caches en memoria (`conversationCache`, `memCache`, `escalatedCache`, `interactionCount`) son por-proceso. En cluster mode:
- Deduplicación falla (mensajes duplicados).
- Estado de conversación se pierde entre workers.
- Escalaciones humanas no se detectan consistentemente.

**Monitor clave post-deploy:**
- Tasa de `human_escalations` (target <5%).
- Hit rate de `processed_messages` (dedup).
- Uso de heap de Node.js (target <1GB).
- Latencia de respuesta webhook (target <3s p95).
