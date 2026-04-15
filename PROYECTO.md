# GARYCIO - Documentacion Tecnica Completa

> Este archivo explica TODO sobre el proyecto. Un desarrollador, agente IA o cualquier persona puede leer esto y ubicarse completamente en el sistema.

**Ultima actualizacion**: 15 de Abril de 2026

---

## Que es GARYCIO

GARYCIO es un sistema de automatizacion logistica para una empresa de recoleccion de aceite usado y reciclables en Buenos Aires, Argentina. El nucleo es un **bot de WhatsApp** que atiende a ~9,000 donantes (personas que donan aceite usado), gestiona reclamos, avisos, difusion masiva y tiene un panel de administracion completo accesible desde WhatsApp.

## Donde esta desplegado

| Item | Valor |
|---|---|
| Servidor | Hetzner VPS (Ubuntu 24.04 LTS) |
| IP | `204.168.183.96` |
| Acceso SSH | `ssh root@204.168.183.96` (pass: ver credenciales privadas) |
| Ruta del proyecto en servidor | `/opt/garycio` |
| Proceso PM2 | `garycio-bot` (id: 0) |
| Script PM2 | `/opt/garycio/dist/index.js` |
| Puerto | 3000 |
| Base de datos | PostgreSQL en el mismo servidor |
| Proveedor WhatsApp | 360dialog (compatible con Meta Cloud API) |
| Repo GitHub | `https://github.com/RanuK12/GARYCIO_Project.git` |

### Comandos de deploy

```bash
# En local:
npm run build                    # Compila TypeScript a dist/

# En el servidor:
ssh root@204.168.183.96
cd /opt/garycio                  # <-- RUTA DEL PROYECTO EN EL SERVIDOR
pm2 restart garycio-bot          # Reiniciar el bot
pm2 logs garycio-bot             # Ver logs en tiempo real
pm2 status                       # Estado de procesos
```

### Como hacer deploy completo

```bash
# 1. En local: commitear y pushear
git add . && git commit -m "descripcion" && git push origin main

# 2. En el servidor:
ssh root@204.168.183.96
cd /opt/garycio                  # IMPORTANTE: el proyecto esta en /opt/garycio, NO en /root/
git pull origin main
npm install                      # solo si hay nuevas dependencias
npm run build
pm2 restart garycio-bot
pm2 logs garycio-bot --lines 20  # verificar que arranco bien
```

### Deploy automatico con sshpass (desde local)

```bash
# Crear archivo con password (evita problemas de escaping con !)
echo 'TU_PASSWORD' > /tmp/sshpw.txt
sshpass -f /tmp/sshpw.txt ssh root@204.168.183.96 'cd /opt/garycio && git pull && npm install && npm run build && pm2 restart garycio-bot'
rm /tmp/sshpw.txt
```

> **NOTA**: `sshpass -p 'password!'` NO funciona si la password tiene `!` porque da problemas de escaping. Siempre usar `-f` con archivo.

### Verificar que el bot esta corriendo

```bash
# En el servidor:
pm2 status                       # Debe mostrar "online"
curl http://localhost:3000/health # Debe devolver {"status":"ok",...}
```

---

## Arquitectura general

```
WhatsApp (donantes/admins)
    |
    v
360dialog API  <-->  Express Server (puerto 3000)
    |                     |
    v                     v
Webhook POST        Admin HTTP Endpoints
    |                     |
    v                     v
handler.ts           index.ts (/admin/*)
    |
    v
conversation-manager.ts  <-->  clasificador-ia.ts (OpenAI GPT-4o-mini)
    |
    v
flows/ (admin, reclamo, aviso, difusion, nueva-donante, etc.)
    |
    v
PostgreSQL (Drizzle ORM) — 20+ tablas
```

### Pipeline de un mensaje entrante

1. **webhook.ts** recibe el POST de 360dialog
2. Responde 200 inmediatamente (requisito de WhatsApp)
3. Extrae tipo de mensaje (text, interactive, button, image, audio, etc.)
4. Media no soportado (audio, video, sticker) → respuesta amable pidiendo texto (con cooldown 10min)
5. **handler.ts** procesa con lock por usuario:
   - Verifica cooldown (30s entre respuestas)
   - Verifica max interactions (10 por sesion de 30min)
   - Filtra mensajes triviales ("ok", "gracias", emojis solos)
   - Admins y confirmaciones de difusion siempre pasan
6. **conversation-manager.ts** hace routing:
   - Si hay sesion activa → continua el flow actual
   - Si no hay sesion → lookup de rol (donante/chofer/peon/admin/visitadora/desconocido)
   - Detecta intenciones especiales: baja, hablar con persona
   - Si hay keyword de flow → inicia flow
   - Si es donante conocida → pasa al clasificador IA
   - Si es desconocido → flow nueva_donante
7. **clasificador-ia.ts** (si esta habilitado):
   - Obtiene datos de la donante de la DB (nombre, direccion, dias, zona, chofer)
   - Envia a OpenAI GPT-4o-mini con system prompt personalizado
   - Clasifica en: reclamo, aviso, consulta, baja, saludo, confirmacion, etc.
   - Guarda automaticamente en DB (reclamos, avisos, confirmaciones)
   - Si no hay API key → fallback con regex/keywords
8. **handler.ts** envia la respuesta (texto plano o mensaje interactivo)
9. Notifica a chofer/admin/visitadora segun corresponda
10. Reclamos/escalaciones NO se marcan como leidos (quedan visibles en el telefono)

### Sistema anti-loop

El bot tenia problemas con donantes (personas mayores) que entraban en loops. Se implemento:

- **Cooldown de 30s** entre respuestas al mismo numero
- **Max 10 interacciones** por ventana de 30 min
- **Lista de mensajes ignorados** (ok, gracias, emojis, jaja, etc.)
- **Admins exentos** de todos los limites
- **Confirmaciones de difusion** siempre pasan

---

## Flujos conversacionales (flows/)

Cada flow es un `FlowHandler` con steps numerados. El estado se persiste en DB (`conversation_states`).

### admin.ts — Panel de administracion

Solo accesible para numeros en `ADMIN_PHONES` o `CEO_PHONE`. Menu interactivo con listas WhatsApp.

**Opciones:**
1. Contactos nuevos (paginacion de 50, con detalle y agendar)
2. Buscar donante (por nombre, tel o direccion)
3. Reclamos pendientes
4. Reportes de baja
5. Progreso de rutas
6. Encuesta mensual
7. Lista de comandos
8. Reporte diario PDF
9. Finalizar
10. Estado de difusion (MV/MS breakdown)
11. Resumen rapido (stats del dia)
12. Exportar XLS de contactos nuevos

**Exportar XLS**: Genera un archivo Excel con nombre, telefono, direccion, fecha y notas de todos los contactos nuevos. Lo envia como documento WhatsApp.

**Agendar donante**: Al ver detalle de un contacto nuevo, botones interactivos para activar (cambia estado a "activa", donandoActualmente=true).

### reclamo.ts — Reclamos

Steps guiados para registrar un reclamo. Gravedad automatica:
- `no_pasaron`, `falta_bidon` → moderado
- `bidon_sucio`, `pelela` → leve

Notifica al chofer de la zona o al admin si no hay chofer.

### aviso.ts — Avisos

Vacaciones, enfermedad, medicacion. Se guardan en tabla `avisos` con fechas de inicio/fin.

### nueva-donante.ts — Alta de nuevas donantes

Cuando un numero desconocido escribe al bot. Detecta con IA si es pregunta, donante existente, o mensaje complejo. Guarda en DB como estado="nueva", donandoActualmente=false.

### difusion.ts — Confirmacion de difusion

Para cuando se envia un mensaje masivo y las donantes confirman con "1", "recibido", etc.

### clasificador-ia.ts — Asistente IA

El cerebro del bot. Usa OpenAI GPT-4o-mini para:
- Clasificar intenciones (reclamo, aviso, consulta, saludo, baja, etc.)
- Responder con contexto (nombre de la donante, dias de recoleccion, zona)
- Guardar automaticamente en DB (reclamos, avisos, confirmaciones)
- Habla en argentino ("vos", "queres", "podes")
- Respuestas cortas (las donantes son personas mayores)
- Fallback sin IA: matching de keywords

---

## Base de datos (schema.ts)

PostgreSQL con Drizzle ORM. Tablas principales:

| Tabla | Descripcion |
|---|---|
| `donantes` | Datos de donantes (nombre, tel, direccion, zona, estado, dias recoleccion) |
| `zonas` | Zonas de recoleccion |
| `choferes` | Datos de choferes |
| `peones` | Personal de recoleccion |
| `visitadoras` | Visitadoras de campo |
| `camiones` | Vehiculos (patente, capacidad, estado) |
| `reclamos` | Reclamos de donantes (tipo, gravedad, estado, seguimiento) |
| `avisos` | Avisos de donantes (vacaciones, enfermedad, medicacion) |
| `recorridos` | Recorridos diarios planificados |
| `recorrido_donantes` | Donantes asignados a cada recorrido |
| `registros_recoleccion` | Registros de litros recolectados |
| `registros_combustible` | Gastos de combustible |
| `registros_lavado` | Registros de lavado de camiones |
| `incidentes` | Incidentes operativos |
| `mensajes_log` | Log de todos los mensajes WhatsApp |
| `conversation_states` | Estado de conversaciones activas |
| `difusion_envios` | Envios masivos y confirmaciones |
| `dead_letter_queue` | Mensajes fallidos para reintentar |
| `rutas_optimizadas` | Rutas generadas por optimizer |
| `sub_zonas` | Sub-zonas (A/B por zona) |
| `zona_choferes` | Asignacion zona-chofer |
| `reportes_baja` | Reportes de baja de donantes |
| `encuestas_regalo` | Encuesta mensual de regalos |
| `entregas_regalo` | Registros de entrega de regalos |
| `progreso_mensual` | Tracking mensual de litros |

### Enums

- `estado_donante`: activa, inactiva, vacaciones, baja_medica, nueva
- `tipo_reclamo`: regalo, falta_bidon, nueva_pelela, otro
- `tipo_aviso`: vacaciones, enfermedad, medicacion
- `estado_reclamo`: pendiente, notificado_chofer, seguimiento_enviado, escalado_visitadora, resuelto
- `gravedad_reclamo`: leve, moderado, grave, critico

---

## Servicios clave

### mensajeria-masiva.ts

Envio masivo de mensajes WhatsApp por rutas (importadas de OptimoRoute CSV). Soporta:
- Envio por grupo (LJ, MV, MS)
- Templates sin parametros (`recoleccion_lj`, `recoleccion_martesyviernes`, `recoleccion_miercolesysabado`)
- Registro en `difusion_envios` para tracking de confirmaciones

### Mapeo de dias (IMPORTANTE)

| Grupo | Dias | Template |
|---|---|---|
| LJ | Lunes y Jueves | `recoleccion_lj` |
| MV | Martes y Viernes | `recoleccion_martesyviernes` |
| MS | Miercoles y Sabado | `recoleccion_miercolesysabado` |

> Este mapeo fue corregido — anteriormente MV era "Miercoles y Viernes" y MS era "Martes y Sabado", lo cual era incorrecto.

### exportar-contactos.ts

Genera archivos XLS con contactos nuevos (estado="nueva"). Se envia como documento WhatsApp desde el panel admin. Tambien permite activar donantes cambiando su estado.

### clasificador-ia.ts

Asistente conversacional con OpenAI. Costo estimado: ~$0.90/mes para 60K mensajes. Fallback sin IA integrado.

### ituran-tracker.ts

Integracion con Ituran GPS para tracking de camiones. Soporta SOAP (posiciones real-time) y REST (viajes/trips). Deteccion de exceso de velocidad.

---

## Mensajes interactivos WhatsApp

El bot usa mensajes interactivos de WhatsApp (botones y listas):

- **Botones**: Hasta 3 opciones con un toque. Usado en menus simples.
- **Listas**: Hasta 10 opciones en menu desplegable. Usado en panel admin.

El webhook extrae el titulo del boton/lista seleccionado como texto plano → los flows reciben strings.

Para agregar un boton interactivo:
1. En el flow, retornar `interactive` en el `FlowResponse`
2. `handler.ts` detecta `result.interactive` y llama a `sendInteractiveButtons` o `sendInteractiveList`

---

## Variables de entorno completas

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/garycio
DB_HOST=localhost
DB_PORT=5432
DB_NAME=garycio
DB_USER=garycio
DB_PASSWORD=***

# WhatsApp (360dialog)
WHATSAPP_TOKEN=your_d360_api_key
WHATSAPP_PHONE_NUMBER_ID=your_phone_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
WHATSAPP_PROVIDER=360dialog
WHATSAPP_API_VERSION=v22.0

# App
CEO_PHONE=549XXXXXXXXXX
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
ADMIN_API_KEY=your_admin_api_key_min_16_chars
ADMIN_PHONES=549XXXXXXXXXX,549YYYYYYYYYY

# Difusion templates
DIFUSION_USE_TEMPLATE=true
DIFUSION_TEMPLATE_NAME=recoleccion_aviso1
DIFUSION_TEMPLATE_NAME_TARDE=recoleccion_aviso_tarde

# IA Clasificador
OPENAI_API_KEY=sk-...
AI_CLASSIFIER_ENABLED=true

# Test mode
TEST_MODE=false
TEST_PHONES=549XXXXXXXXXX

# Ituran GPS (opcional)
ITURAN_USER=
ITURAN_PASSWORD=
ITURAN_API_USER=
ITURAN_API_PASSWORD=

# Galpon
GALPON_DIRECCION=Murature 3820, Villa Lynch, Provincia de Buenos Aires
GALPON_LAT=-34.5944
GALPON_LON=-58.5339

# Rate limiting
SEND_RATE_PER_SECOND=30
MAX_RETRIES=3
SPEED_LIMIT_KMH=80
```

---

## Como agregar funcionalidad

### Nuevo flow conversacional

1. Crear archivo en `src/bot/flows/mi-flow.ts`
2. Implementar `FlowHandler` (name, keyword, handle)
3. Registrar en `src/bot/flows/index.ts`
4. Agregar el `FlowType` en `types.ts`
5. Si necesita routing especial → modificar `conversation-manager.ts`

### Nuevo endpoint admin

1. Agregar en `src/index.ts` bajo la seccion de endpoints administrativos
2. Ya tiene middleware de autenticacion (`x-admin-key`)

### Nuevo servicio

1. Crear en `src/services/`
2. Importar donde se necesite (flows, index, etc.)

---

## Instrucciones para el desarrollo continuo

> **IMPORTANTE**: Cada vez que se hacen cambios grandes, se debe:
> 1. Actualizar `CHANGELOG.md` con la fecha y descripcion de los cambios
> 2. Commitear y pushear a GitHub
> 3. Hacer deploy al servidor

Los cambios se documentan en `CHANGELOG.md` con las palabras del usuario/desarrollador para mantener contexto humano de que se hizo y por que.

---

## Contacto y datos operativos

- **Empresa**: GARYCIO
- **Zona operativa**: F91 Zona Sur, Buenos Aires (Rafael Calzada, Claypole, Temperley, Solano)
- **Galpon base**: Murature 3820, Villa Lynch
- **Donantes activas**: ~9,000+
- **Repositorio**: GitHub (privado)
