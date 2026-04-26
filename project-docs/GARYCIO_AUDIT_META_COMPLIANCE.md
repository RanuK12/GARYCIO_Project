# GARYCIO — Auditoría de cumplimiento Meta WhatsApp Cloud API

**Fecha:** 2026-04-25
**Autor:** Claude (Opus 4.7)
**Alcance:** revisión técnica completa de las reglas que Meta exige para
operar un bot conectado a WhatsApp Business / Cloud API. Aplicado al
proyecto GARYCIO. Aplica también si se sigue usando 360dialog como
proveedor (las reglas de Meta corren igual aguas arriba).

---

## Resumen ejecutivo

Cubrí 23 reglas de Meta. Nueve estaban OK, ocho las apliqué en este pasaje
(commits locales, no deployados), y seis quedan como deuda priorizada.

| Estado | Cantidad |
|--------|----------|
| ✅ ya cumplía | 9 |
| 🛠 aplicado ahora | 8 |
| ⏳ pendiente / opcional | 6 |

Tests añadidos: 14 (interactive limits 6, meta compliance 4, signature 4).
Total suite ahora: **287/287 verdes**, `tsc` limpio.

---

## Reglas auditadas

### Bloque A — Ventana de conversación y costo

| # | Regla | Estado | Detalle |
|---|-------|--------|---------|
| 1 | Ventana 24h: el bot SOLO puede mandar texto libre dentro de las 24h del último inbound de la donante. Fuera, requiere template aprobado. | ✅ | `services/whatsapp-window.ts` + pre-check en `sendMessage` lanzando 131047 antes de pegarle a Meta. |
| 2 | 131047 (re-engagement required) y 131056 (rate limit pair) son permanentes — no reintentar. | ✅ | `WhatsAppAPIError.isPermanent` los incluye. Tests `bot-client-retries`. |
| 3 | Cada inbound del usuario reabre la ventana. | ✅ | Bot reactivo puro: no inicia conversaciones, sólo responde. Política acordada con el dueño. |
| 4 | Mensaje fuera de ventana → debe usar template (utility/marketing/auth) aprobado. | ⏳ | Existen templates registrados (`recoleccion_aviso1`, `recoleccion_aviso_tarde`) para difusión. No los usa en re-launch reactivo, sí en P3 si se reactiva broadcast. |

### Bloque B — Límites de payload

| # | Regla | Estado | Detalle |
|---|-------|--------|---------|
| 5 | Texto: max **4096 chars**. >4096 = error 100. | 🛠 | Guard en `sendMessage`: clamp + log error. Constante `WHATSAPP_LIMITS.MAX_TEXT_BODY`. Test `whatsapp-meta-compliance`. |
| 6 | Body de mensaje interactivo: max **1024 chars**. | 🛠 | Guard en `sendInteractiveButtons`/`sendInteractiveList`. |
| 7 | Botones de tipo "buttons": max **3** por mensaje. | 🛠 | Guard truncador en `sendInteractiveButtons`. Test verifica truncado a 3. |
| 8 | Lista interactiva: max **10 rows totales** (sumando todas las sections). | 🛠 | Guard que recorre sections respetando el budget. Test verifica con 7+7 → 7+3. |
| 9 | `row.title`: 24 chars. `row.description`: 72. `button.title`: 20. | 🛠 | `clampStr` aplicado. |
| 10 | `document.caption`: 1024 chars. `document.filename`: 240 chars. | 🛠 | Guard en `sendDocument`. Tests cubren ambos. |
| 11 | Audios, videos, stickers: el bot no los procesa. | ✅ | `isUnsupportedMediaType` + `respondUnsupportedMedia` con cooldown 10min y limpieza diaria. |

### Bloque C — Seguridad / autenticidad del webhook

| # | Regla | Estado | Detalle |
|---|-------|--------|---------|
| 12 | Verificación inicial del webhook: GET con `hub.challenge` y `hub.verify_token`. | ✅ | Implementado en `createWebhookRouter` GET handler. |
| 13 | **X-Hub-Signature-256**: Meta firma cada POST con HMAC-SHA256(app_secret, raw_body). Verificar es OBLIGATORIO en producción Meta directo. | 🛠 | Nuevo middleware `verifyMetaSignature`. Requiere `WHATSAPP_APP_SECRET` configurado. Si está vacío (compat 360dialog/dev), salta con WARN. Captura `rawBody` con `express.json({ verify })`. Test `webhook-signature` con 4 casos. |
| 14 | Responder al POST con 200 dentro de 20s; procesar async. | ✅ | `res.sendStatus(200)` antes de procesar. Encolado a pg-boss. |
| 15 | Idempotencia: Meta puede reenviar el mismo POST si timeoutea. | ✅ | `enqueueInbound` usa `singletonKey: messageId` en pg-boss → dedup automático sin tabla aux. |
| 16 | Rechazar payloads cuyo `object !== "whatsapp_business_account"`. | ✅ | Check explícito antes de iterar. |

### Bloque D — Rate limits y delivery

| # | Regla | Estado | Detalle |
|---|-------|--------|---------|
| 17 | Rate limit por business phone (típico 80 msg/s tier 1, escala a 1k+ con calidad alta). | ✅ | `SEND_RATE_PER_SECOND` (default 30, conservador). |
| 18 | Rate limit business/consumer pair (131056): "demasiados mensajes a esta donante muy rápido". | ✅ | P1.6 `rate-limit-adaptive`: backoff 15min por phone + global throttle si >5 hits/min. |
| 19 | Backoff exponencial en errores transitorios (5xx, 429). | ✅ | `sendMessage` retry hasta `MAX_RETRIES` con `2^retries * 1000 + jitter`. |
| 20 | Quality rating: si baja, Meta restringe el número. | ⏳ | No monitoreado. Recomendación: scrape `/phone_numbers/{id}` o el dashboard semanal. Documentado para P4. |

### Bloque E — UX y compliance

| # | Regla | Estado | Detalle |
|---|-------|--------|---------|
| 21 | Mark as read (`POST /messages` con `status:"read"`). Mejora UX y permite typing indicator. | ⏳ | No implementado. Bajo impacto, alto valor estético. Pendiente como mejora opcional. |
| 22 | Typing indicator (`status:"typing_on"`). | ⏳ | Combinado con #21, daría feedback "escribiendo…". Útil dado el debounce de 10s donde la donante puede pensar que el bot no la oyó. |
| 23 | Opt-out keywords ("baja", "stop", "no quiero más"): Meta exige respetar. | 🟡 | Parcial: `escalation-triggers.ts` detecta "no quiero donar más" / "me bajo" → escala a humano. Falta circuito automático que registre `donandoActualmente=false` y silencie al bot por X días. Documentado. |

---

## Cambios técnicos aplicados

### `src/bot/client.ts`

```ts
export const WHATSAPP_LIMITS = {
  MAX_BUTTONS: 3,
  MAX_LIST_ROWS: 10,
  MAX_BUTTON_TITLE: 20,
  MAX_ROW_TITLE: 24,
  MAX_ROW_DESCRIPTION: 72,
  MAX_BODY: 1024,
  MAX_TEXT_BODY: 4096,
  MAX_DOC_CAPTION: 1024,
  MAX_DOC_FILENAME: 240,
} as const;
```

- `sendMessage` clampea body a 4096.
- `sendInteractiveButtons` trunca a 3 botones + clamp título.
- `sendInteractiveList` trunca a 10 rows totales repartidos por sections + clamp título/description.
- `sendDocument` clampea caption y filename.
- Cada truncado loguea `logger.error(...)` con cantidad antes/después para detectar regresiones.

### `src/config/env.ts`

```ts
WHATSAPP_APP_SECRET: z.string().default(""),
```

### `src/bot/webhook.ts`

```ts
function verifyMetaSignature(req, res, next) {
  if (!env.WHATSAPP_APP_SECRET) return next();
  const header = req.headers["x-hub-signature-256"];
  const raw = req.rawBody;
  if (!header || !raw) return res.sendStatus(401);
  const expected = "sha256=" + crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
  // timingSafeEqual con check de length previo
}
router.post("/webhook", verifyMetaSignature, ...);
```

Plus `setInterval(...).unref()` en el cooldown de unsupported-media para no bloquear procesos cortos (tests, scripts).

### `src/index.ts`

```ts
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
```

### Tests nuevos

| Archivo | Casos |
|---------|-------|
| `tests/whatsapp-interactive-limits.test.ts` | 6 — buttons clamp, list 7+7→7+3, title/description clamp, body 1024, no-op dentro del límite. |
| `tests/whatsapp-meta-compliance.test.ts` | 4 — texto 4096, ok dentro de límite, caption 1024, filename 240. |
| `tests/webhook-signature.test.ts` | 4 — firma válida 200, sin header 401, firma inválida same-length 401, length distinto 401 (no tira `timingSafeEqual`). |

---

## Pendientes priorizados

1. **Quality rating monitoring** (#20). Endpoint admin `/admin/whatsapp/quality` que consulte `https://graph.facebook.com/v22.0/{phone_id}` y devuelva `quality_rating`, `messaging_limit`. Alerta a CEO si rating ≠ "GREEN".
2. **Mark as read + typing indicator** (#21, #22). Especialmente útil con debounce 10s — la donante ve "✓✓ escribiendo…" en vez de silencio.
3. **Opt-out automatico** (#23). Cuando `escalation-triggers` detecta "no quiero más / me bajo", además de escalar:
   - registrar `reportes_baja` con motivo automático
   - `pauseBotForPhone(phone, "opt-out", 30 días)`
   - confirmar a la donante "Listo, no te vamos a escribir más. Si cambiás de idea, escribinos."
4. **Webhook signature en producción**: setear `WHATSAPP_APP_SECRET` en el `.env` del server con el App Secret real de Meta (Dashboard → App → Basic). Sin él, el guard pasa pero sin protección.
5. **Templates re-engagement** (P3): si en algún momento se quiere mandar mensaje fuera de la ventana (ej. recordatorio de donación al día siguiente), registrar y usar templates approved.
6. **Health endpoint expandido**: incluir `quality_rating`, `messaging_limit_tier`, count de errores 131047/131056 últimas 24h, y `webhookSignatureFailures`.

---

## Cómo probar localmente la firma

```bash
# Setear el App Secret real en .env:
WHATSAPP_APP_SECRET=abcdef1234567890...

# Mandar un POST manual con curl + firma:
BODY='{"object":"whatsapp_business_account","entry":[]}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "abcdef1234567890..." | awk '{print $2}')
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
# → 200

# Sin firma:
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d "$BODY"
# → 401
```

---

## Riesgo si NO se aplica este bloque (referencia para el dueño)

- Sin guard de límites: cada vez que el bot intente mandar 11 rows o 4 botones o caption >1024, Meta devuelve **error 100 (permanente)** y el mensaje se pierde. La donante recibe silencio. Suma a la cuota de errores y baja el quality rating.
- Sin firma de webhook: cualquiera con la URL pública puede simular mensajes de cualquier donante. Riesgo: spam de respuestas reales del bot, gasto de cuota de mensajes utility, falseo de altas/bajas.
- Sin opt-out automatico: una donante que escribe "no quiero más" sigue recibiendo mensajes de difusión hasta que el admin la baje a mano. Riesgo: complaint to Meta → quality rating ↓ → tier ↓ → menos mensajes/segundo permitidos.

---

**Próxima acción sugerida:** revisar este informe + tests nuevos. Si aprobás,
sumo los pendientes #1, #2 y #3 en el mismo carril (todo local, sin tocar
server) y dejamos #4 para el momento del deploy.
