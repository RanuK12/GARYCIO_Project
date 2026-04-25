# FASE 1 — STATE MANAGEMENT: DESTRUCCIÓN CONTROLADA
## QA Engineer / SRE — Plan de pruebas destructivas
## Fecha: 2024-04-21
## Objetivo: ROMPER el sistema. No validar.

---

## METODOLOGÍA

Cada escenario se ejecuta mentalmente contra el código exacto del refactor. Se documenta:
- **Input**: condición de entrada
- **Código ejecutado**: path exacto (líneas de archivo)
- **Resultado esperado por negocio**: qué debería pasar
- **Resultado real**: qué pasa según el código
- **Severidad**: 🔴 Crítico | 🟠 Alto | 🟡 Medio

---

## 1. ONBOARDING LOOPS

### 1.1 Teléfono con formato diferente post-registro
**Input**: Usuario nuevo `+5491122334455` completa registro. Flow guarda `telefono: state.phone` (con `+`). Próximo mensaje: 360dialog envía `5491122334455` (sin `+`).

**Código ejecutado**:
- `nueva-donante.ts:372-379`: `db.insert(donantes).values({ telefono: state.phone, ... })` → guarda CON `+`
- `conversation-manager.ts:316-317`: `lookupRolPorTelefono(phone)` con `5491122334455` (sin `+`)
- `contacto-donante.ts:37`: `eq(donantes.telefono, telefono)` → búsqueda exacta sin `+`
- `contacto-donante.ts:43-48`: `donante.length === 0` → devuelve `"desconocido"`
- `conversation-manager.ts:391-393`: `iniciarFlow(phone, "nueva_donante")` → **muestra bienvenida de nuevo**

**Resultado esperado**: Usuario registrado debe ser reconocido como donante.

**Resultado real**: 🔴 **Usuario registrado vuelve a onboarding.** Loop infinito de registro.

**Severidad**: 🔴 CRÍTICO — Cada usuario con formato de teléfono inconsistente queda atrapado en loop.

---

### 1.2 Auto-registro "nueva" nunca se resuelve
**Input**: Usuario desconocido escribe "hola". `registrarContactoDonante` lo inserta con `estado: "nueva"`. El usuario abandona sin completar el registro. Vuelve 3 días después.

**Código ejecutado**:
- `contacto-donante.ts:84-91`: Insert con `estado: "nueva"`
- Día 3, `conversation-manager.ts:316`: `lookupRolPorTelefono(phone)`
- `contacto-donante.ts:46`: `donante[0].estado === "nueva"` → devuelve `"desconocido"`
- `conversation-manager.ts:391-393`: Vuelve a `nueva_donante`

**Resultado esperado**: Si el usuario ya interactuó antes, no debería repetir onboarding completo.

**Resultado real**: 🔴 **Usuario siempre vuelve a onboarding.** No hay mecanismo de "continuar registro" ni de "saltear si ya tiene estado en conversation_states".

**Nota**: Si el usuario completó el registro pero `handleConfirmacion` falló al actualizar a `estado: "inactiva"`, el problema es idéntico. Queda como `"nueva"` para siempre.

**Severidad**: 🔴 CRÍTICO — Pérdida de usuarios por fricción repetida.

---

### 1.3 Proceso reinicia durante registro (step 1)
**Input**: Usuario está en `nueva_donante` step 1 (ya dio nombre, falta dirección). PM2 restart por deploy o crash.

**Código ejecutado**:
- Pre-restart: `updateConversation` guardó `{ currentFlow: "nueva_donante", step: 1, data: { nombre: "María" } }` en DB
- Post-restart: `conversationCache` está vacío
- Usuario envía dirección: `getConversation` lee de DB → `state.step = 1`, `state.data.nombre = "María"`
- `nueva-donante.ts:32`: `case 1: return handleDireccion(respuesta, state)`
- Funciona correctamente

**Resultado**: ✅ OK. La DB es fuente de verdad.

**PERO**: `nueva-donante.ts:99`: Si el proceso reinició ANTES de que `updateConversation` guardara step 1, el estado en DB tiene `step: 0`. El usuario envía dirección y `handleNombre` la interpreta como nombre largo (`respuesta.length > 25` → `interpretarConIA` o derivar a admin).

**Severidad**: 🟠 ALTO — Depende del timing del crash. No hay transacción atómica entre respuesta del flow y persistencia.

---

### 1.4 Usuario escribe "0" para cancelar registro
**Input**: Usuario en `nueva_donante` step 0. Recibe bienvenida. Responde "0".

**Código ejecutado**:
- `nueva-donante.ts:55`: `if (respuesta === "0") return { reply: "", endFlow: true }`
- `conversation-manager.ts:469-471`: `response.endFlow = true` → `endConversation(phone)`
- Estado borrado de DB y cache
- Usuario vuelve a escribir "hola" → `getConversation` → null → `lookupRolPorTelefono` → `"desconocido"` (porque sigue con `estado: "nueva"`) → onboarding de nuevo

**Resultado esperado**: Usuario cancela, puede volver a interactuar sin repetir onboarding.

**Resultado real**: 🟠 **Al cancelar, el usuario queda como "desconocido" en DB y vuelve a onboarding.** No hay flag de "ya vio bienvenida".

---

## 2. ESTADO CORRUPTO / ZOMBIE

### 2.1 currentFlow=null con step>0
**Input**: Bug externo o manipulación manual de DB inserta `{ phone: "X", currentFlow: null, step: 5, data: {} }`.

**Código ejecutado**:
- `conversation-manager.ts:421-444`: `if (!state.currentFlow)` → intenta matchear opción numérica
- Opción "1" → `targetFlow = "reclamo"`, `state.step = 0`
- PERO: el usuario podría NO haber enviado "1". Podría enviar "no pasaron".
- "no pasaron" no matchea ninguna opción → `targetFlow` queda `null`
- No hay `else` después del `if (targetFlow)` → cae al bloque 5 (`// 5. Procesar dentro del flow activo`)
- `conversation-manager.ts:448`: `if (!state.currentFlow)` → true → `endConversation(phone)` → **estado borrado**

**Resultado real**: 🟡 Se borra el estado. No es catastrófico pero pierde contexto.

---

### 2.2 data corrupta en DB (no es objeto)
**Input**: Manipulación directa de DB o bug de serialización guarda `data: "string"` o `data: 123` en lugar de `{}`.

**Código ejecutado**:
- `conversation-manager.ts:79`: `data: (row.data as Record<string, any>) || {}`
- El cast `as` es mentira del compilador. Si `row.data` es `"string"`, `state.data` es `"string"`.
- `conversation-manager.ts:461`: `state.data = { ...state.data, ...response.data }`
- Si `state.data` es `"string"`, `...state.data` itera sobre caracteres del string.
- Si el flow espera `state.data.nombre`, obtiene `undefined`.
- `nueva-donante.ts:324`: `state.data.nombre` → `undefined` → mensaje de confirmación muestra `Nombre: *undefined*`

**Resultado real**: 🟠 ALTO — Estado corrupto produce comportamiento impredecible. No hay validación de schema de `data`.

---

### 2.3 Flow handler eliminado entre deploys
**Input**: Estado en DB tiene `currentFlow: "reporte"`. Deploy elimina `reporteFlow` del array de flows.

**Código ejecutado**:
- `conversation-manager.ts:452`: `const flowHandler = getFlowByName(state.currentFlow)`
- `flows/index.ts:70-85`: `map[name] || null` → `null`
- `conversation-manager.ts:453-455`: `if (!flowHandler) { endConversation(phone); return { reply: "Hubo un error interno..." } }`

**Resultado real**: 🟡 Se borra el estado y se muestra error. Aceptable pero brusco.

---

## 3. TIMEOUTS Y EXPIRACIÓN

### 3.1 Usuario vuelve a los 29 minutos (estado casi expirado)
**Input**: Usuario en `reclamo` step 2 (esperando detalle). Espera 29 minutos. Envía "nada".

**Código ejecutado**:
- `conversation-manager.ts:57-58`: `Date.now() - cached.lastInteraction.getTime() > TIMEOUT_MS` → 29 min < 30 min → **NO expira**
- `conversation-manager.ts:459`: `flowHandler.handle(state, "nada", undefined)`
- `reclamo.ts:238-239`: `sinDetalle = true`
- Guarda reclamo, notifica chofer, pasa a step 3
- Funciona correctamente

**Resultado**: ✅ OK (por poco).

---

### 3.2 Usuario vuelve a los 31 minutos (estado expirado)
**Input**: Mismo escenario pero 31 minutos.

**Código ejecutado**:
- `conversation-manager.ts:57-58`: 31 min > 30 min → `await endConversation(phone)` → **estado borrado**
- `conversation-manager.ts:60`: Devuelve `null`
- Usuario envía "nada" → tratado como mensaje nuevo
- `lookupRolPorTelefono` → `"donante"` (si está registrado)
- `procesarConIA` clasifica "nada" como `irrelevante` → `reply: ""`
- El usuario NO recibe confirmación de que su reclamo fue guardado.
- Además, si el chofer ya fue notificado, hay un reclamo en DB pero el usuario perdió el contexto.

**Resultado esperado**: Timeout debería notificar al usuario que la sesión expiró, o al menos preservar datos parciales.

**Resultado real**: 🟠 ALTO — Timeout silencioso. Usuario pierde contexto sin aviso. Podría reenviar el mismo reclamo, creando duplicados en DB.

---

### 3.3 Cache eviction durante conversación activa
**Input**: 9,300 usuarios activos simultáneamente. Cache limitado a 2,000 entradas. Usuario #2,001 está en medio de un flow.

**Código ejecutado**:
- `conversation-manager.ts:40-48`: Limpieza por límite elimina las entradas más viejas (LRU por `lastInteraction`)
- Usuario #2,001 fue eliminado del cache pero NO de la DB
- Envía mensaje: `getConversation` lee de DB → OK
- `updateConversation` hace UPSERT → OK
- **PERO**: si el mensaje llega justo DURANTE la limpieza del `setInterval` (cada 1 hora), y `for...of` está iterando sobre el Map...

**Resultado**: En JavaScript, `Map` es seguro para iteración concurrente (no lanza ConcurrentModificationException como Java). Pero si `updateConversation` setea una entrada mientras `setInterval` la está eliminando:
1. `setInterval` obtiene `sorted` array de entries
2. `updateConversation` hace `conversationCache.set(phone, state)` → entrada existe
3. `setInterval` hace `conversationCache.delete(phone)` → **entrada eliminada**
4. Próximo mensaje: `getConversation` lee de DB → OK, pero hay un cache miss innecesario

**Resultado real**: 🟡 No es corrupción, pero hay race condition entre limpieza y actualización. En carga extrema, el cache se vuelve inefectivo.

---

## 4. CONCURRENCIA Y RACE CONDITIONS

### 4.1 Dos mensajes del mismo usuario en < 1 segundo
**Input**: Usuario presiona botón dos veces rápido. 360dialog envía dos webhooks con messageId diferentes.

**Código ejecutado**:
- `handler.ts:54-62`: Deduplicación por `messageId`
- Si messageId es DIFERENTE en cada webhook (360dialog genera IDs únicos), **la deduplicación NO funciona**
- `withUserLock` en `handler.ts:116` serializa los dos mensajes
- Mensaje 1: procesa, envía respuesta, `recordInteraction`
- Mensaje 2: espera en lock. Cuando entra, `checkCooldown` ve `lastResponseTime` reciente → **ignora el mensaje**

**Resultado real**: 🟡 El segundo mensaje se ignora por cooldown. No es duplicado de respuesta, pero se pierde el mensaje. Si el segundo mensaje era diferente (ej: corrección), se ignora.

---

### 4.2 Webhook duplicado con mismo messageId
**Input**: Meta reenvía webhook con messageId idéntico por timeout de red.

**Código ejecutado**:
- `handler.ts:54-62`: `isDuplicate(messageId)` → consulta `processed_messages` en DB
- Si el PRIMER webhook ya terminó y `markAsProcessed` se ejecutó → `isDuplicate` devuelve `true` → **ignorado**
- Si el PRIMER webhook aún está procesando (OpenAI lento) y `markAsProcessed` aún no se ejecutó → `isDuplicate` devuelve `false` → **procesa dos veces**

**Resultado real**: 🔴 **Window of vulnerability**: entre el inicio del procesamiento y `markAsProcessed`, un duplicado puede pasar. Ventana = tiempo de procesamiento del mensaje (hasta 25s con timeout).

**Mitigación**: `markAsProcessed` se ejecuta ANTES del `withUserLock` en `handler.ts:61`. Espera, no:
```typescript
if (messageId) {
    const dup = await isDuplicate(messageId);
    if (dup) { ... return; }
    await markAsProcessed(messageId, phone, "ok");
}
```
`markAsProcessed` se ejecuta INMEDIATAMENTE después de `isDuplicate`, antes del lock. Entonces:
1. Webhook 1: `isDuplicate` → false. `markAsProcessed` → inserta en DB. Entra a `withUserLock`.
2. Webhook 2 (1ms después): `isDuplicate` → true (lee DB). Ignorado.

**Resultado corregido**: ✅ OK. La ventana es microscópica (entre `isDuplicate` y `markAsProcessed`).

**PERO**: si `markAsProcessed` falla (DB down), el mensaje se procesa pero NO se marca. Duplicado siguiente pasaría.

---

### 4.3 PM2 cluster: dos workers procesan al mismo usuario
**Input**: PM2 en cluster mode (`instances: max`). Dos workers, sin sticky sessions. Dos mensajes consecutivos del mismo usuario van a Worker A y Worker B.

**Código ejecutado**:
- Worker A: `getConversation` → cache miss → lee DB → `state.step = 0`
- Worker A: procesa mensaje, actualiza `state.step = 1`, `updateConversation` → UPSERT en DB
- Worker B (100ms después): `getConversation` → cache miss (Worker B nunca vio este estado) → lee DB → `state.step = 1` (ya actualizado por A)
- Worker B: procesa mensaje, actualiza `state.step = 2`, `updateConversation` → UPSERT en DB

**Resultado**: ✅ Parece OK porque ambos leen de DB. PERO:

**Escenario de carrera**:
- Worker A: `getConversation` → lee DB → `state.step = 0`, guarda en cache A
- Worker B (50ms después, antes de que A escriba): `getConversation` → lee DB → `state.step = 0`, guarda en cache B
- Worker A: procesa, `state.step = 1`, `updateConversation` → UPSERT DB, actualiza cache A
- Worker B: procesa OTRO mensaje, lee de cache B → `state.step = 0` (stale), procesa como step 0 en lugar de step 1
- Worker B: `updateConversation` → UPSERT DB con `step = 1` (basado en step 0 + 1)

**Resultado real**: 🔴 **Race condition en cluster mode**. Cache por worker = stale data. No hay invalidación de cache entre workers.

**Severidad**: 🔴 CRÍTICO si se activa cluster mode. Actualmente `instances: 1`, así que no se manifiesta. Pero si escalan a cluster (como recomendé en infraestructura), esto explota.

---

### 4.4 DB lenta: updateConversation tarda > 5 segundos
**Input**: PostgreSQL bajo carga. `updateConversation` tarda 6 segundos en completar el UPSERT.

**Código ejecutado**:
- Usuario envía "1" (confirmar registro)
- `handleConfirmacion` guarda donante en DB → tarda 2s
- `handleConfirmacion` devuelve `endFlow: true`
- `conversation-manager.ts:470-471`: `await endConversation(phone)` → DELETE de `conversationStates` → tarda 5s
- Mientras tanto, usuario envía "hola" (mensaje 2)
- `withUserLock` serializa, pero mensaje 2 espera a que mensaje 1 termine
- Mensaje 1 finalmente borra el estado
- Mensaje 2: `getConversation` → null → `lookupRolPorTelefono` → busca en `donantes`
- Si el INSERT del registro tardó pero finalizó → encuentra donante → OK
- Si el INSERT del registro FALLÓ (timeout) → no encuentra donante → onboarding de nuevo

**Resultado real**: 🟠 Depende de si el INSERT de `donantes` se completó antes del DELETE de `conversationStates`. Si el INSERT falla por timeout de DB, el usuario queda registrado en `conversation_states` pero no en `donantes`. Al volver a escribir, se borró `conversation_states` y no existe en `donantes` → onboarding loop.

---

## 5. FORMATO DE TELÉFONO / IDENTIDAD

### 5.1 360dialog envía +54911... pero DB tiene 54911...
**Input**: Ya documentado en 1.1.

**Root cause**: `contacto-donante.ts:37` usa búsqueda exacta. No normaliza.

**Severidad**: 🔴 CRÍTICO

---

### 5.2 360dialog envía 54911... pero DB tiene +54911...
**Input**: Inverso. Usuario registrado con formato con `+`. Webhook llega sin `+`.

**Mismo resultado**: 🔴 No encuentra donante. Onboarding loop.

---

### 5.3 Número cambia de formato mid-conversación
**Input**: Usuario inicia conversación como `5491122334455`. Estado guardado con esa key. A los 10 minutos, 360dialog envía `+5491122334455` (diferente representación).

**Código ejecutado**:
- `getConversation("+5491122334455")` → cache miss → DB miss → `null`
- Tratado como usuario nuevo
- `lookupRolPorTelefono("+5491122334455")` → búsqueda exacta en `donantes` → miss → `"desconocido"`
- Onboarding de nuevo
- Estado previo con `5491122334455` queda huérfano en DB (nunca se borra, nunca se usa)

**Resultado real**: 🔴 **Conversación duplicada + estado huérfano en DB**. El usuario tiene DOS estados en `conversation_states` (uno por cada formato de teléfono).

---

## 6. HUMAN ESCALATION + STATE

### 6.1 Usuario escalado envía mensaje mientras admin responde
**Input**: Usuario frustrado → escalado. Admin aún NO resolvió la escalación. Usuario envía "gracias".

**Código ejecutado**:
- `conversation-manager.ts:260-269`: `isHumanEscalated(phone)` → `true`
- Devuelve `{ reply: "", notify: { target: "admin", message: ... }, needsHuman: true }`
- `handler.ts:197-202`: `if (result.needsHuman) { if (messageId) markAsRead(messageId).catch(() => {}); return; }`
- **No se envía respuesta al usuario**
- **No se registra interacción (cooldown no se activa)**
- Admin recibe el mensaje

**Resultado**: ✅ Comportamiento correcto por diseño. Pero...

**Edge case**: Usuario envía 20 mensajes seguidos mientras está escalado.
- Cada mensaje notifica al admin
- `handler.ts:149-156`: `checkMaxInteractions` → si supera 12 en 30 min, notifica al CEO
- PERO: `recordInteraction` NO se ejecuta para usuarios escalados (línea 197 retorna antes)
- Entonces `interactionCount` nunca crece para usuarios escalados
- Usuario escalado puede spammear infinitamente sin triggering max interactions

**Resultado real**: 🟠 Usuario escalado puede enviar mensajes ilimitados sin que el anti-spam lo frene.

---

### 6.2 Admin resuelve escalación pero usuario sigue en medio de un flow
**Input**: Usuario estaba en `reclamo` step 2. Se escaló por frustración. Admin resuelve escalación vía endpoint. Usuario envía "nada" (respuesta al reclamo).

**Código ejecutado**:
- Admin POST `/admin/human-escalations/resolve` → `estado: "resuelta"`
- `human-escalation.ts: escalatedCache.delete(phone)`
- Usuario envía "nada": `isHumanEscalated` → cache miss → DB → `"resuelta"` → `false`
- `getConversation(phone)` → `endConversation` fue llamado al escalar? No.
- Espera, al escalar NO se llama `endConversation`. El estado de conversación sigue existiendo.
- `getConversation` encuentra estado `reclamo` step 2
- Procesa "nada" como respuesta al reclamo
- Funciona correctamente

**Resultado**: ✅ OK. Pero...

**Edge case**: Si el usuario fue escalado por `system_error` (no por `user_request`), `endConversation` NO se llama. Si el error ocurrió DURANTE el procesamiento del mensaje, el estado podría estar en un estado intermedio inconsistente (ej: `step` actualizado pero `data` no).

**Resultado**: 🟡 Depende del tipo de error. Si `handleIncomingMessage` lanza excepción después de `updateConversation` pero antes de retornar, el estado refleja una transición que nunca se completó.

---

## RESUMEN DE HALLAZGOS — FASE 1

| # | Escenario | Severidad | Estado |
|---|---|---|---|
| 1.1 | Formato teléfono: onboarding loop | 🔴 | **ABIERTO** |
| 1.2 | Estado "nueva" eterno | 🔴 | **ABIERTO** |
| 1.3 | Crash antes de persistir step | 🟠 | **ABIERTO** (timing) |
| 1.4 | Cancelar registro con "0" → loop | 🟠 | **ABIERTO** |
| 2.1 | currentFlow=null + step>0 | 🟡 | Aceptable |
| 2.2 | data corrupta (no objeto) | 🟠 | **ABIERTO** |
| 3.1 | 29 min sin expirar | ✅ | OK |
| 3.2 | 31 min expirado silenciosamente | 🟠 | **ABIERTO** |
| 3.3 | Cache eviction race | 🟡 | Ineficiente pero no corrupto |
| 4.1 | Doble click botón | 🟡 | Ignorado por cooldown |
| 4.2 | Duplicado durante procesamiento | 🔴 | **ABIERTO** (DB down) |
| 4.3 | PM2 cluster stale cache | 🔴 | **CRÍTICO FUTURO** |
| 4.4 | DB lenta + INSERT timeout | 🟠 | **ABIERTO** |
| 5.1-5.3 | Formatos teléfono inconsistentes | 🔴 | **ABIERTO** |
| 6.1 | Usuario escalado spamea sin límite | 🟠 | **ABIERTO** |
| 6.2 | Estado intermedio inconsistente post-error | 🟡 | Aceptable |

---

## PRÓXIMA FASE

FASE 2 — WEBHOOKS / DEDUPLICACIÓN: atacar `dedup.ts`, `webhook.ts`, `handler.ts` bajo picos de tráfico.
