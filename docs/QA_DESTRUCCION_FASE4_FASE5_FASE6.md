# QA Destrucción — FASE 4 (LLM Failure) + FASE 5 (Caos Humano) + FASE 6 (Stress)

**Fecha:** 2026-04-21  
**Código base:** Post-refactor (`src/services/clasificador-ia.ts`, `src/bot/handler.ts`, `src/bot/conversation-manager.ts`, `src/services/dedup.ts`, `src/services/human-escalation.ts`, `src/bot/queue.ts`, `src/index.ts`)

---

## TL;DR — Score General

| FASE | OK | Medium | High | Critical |
|------|-----|--------|------|----------|
| F4 LLM Failure | 4 | 1 | 1 | 1 |
| F5 Caos Humano | 5 | 3 | 0 | 0 |
| F6 Stress | 1 | 3 | 3 | 1 |
| **Total** | **10** | **7** | **4** | **2** |

**Nuevos bugs críticos:**
- **F4.3 + F3.5:** LLM con intent inválido + `needsHuman: false` anula la seguridad del fallback regex.
- **F6.7:** `uncaughtException` con `process.exit(1)` mata todo el proceso por un solo bug, perdiendo todos los mensajes en vuelo.

**Nuevos bugs high:**
- **F6.2:** 5 mensajes rápidos del mismo usuario + IA lenta = el 4to mensaje se procesa SIN lock (race condition en estado).
- **F6.4:** Memory leaks de Maps (cache, dedup, escalación) crecen indefinidamente. PM2 reinicia a 512MB = pérdida de estado.
- **F3.6 (reconfirmado):** Entidades del LLM no validadas. Valor `"DROP TABLE"` se inyecta en notificaciones.
- **F3.11 (reconfirmado):** `needsHuman` early return en `handler.ts` silencia replies contextuales y notificaciones.

---

## FASE 4 — LLM FAILURE

### F4.1 Timeout de OpenAI (>8s)
**Simulación:** API tarda 10s. `AbortController` dispara a los 8s. `catch(AbortError)` → `classifyFallback()`.

**Flujo real:**
1. Fallback devuelve `intent` según regex + `needsHuman: true`.
2. `procesarConIA` llama `escalateToHuman(phone, "frustration", ...)`.
3. `escalateToHuman` envía mensaje al usuario y notifica al CEO.
4. `handler.ts` retorna early por `needsHuman: true` (Bug F3.11).
5. El reply contextual del fallback (ej: "Recibimos tu mensaje...") **nunca se envía**.

**Veredicto:** 🟡 **MEDIUM** — Fallback funciona, escalación ocurre, usuario recibe mensaje seguro. PERO:
- El `reason` guardado en DB es `"frustration"` en lugar de `"ia_fail"` (incorrecto para auditoría).
- El reply contextual se pierde por F3.11.

---

### F4.2 Respuesta JSON roto (SyntaxError)
**Simulación:** LLM devuelve `{ "intent": "reclamo", ...` sin cerrar. `JSON.parse` falla.

**Flujo real:**
- `catch(SyntaxError)` → `classifyFallback()` con `needsHuman: true`.
- Mismo camino que F4.1.

**Veredicto:** 🟡 **MEDIUM** — Igual que F4.1. Fallback funciona pero reason incorrecto.

---

### F4.3 🔴 CRITICAL — Output incoherente: intent inválido + `needsHuman: false`
**Simulación:** LLM responde `{ "intent": "quiero_pizza", "needsHuman": false }` para el mensaje `"dame de baja"`.

**Flujo real (`clasificador-ia.ts:160-178`):**
```typescript
if (VALID_INTENTS.includes(parsed.intent)) {
  intent = parsed.intent;
} else {
  intent = classifyFallback(message).intent;  // "baja"
}
return {
  intent,
  needsHuman: !!parsed.needsHuman,  // ← FALSE (del LLM)
  ...
};
```

- `intent` se corrige a `"baja"` (del fallback).
- `needsHuman` se toma del LLM: **`false`**.
- El fallback de `"dame de baja"` hubiera dicho `needsHuman: true`.
- Esa seguridad se **anula**.

**Downstream:**
- `procesarConIA` NO llama `escalateToHuman`.
- `handler.ts` NO retorna early.
- El usuario recibe el template de `"baja"`: *"Lamentamos que quieras dejar de participar..."* sin escalación.
- El CEO no es notificado.
- La baja queda en manos del bot, no de un humano.

**Veredicto:** 🔴 **CRITICAL — Bug F3.5 confirmado.** Cuando el LLM devuelve un intent inválido, el sistema debería descartar TODO su output (incluyendo `needsHuman`) y confiar 100% en el fallback.

---

### F4.4 OpenAI devuelve HTTP 429 / 500
**Simulación:** Rate limit o error interno de OpenAI.

**Flujo real:**
- `response.ok` es false.
- `return { ...classifyFallback(message), needsHuman: true, confidence: "low" }`.
- `needsHuman: true` forzado.

**Veredicto:** ✅ **OK** — Degradación graceful. Fallback con escalación forzada.

---

### F4.5 API key no configurada / AI deshabilitado
**Simulación:** `env.OPENAI_API_KEY` está vacío.

**Flujo real:**
- `classifyIntent` retorna `classifyFallback(message)` inmediatamente.
- Sin llamada de red.

**Veredicto:** ✅ **OK** — Operación 100% offline. Deterministico.

---

### F4.6 AbortController leak
**Análisis:**
- `timeoutId` se crea en línea 115.
- `clearTimeout(timeoutId)` está en el `try` (línea 141) y en ambos `catch` (líneas 180, 186).
- No hay path donde el timeout se quede colgado.

**Veredicto:** ✅ **OK**

---

### F4.7 Fallback para mensaje vacío
**Simulación:** `classifyFallback("")`.

**Flujo real:**
- `lower = ""`.
- No match en ningún pattern.
- Default: `{ intent: "consulta", needsHuman: false, confidence: "low" }`.

**Problema:** Un mensaje vacío debería ser `irrelevante`, no `consulta`.

**Veredicto:** 🟡 **MEDIUM** — No crítico, pero genera respuesta innecesaria.

---

## FASE 5 — USUARIOS REALES (CAOS HUMANO)

### F5.1 Errores tipográficos graves
**Mensaje:** `"keiro dejar de donar"` (typo en "quiero").

**Flujo real:**
- `detectarIntenciónBaja`: busca `"quiero dejar de donar"` exacto. "keiro" no matchea.
- Fallback: `"keiro"` no está en ningún pattern. Default `consulta`.

**Resultado:** El usuario con dislexia o typo no es detectado.  
**Veredicto:** 🟡 **MEDIUM** — Falta fuzzy matching básico.

---

### F5.2 Mensaje con espacios y saltos de línea excesivos
**Mensaje:** `"\n\n  Hola   \n\n  Como   estas \n\n"`

**Flujo real:**
- `.trim().toLowerCase()` limpia todo.
- Fallback match "hola" → `saludo`.

**Veredicto:** ✅ **OK**

---

### F5.3 Audio transcrito mal (texto simulado)
**Mensaje:** `"Eh... no sé... pasaron... el... el... bidón... no... está..."`

**Flujo real:**
- Fallback: `"no"` + `"pasaron"` + `"bidon"` → `hasReclamo = true`.
- `"no está"` no matchea `falta_bidon` exactamente en fallback.
- `tipoReclamo` = `"otro"`.

**Veredicto:** ✅ **OK** — Detecta reclamo. Entidad genérica, aceptable para audio mal transcrito.

---

### F5.4 Usuario mayor confundido — mensaje largo y desestructurado
**Mensaje:** *"Mire yo soy la señora de la casa de al lado mi hija me dijo que ustedes pasan los lunes pero el lunes pasado no pasaron y ahora tengo todo acumulado y mi nuera que vive en otra calle dice que le pasan los jueves entonces yo quiero que me pasen los jueves también o si no los lunes pero que pasen seguro porque ya no me cabe más nada en el patio"*

**Flujo real:**
- Fallback: `"no pasaron"` → `hasReclamo = true`. No detecta `"quiero que me pasen los jueves"` como aviso de cambio de día.
- `intentCount = 1` → no `multiple_issues`.
- LLM: debería detectar múltiples intenciones → `multiple_issues`.

**Veredicto:** ✅ **OK** (si LLM funciona) / 🟡 **MEDIUM** (si LLM falla y fallback domina).

---

### F5.5 Spam — 50 mensajes seguidos del mismo usuario
**Flujo real:**
- `checkCooldown`: solo responde 1 vez cada 30s.
- `checkMaxInteractions`: después de 12 respuestas en 30min, notifica al CEO y bloquea.
- PERO: los mensajes se procesan igual (IA + DB), solo no se envía reply.
- El procesamiento consume CPU/DB/tokens de OpenAI.

**Veredicto:** 🟡 **MEDIUM** — El sistema no colapsa, pero procesa 50 mensajes completos innecesariamente. Debería rechazar ANTES de llamar a la IA.

---

### F5.6 🟡 MEDIUM — Mensaje vacío o solo espacios
**Simulación:** Usuario envía `"   "` (espacios).

**Flujo real (`webhook.ts`):**
```typescript
const text = extractTextFromMessage(message);  // "   "
if (!phone || !text) continue;  // "   " es truthy → NO se salta
```

**En `handler.ts`:**
- `esMensajeIgnorado("   ")` → `clean = ""` → `MENSAJES_IGNORADOS.has("")` → `false`.
- No es emoji.
- Procesa como mensaje normal → `classifyFallback` → `consulta`.
- Envía reply "Recibimos tu mensaje..." al usuario.
- Consume token de OpenAI si LLM está activa.

**Veredicto:** 🟡 **MEDIUM** — Mensaje vacío/whitespace genera respuesta innecesaria. Debería ser ignorado.

---

### F5.7 🟡 MEDIUM — Emoji spam (>6 emojis)
**Mensaje:** `"😂😂😂😂😂😂😂"` (7 emojis).

**Flujo real:**
- `esMensajeIgnorado`: regex `/^[\p{Emoji}]{1,6}$/u` → **false** (son 7).
- `classifyFallback`: mismo regex → **false**.
- Procesa como `consulta`.

**Veredicto:** 🟡 **MEDIUM** — 7+ emojis no son ignorados. Debería ser `irrelevante` para cualquier cantidad razonable.

---

### F5.8 Mayúsculas agresivas
**Mensaje:** `"NO PASARON HACE 3 SEMANAS"`

**Flujo real:**
- `toLowerCase()` → match `"no pasaron"` + `"hace semanas"` → `angry`, `needsHuman: true`.

**Veredicto:** ✅ **OK**

---

### F5.9 Mensaje en inglés
**Mensaje:** `"Hello, I want to donate"`

**Flujo real:**
- Fallback: no match → default `consulta`.
- LLM (gpt-4o-mini): probablemente entiende inglés.

**Veredicto:** ✅ **OK** (depende de LLM, fallback seguro).

---

## FASE 6 — STRESS TEST

### F6.1 100 mensajes concurrentes de usuarios distintos
**Flujo real:**
- `webhook.ts` itera sin `await` → 100 callbacks en el event loop.
- Locks por usuario son independientes → procesamiento paralelo máximo.
- PostgreSQL pool por defecto = 10 conexiones. 100 queries concurrentes = 90 en cola.

**Veredicto:** 🟡 **MEDIUM** — Cuello de botella en el pool de DB. No hay race condition entre usuarios distintos, pero latencia aumenta. No hay configuración visible del tamaño del pool.

---

### F6.2 🟠 HIGH — 5 mensajes rápidos del MISMO usuario con IA lenta
**Simulación:**
- Msg 1: toma 25s (timeout de handler) + 2s de catch/escalación/DB = 27s total.
- Msg 2: espera 27s.
- Msg 3: espera 54s.
- Msg 4: espera 81s > `LOCK_TIMEOUT_MS = 60s`.

**Flujo real (`queue.ts:42`):**
```typescript
if (remaining <= 0) {
  logger.warn({ phone }, "Lock timeout esperando — procesando de todos modos (posible duplicado)");
  break;
}
```

- Msg 4 **rompe el loop** y se procesa **sin lock**.
- Msg 5 también sin lock.
- Ambos leen/escriben estado simultáneamente = **race condition**.

**Veredicto:** 🟠 **HIGH** — Estado de conversación se corrompe. Pasos se sobreescriben. Mensajes duplicados posibles.

---

### F6.3 🟡 MEDIUM — DB caída durante procesamiento
**Flujo real:**
1. `handleIncomingMessage` lanza excepción por DB caída.
2. `handler.ts` catch global → `escalateToHuman(phone, "system_error", {error})`.
3. `escalateToHuman` intenta insertar en `humanEscalations` → DB caída → **falla silenciosamente** (catch interno).
4. `escalateToHuman` envía mensaje al usuario → **OK** (no necesita DB).
5. `escalateToHuman` notifica al CEO → **OK**.
6. `handler.ts` envía mensaje fijo al usuario: *"Derivando tu caso a un representante..."*

**Resultado:** El usuario recibe **DOS mensajes** (el de `escalateToHuman` + el del catch de `handler.ts`).

**Veredicto:** 🟡 **MEDIUM** — Doble mensaje confuso para el usuario. No es crítico pero es mala UX.

---

### F6.4 🟠 HIGH — Memory leaks bajo carga
**Análisis:**
Los siguientes `Map` crecen indefinidamente hasta cleanup periódico:

| Map | Límite | Cleanup | Riesgo |
|-----|--------|---------|--------|
| `conversationCache` | 2000 | 1h | Medio |
| `memCache` (dedup) | 5000 (soft) | 30min | **Alto** |
| `escalatedCache` | Ninguno | Ninguno | **Alto** |
| `interactionCount` | Ninguno | 1h | Medio |
| `lastResponseTime` | Ninguno | 1h | Medio |
| `unsupportedMediaCooldown` | Ninguno | 1h | Bajo |

- `escalatedCache` en `human-escalation.ts` **nunca se limpia**. Si se escalan 10,000 usuarios, el Map crece para siempre.
- `max_memory_restart: 512M` en PM2 reinicia el proceso cuando Node supera 512MB.
- Cada reinicio = **pérdida de todo**:
  - `conversationCache` → state loss hasta que se re-lean de DB.
  - `memCache` (dedup) → duplicados posibles hasta que DB los atrape.
  - `escalatedCache` → usuarios escalados pueden recibir respuestas automáticas hasta que se re-lea de DB.

**Veredicto:** 🟠 **HIGH** — Memory leaks documentados + reinicios frecuentes = estado inconsistente.

---

### F6.5 🟡 MEDIUM — Race en `markAsProcessed` + reinicio
**Simulación:**
1. `markAsProcessed(messageId)` setea `memCache` y lanza `db.insert` fire-and-forget.
2. Proceso se reinicia 5ms después.
3. `db.insert` nunca llega.
4. Mismo `message_id` llega de nuevo.
5. `isDuplicate` → memCache vacío (reinicio) → DB miss → **mensaje duplicado procesado**.

**Veredicto:** 🟡 **MEDIUM** — Window de riesgo de milisegundos. Aceptable pero documentable.

---

### F6.6 🟡 MEDIUM — Lock zombie cleanup libera locks lentos pero vivos
**Simulación:**
- `fn()` dentro de `withUserLock` tarda 130s (DB bloqueada + IA lenta).
- Cleanup (cada 5 min) elimina el lock porque `age > 120s`.
- `fn()` sigue corriendo.
- Próximo mensaje del mismo usuario entra SIN lock.
- Ambos procesan estado simultáneamente.

**Veredicto:** 🟡 **MEDIUM** — El cleanup evita deadlock permanente, pero permite race cuando un lock es legítimamente lento.

---

### F6.7 🟠 HIGH — `uncaughtException` mata el proceso entero
**Código (`index.ts:626-629`):**
```typescript
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Excepción no capturada");
  process.exit(1);
});
```

**Simulación:**
- Un webhook con payload corrupto causa `TypeError` en `extractTextFromMessage`.
- La excepción no es capturada por `try/catch` interno.
- `uncaughtException` dispara.
- **TODO el proceso muere**.
- PM2 reinicia en ~2s.
- Los mensajes que estaban siendo procesados en ese momento **se pierden**.
- Meta recibe 200 para esos mensajes (porque `res.sendStatus(200)` fue inmediato), pero nunca se procesaron.

**Veredicto:** 🟠 **HIGH** — Correcto para evitar estado corrupto, pero bajo carga un solo bug mata todo el sistema. Debería hacer graceful shutdown (esperar que los locks actuales terminen, luego salir).

---

### F6.8 🟡 MEDIUM — `unhandledRejection` NO mata el proceso
**Código (`index.ts:631-633`):**
```typescript
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Promesa rechazada sin manejar");
});
```

**Problema:**
- `uncaughtException` mata el proceso.
- `unhandledRejection` solo loguea.
- Inconsistencia: una promesa rechazada sin catch deja el proceso en estado corrupto pero vivo.

**Veredicto:** 🟡 **MEDIUM** — Inconsistencia de política de errores.

---

## Resumen de bugs cruzados (FASE 1 → 6)

| Bug | Primera detección | Reconfirmado en | Estado |
|-----|-------------------|-----------------|--------|
| F3.11 needsHuman mata notificaciones | FASE 3 | FASE 4, FASE 6 | **CRITICAL, sin fix** |
| F3.5 needsHuman de fallback anulado | FASE 3 | FASE 4.3 | **CRITICAL, sin fix** |
| F3.6 Entidades no validadas | FASE 3 | — | **HIGH, sin fix** |
| F2.10 memCache dedup sin hard limit | FASE 2 | FASE 6.4 | **HIGH, sin fix** |
| F6.2 Lock timeout permite race | — | FASE 6.2 | **HIGH, sin fix** |
| F6.7 uncaughtException mata proceso | — | FASE 6.7 | **HIGH, sin fix** |
| F6.4 escalatedCache sin cleanup | — | FASE 6.4 | **HIGH, sin fix** |
| F5.5 Spam procesa 50x completo | — | FASE 5.5 | **MEDIUM, sin fix** |
| F5.6 Whitespace no ignorado | — | FASE 5.6 | **MEDIUM, sin fix** |
| F5.7 Emoji >6 no ignorado | — | FASE 5.7 | **MEDIUM, sin fix** |
| F6.3 DB caída = doble mensaje | — | FASE 6.3 | **MEDIUM, sin fix** |

---

## Recomendaciones finales (pre-deploy)

### 🔴 Inmediato (bloqueantes)
1. **Fix F3.11:** `handler.ts` — enviar reply + notificación + saveFlowData ANTES del return early de `needsHuman`.
2. **Fix F3.5:** `clasificador-ia.ts` — cuando intent es inválido, descartar `needsHuman` del LLM. Usar fallback 100%.
3. **Fix F6.7:** `index.ts` — graceful shutdown en `uncaughtException` (esperar locks activos 5s, luego salir).

### 🟠 Alta (antes de piloto 1,000)
4. **Fix F6.2:** Aumentar `LOCK_TIMEOUT_MS` a 120s (mayor que el peor caso real) O sincronizar con handler timeout.
5. **Fix F6.4:** Agregar cleanup periódico a `escalatedCache` (human-escalation.ts).
6. **Fix F2.10 / F6.4:** Hard limit inmediato en `memCache` de dedup.
7. **Fix F3.6:** Whitelist de valores de entidad en `procesarConIA`.

### 🟡 Media (antes de escalar a 4,000)
8. **Fix F5.5:** Rechazar spam ANTES de llamar a IA (contador de mensajes entrantes, no solo salientes).
9. **Fix F5.6 + F5.7:** Ignorar mensajes vacíos/whitespace y emojis >6.
10. **Fix F4.1:** Reason `"ia_fail"` para fallback por timeout/error de API.
11. **Fix F6.3:** Evitar doble mensaje al usuario cuando `escalateToHuman` ya envió uno.
12. **Fix F6.8:** Unificar política: `unhandledRejection` también debería matar el proceso (o ambos deberían hacer graceful shutdown).

### 🟢 Baja
13. **Fix F5.1:** Fuzzy matching básico para typos comunes ("keiro" → "quiero").
14. **Fix F4.7:** Mensaje vacío → `irrelevante` en fallback.
