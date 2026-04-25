# REFACTOR CORE — GARYCIO Bot WhatsApp
## Sesión de trabajo: 2024-04-21
## Arquitecto: Principal Software Engineer + Cloud Architect + Prompt Engineer

---

## CONTEXTO

GARYCIO = bot de WhatsApp para gestionar 7,000 donantes (usuarios no técnicos, mayoría adultos mayores). Fue apagado por fallos críticos en producción.

**Problemas detectados previos:**
1. Pérdida de estado: usuario se registra → bot responde → siguiente mensaje lo trata como nuevo.
2. Loop de webhooks: mensajes duplicados, bienvenida enviada múltiples veces.
3. Fallo con múltiples intenciones: sistema colapsaba si el usuario enviaba varios reclamos juntos.

---

## FASE 2 — REFACTOR CORE (CÓDIGO REAL)

### 2.1 Middleware de deduplicación (`src/services/dedup.ts`)

**Problema:** Meta/360dialog reenvían webhooks si hay timeouts o múltiples workers. El mismo `message.id` se procesaba varias veces, causando loops de bienvenida.

**Solución implementada:**
- Capa de deduplicación con estrategia híbrida:
  - **LRU en memoria:** Map con TTL de 24h, límite de 5,000 entradas (suficiente para 7k donantes). Limpieza cada 30 min.
  - **DB persistente:** tabla `processed_messages(message_id UNIQUE, phone, status, processed_at)`.
  - Flujo: `isDuplicate(messageId)` consulta memoria primero, luego DB. `markAsProcessed()` escribe en memoria inmediatamente y en DB en background (no bloquea).
- Integrado en `handler.ts` como primer paso del pipeline de `processIncomingMessage`.

**Archivos modificados:**
- `src/services/dedup.ts` (nuevo)
- `src/bot/handler.ts`
- `src/bot/webhook.ts` ( marca error en dedup si el procesamiento falla)
- `src/database/schema.ts` (tabla `processed_messages`)
- `src/database/migrate.ts` (creación de tabla)

---

### 2.2 State Machine Persistente (`src/bot/conversation-manager.ts`)

**Problema:** `updateConversation()` hacía `if (!state) return;` silenciosamente. Si el cache se limpiaba o el proceso se reiniciaba, las actualizaciones se perdían.

**Solución implementada:**
- `updateConversation()` ahora usa **UPSERT** (`INSERT ... ON CONFLICT UPDATE`) en la DB. Si no hay cache, re-hidrata el cache desde los datos actualizados.
- Cache = acelerador. DB = fuente de verdad absoluta.
- `startConversation()` también usa UPSERT, garantizando que siempre haya un registro en `conversation_states`.
- **Nunca se repite bienvenida:** cuando `procesarConIA()` responde con saludo/menú/consulta a un usuario sin sesión, ahora se llama `startConversation(phone, "contacto_inicial")` para persistir el estado. La próxima interacción encuentra estado activo.
- Cuando `detectFlow()` dispara por keyword (ej: "reclamo"), el mensaje original NO se pasa al flow handler. Se crea la sesión y se pasa `""` (inicio limpio), evitando que el menú se muestre dos veces.
- Estados del sistema (implícitos en `currentFlow + step`):
  - `IDLE` / `contacto_inicial` — menú principal mostrado
  - `nueva_donante` + step — flujo de registro (nombre, dirección, confirmación)
  - `reclamo` + step — flujo de reclamos
  - `aviso` + step — flujo de avisos
  - `consulta_general` — consultas
  - `HUMAN_ESCALATION` — gestionado por `human-escalation.ts`, no por conversation manager

**Archivos modificados:**
- `src/bot/conversation-manager.ts` (reescrito completo)
- `src/database/schema.ts` (sin cambios estructurales en `conversation_states`, pero se usa con UPSERT)

---

## FASE 3 — ROUTER LLM

### 3.1 Reescritura del clasificador (`src/services/clasificador-ia.ts`)

**Problema:** El LLM (gpt-4o-mini) actuaba como "asistente conversacional". El prompt le pedía personalidad, tono argentino, emojis, y generación de respuestas. Tenía demasiada libertad, causaba alucinaciones y no manejaba múltiples intenciones.

**Solución implementada:**
- **SOLO clasifica.** El LLM devuelve estrictamente:
  ```json
  {
    "intent": "...",
    "entities": [{"type":"...","value":"..."}],
    "needsHuman": true|false,
    "sentiment": "calm"|"frustrated"|"angry",
    "confidence": "high"|"medium"|"low"
  }
  ```
- **System Prompt estricto:** Sin personalidad, sin emojis, sin creatividad. Instrucciones inquebrantables:
  - "Respondé SOLO con JSON válido. Sin markdown, sin texto extra."
  - "NO generés respuestas para el usuario. Tu trabajo es CLASIFICAR, no conversar."
  - "NO tomés decisiones de negocio."
  - "Si detectás DOS o MÁS intenciones distintas → intent = 'multiple_issues' y needsHuman = true."
  - "Si detectás ENOJO, FRUSTRACIÓN o SARCASMO AGRESIVO → sentiment = 'angry' y needsHuman = true."
- **Temperatura 0.0** (antes 0.3). Máximo determinismo.
- **`max_tokens: 200`** (antes 300). Suficiente para JSON, imposible generar textos largos.
- **Timeout de 8s** con `AbortController`. Si falla o timeout → `needsHuman: true` y `confidence: "low"`.
- **Fallback por regex** (`classifyFallback`) también detecta:
  - Múltiples intenciones (combinación de keywords de reclamo + aviso + baja)
  - Enojo/frustración (patrones de lenguaje agresivo)
  - Si hay múltiples issues o enojo → devuelve `needsHuman: true` inmediatamente.

**Archivos modificados:**
- `src/services/clasificador-ia.ts` (reescrito completo)

---

## FASE 4 — FAILSAFE / HUMAN ESCALATION

### 4.1 Servicio de escalación humana (`src/services/human-escalation.ts`)

**Problema:** Cuando el sistema fallaba o el usuario estaba frustrado, no había mecanismo para bloquear la automatización y derivar a un humano.

**Solución implementada:**
- Tabla `human_escalations(phone UNIQUE, reason, estado, escalated_at, resolved_at, resolved_by, notas)`.
- Estados: `activa`, `resuelta`, `expirada`.
- Razones: `ia_fail`, `frustration`, `multiple_issues`, `user_request`, `system_error`.
- **Funciones clave:**
  - `isHumanEscalated(phone)` — cache en memoria (5 min) + DB. Consultado en CADA mensaje entrante.
  - `escalateToHuman(phone, reason, context)` — guarda en DB, notifica al CEO/admin, envía mensaje fijo al usuario.
  - `resolveHumanEscalation(phone, resolvedBy)` — desbloquea al usuario.
- **Mensaje fijo al usuario:**
  > "Tu mensaje fue derivado a un representante de nuestro equipo. Una persona se va a comunicar con vos a la brevedad para ayudarte personalmente. Por favor esperá unos minutos."
- **Bloqueo de automatización:** Si `isHumanEscalated()` devuelve `true`, `handleIncomingMessage()` ignora el mensaje y solo lo reenvía al admin. El bot no responde automáticamente.

**Archivos modificados:**
- `src/services/human-escalation.ts` (nuevo)
- `src/database/schema.ts` (tabla `human_escalations` + enum `estado_escalacion`)
- `src/database/migrate.ts` (creación de tabla y enum)
- `src/index.ts` (endpoints admin para gestionar escalaciones)

### 4.2 try/catch global + timeout handling (`src/bot/handler.ts`)

**Problema:** Errores no capturados en `processIncomingMessage` causaban crashes silenciosos o loops. No había timeout para llamadas a OpenAI.

**Solución implementada:**
- `withTimeout(promise, ms, context)` — wrapper que rechaza si el procesamiento excede 25s (menor al timeout de Meta de ~20-30s).
- try/catch global alrededor de `handleIncomingMessage()`:
  - Si hay **timeout** o **error** → se ejecuta `escalateToHuman(phone, "system_error", { error })`.
  - Se notifica al CEO con detalle del error.
  - El usuario recibe el mensaje de escalación.
  - Se marca como leído y se registra en logs.
- **Cooldown mejorado:** se registra ANTES de enviar la respuesta? No, se mantiene después (correcto para evitar reenvío en caso de error de envío). PERO la deduplicación por `messageId` previene duplicados antes de que el cooldown sea relevante.
- **Anti-spam:** Máximo 12 interacciones por ventana de 30 minutos (antes 10). Si se supera, notifica al admin.

**Archivos modificados:**
- `src/bot/handler.ts` (reescrito completo)

### 4.3 Mejoras en lock system (`src/bot/queue.ts`)

**Problema:** `withUserLock` liberaba el lock forzosamente a los 30s si un procesamiento tardaba (ej: OpenAI lento). Esto permitía que mensajes duplicados entraran en paralelo.

**Solución implementada:**
- Timeout de espera aumentado a **60s**.
- **NO se libera el lock forzosamente.** Si timeout, se loguea warning pero el mensaje se procesa igual (evita deadlock, acepta riesgo mínimo de duplicado ya mitigado por dedup).
- **Cleanup de locks zombies** cada 5 minutos. Si un lock tiene más de 120s de vida (proceso crashado), se elimina automáticamente.

**Archivos modificados:**
- `src/bot/queue.ts` (reescrito)

---

## ENDPOINTS ADMIN NUEVOS

Agregados en `src/index.ts`:

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/admin/human-escalations` | Listar últimas 100 escalaciones |
| POST | `/admin/human-escalations/resolve` | Resolver escalación (body: `{phone, resolvedBy}`) |
| GET | `/admin/human-escalations/check/:phone` | Verificar si un número está escalado |

---

## ROLLOUT POR FASES (RECOMENDADO)

Dado el volumen de 7,000 donantes, el despliegue debe ser gradual:

1. **Fase Piloto (1,000 donantes):** Seleccionar un subconjunto (ej: una zona o sub-zona específica). Monitorear métricas clave:
   - Tasa de duplicados (debe ser 0%)
   - Tasa de escalación humana (objetivo: < 5%)
   - Tiempo de respuesta promedio (objetivo: < 3s)
   - Errores de timeout (objetivo: 0)

2. **Fase 2 (2,000 donantes):** Agregar más zonas. Revisar logs de `processed_messages` para confirmar que dedup funciona a escala.

3. **Fase 3 (4,000 donantes):** Mitad de la base. Monitorear uso de memoria del cache de dedup y conversation states.

4. **Full Production (7,000 donantes):** Lanzamiento completo. Asegurar que el cache de 5,000 entradas de dedup + 2,000 de conversation no genere memory pressure.

---

## ARCHIVOS MODIFICADOS / CREADOS

### Nuevos:
- `src/services/dedup.ts`
- `src/services/human-escalation.ts`
- `docs/REFACTOR_CORE_2024.md`

### Reescritos:
- `src/services/clasificador-ia.ts`
- `src/bot/conversation-manager.ts`
- `src/bot/handler.ts`
- `src/bot/queue.ts`

### Modificados:
- `src/bot/webhook.ts`
- `src/database/schema.ts`
- `src/database/migrate.ts`
- `src/index.ts`

---

## COMPILACIÓN

```bash
npx tsc --noEmit
# Resultado: OK (0 errores)
```

---

## NOTAS PARA OPS

1. **Ejecutar migraciones antes de deploy:**
   ```bash
   npx ts-node src/database/migrate.ts
   ```

2. **Variables de entorno requeridas:**
   - `OPENAI_API_KEY` (para clasificador)
   - `AI_CLASSIFIER_ENABLED=true`
   - `DATABASE_URL`
   - `CEO_PHONE`
   - `ADMIN_PHONES`

3. **Monitoreo recomendado:**
   - Tabla `processed_messages`: crecimiento diario (debe estabilizarse, no crecer indefinidamente con duplicados)
   - Tabla `human_escalations`: tasa de escalación por hora
   - Logs con etiqueta `"Lock zombie eliminado"`: si aparece frecuentemente, indica procesos que crashean

4. **Limpieza de `processed_messages`:**
   - Recomendado: job cron diario que elimine registros de más de 7 días para evitar crecimiento infinito.

---

*Documento generado en sesión de refactorización crítica. No modificar sin aprobación del Principal Engineer.*
