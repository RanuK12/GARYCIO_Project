# GARYCIO System

Sistema integral de automatización logística para recolección de aceite usado y reciclables. Bot de WhatsApp con IA conversacional, tracking GPS de camiones, optimización de rutas, reportes automáticos y panel de administración.

## Stack tecnologico

| Componente | Tecnologia |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| Servidor | Express 4 |
| Base de datos | PostgreSQL + Drizzle ORM |
| Bot WhatsApp | 360dialog (Meta Cloud API compatible) |
| IA conversacional | OpenAI GPT-4o-mini (clasificador de intenciones) |
| Tracking GPS | Ituran SOAP + REST API |
| OCR | Tesseract.js |
| Reportes | PDFKit + xlsx |
| Scheduler | node-cron |
| Logger | pino + pino-pretty |
| Validacion | Zod |

## Inicio rapido

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con los datos reales (ver seccion Variables de entorno)

# Crear tablas en PostgreSQL
npm run migrate

# Iniciar en modo desarrollo
npm run dev

# Build para produccion
npm run build

# Iniciar en produccion
npm run start
```

## Estructura del proyecto

```
GARYCIO_Project/
├── src/
│   ├── index.ts                     # Entry point + Express server + admin endpoints
│   ├── config/
│   │   ├── env.ts                   # Variables de entorno (Zod schema)
│   │   └── logger.ts               # Logger (pino)
│   ├── database/
│   │   ├── schema.ts               # Modelo de datos completo (20+ tablas)
│   │   ├── connection.ts           # Pool de conexion PostgreSQL
│   │   ├── index.ts                # Re-exports
│   │   └── migrate.ts              # Migraciones automaticas
│   ├── bot/
│   │   ├── client.ts               # WhatsApp API client (360dialog/Meta)
│   │   ├── webhook.ts              # Receptor de webhooks
│   │   ├── handler.ts              # Router + anti-loop + cooldown
│   │   ├── conversation-manager.ts # Estado de conversaciones + routing IA
│   │   ├── queue.ts                # Cola con locks por usuario
│   │   └── flows/                  # Flujos conversacionales
│   │       ├── types.ts            # Interfaces (FlowHandler, FlowResponse, etc.)
│   │       ├── index.ts            # Registro y deteccion de flows
│   │       ├── admin.ts            # Panel admin WhatsApp (interactivo)
│   │       ├── reclamo.ts          # Reclamos de donantes
│   │       ├── aviso.ts            # Avisos (vacaciones, enfermedad)
│   │       ├── nueva-donante.ts    # Alta de nuevas donantes
│   │       ├── difusion.ts         # Confirmacion de difusion masiva
│   │       ├── visitadora.ts       # Panel para visitadoras
│   │       ├── chofer.ts           # Panel de choferes (deshabilitado)
│   │       ├── peon.ts             # Panel de peones (deshabilitado)
│   │       ├── consulta-general.ts # Consultas libres
│   │       ├── contacto-inicial.ts # Bienvenida
│   │       └── reporte.ts          # Reportes
│   ├── services/
│   │   ├── clasificador-ia.ts      # Asistente IA conversacional (OpenAI)
│   │   ├── exportar-contactos.ts   # Generador XLS + activacion donantes
│   │   ├── mensajeria-masiva.ts    # Envio masivo WhatsApp por rutas
│   │   ├── contacto-donante.ts     # Auto-registro de contactos
│   │   ├── reportes-ceo.ts        # Alertas y reportes al CEO
│   │   ├── reporte-pdf.ts         # Generador de PDF operativo
│   │   ├── reporte-diario.ts      # Reporte diario automatico
│   │   ├── encuesta-regalo.ts     # Encuesta mensual de regalos
│   │   ├── progreso-ruta.ts       # Tracking de progreso de rutas
│   │   ├── ituran-tracker.ts      # GPS tracking (Ituran SOAP/REST)
│   │   ├── route-optimizer.ts     # Optimizacion de rutas
│   │   ├── geocoding.ts           # Geocodificacion (Nominatim)
│   │   ├── image-processor.ts     # OCR de comprobantes (Tesseract)
│   │   ├── dead-letter-queue.ts   # Cola de mensajes fallidos
│   │   └── scheduler.ts           # Tareas programadas (cron)
│   └── scripts/
│       └── importar-rutas-optimoroute.ts # Parser CSV de rutas
├── docs/                           # Documentos para cliente
├── PROYECTO.md                     # Documentacion tecnica completa
├── CHANGELOG.md                    # Historial de cambios
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```

## Variables de entorno

| Variable | Requerida | Descripcion |
|---|---|---|
| `DATABASE_URL` | Si | URL de conexion PostgreSQL |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Si | Conexion DB (alternativa a URL) |
| `WHATSAPP_TOKEN` | Si | API key de 360dialog (D360-API-KEY) |
| `WHATSAPP_PHONE_NUMBER_ID` | Si | ID del numero de WhatsApp Business |
| `WHATSAPP_VERIFY_TOKEN` | Si | Token de verificacion del webhook |
| `WHATSAPP_PROVIDER` | No | `360dialog` (default: `meta`) |
| `CEO_PHONE` | Si | Telefono del CEO para alertas |
| `ADMIN_API_KEY` | Si | API key para endpoints /admin/* (min 16 chars) |
| `ADMIN_PHONES` | No | Telefonos admin separados por coma |
| `OPENAI_API_KEY` | No | Para clasificador IA conversacional |
| `AI_CLASSIFIER_ENABLED` | No | Activar/desactivar IA (`true`/`false`) |
| `TEST_MODE` | No | Solo enviar a whitelist (`true`/`false`) |
| `TEST_PHONES` | No | Whitelist separada por coma |
| `PORT` | No | Puerto del servidor (default: 3000) |

## Endpoints API

### Publicos

| Endpoint | Metodo | Descripcion |
|---|---|---|
| `/webhook` | GET | Verificacion del webhook (Meta challenge) |
| `/webhook` | POST | Recepcion de mensajes WhatsApp |
| `/health` | GET | Health check con status de DB, memoria, DLQ |
| `/metrics` | GET | Metricas del servidor |

### Admin (requiere header `x-admin-key`)

| Endpoint | Metodo | Descripcion |
|---|---|---|
| `/admin/donantes/buscar?q=` | GET | Buscar donante por nombre/tel/direccion |
| `/admin/donantes/nuevos` | GET | Contactos nuevos (estado=nueva) |
| `/admin/donantes/altas-bajas` | GET | Altas y bajas por periodo |
| `/admin/donantes/:id` | GET | Ficha completa de donante |
| `/admin/difusion/nueva` | POST | Enviar difusion masiva |
| `/admin/difusion/stats` | GET | Stats de confirmacion |
| `/admin/difusion/pendientes` | GET | Donantes sin confirmar |
| `/admin/difusion/reset-grupos` | POST | Reset confirmaciones por grupo |
| `/admin/difusion/reenviar-pendientes` | POST | Reenviar a pendientes |
| `/admin/ceo/resumen` | GET | Resumen JSON para CEO |
| `/admin/ceo/reporte.pdf` | GET | Reporte PDF descargable |
| `/admin/tracking/posiciones` | GET | Posicion de todos los vehiculos |
| `/admin/tracking/vehiculo/:patente` | GET | Posicion de un vehiculo |
| `/admin/ituran/viajes` | GET | Viajes del dia (Ituran REST) |
| `/admin/ituran/velocidad` | GET | Alertas de exceso de velocidad |
| `/admin/geocode` | POST | Geocodificar donantes pendientes |
| `/admin/subzonas/asignar` | POST | Asignar donantes a sub-zonas |
| `/admin/rutas/generar` | POST | Generar ruta optimizada |
| `/admin/rutas/progreso` | GET | Progreso de rutas del dia |
| `/admin/rutas/verificar-progreso` | POST | Verificar progreso activo |
| `/admin/encuesta/enviar` | POST | Enviar encuesta mensual |
| `/admin/dlq/retry` | POST | Reintentar mensajes fallidos |
| `/admin/test-mensaje` | POST | Enviar mensaje de prueba |

## Despliegue

El sistema corre en un servidor Hetzner con PM2:

```bash
# Conectar al servidor
ssh root@204.168.183.96

# El proceso corre bajo PM2
pm2 status garycio-bot
pm2 restart garycio-bot
pm2 logs garycio-bot

# Deploy manual
npm run build
# Copiar dist/ al servidor
pm2 restart garycio-bot
```

## Flujos del bot

| Flujo | Rol | Descripcion |
|---|---|---|
| `admin` | Admin | Panel completo: contactos, reclamos, bajas, reportes, difusion, XLS |
| `reclamo` | Donante | Registro de reclamos con gravedad automatica |
| `aviso` | Donante | Vacaciones, enfermedad, medicacion (guarda en DB) |
| `nueva_donante` | Desconocido | Alta automatica con deteccion IA |
| `difusion` | Donante | Confirmacion de recepcion de mensajes masivos |
| `visitadora` | Visitadora | Panel de gestion de visitas |
| `consulta_general` | Donante | Consultas libres con derivacion |

## Datos clave

- **Empresa**: GARYCIO (recoleccion de aceite usado)
- **WhatsApp Business**: via 360dialog
- **Galpon (base)**: Murature 3820, Villa Lynch, Buenos Aires
- **Zona operativa**: F91 Zona Sur (Rafael Calzada, Claypole, Temperley, Solano, etc.)
- **Donantes**: ~9,000+ con GPS
- **Grupos de recoleccion**: LJ (Lunes/Jueves), MV (Martes/Viernes), MS (Miercoles/Sabado)
