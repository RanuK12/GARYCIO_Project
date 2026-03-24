# GARYCIO System

Sistema de automatización logística para recolección de aceite usado. Bot de WhatsApp, tracking GPS de camiones, optimización de rutas, OCR de comprobantes y reportes al CEO.

## Stack

- **Backend**: Node.js + TypeScript + Express
- **Bot**: WhatsApp Cloud API (Business Platform)
- **Base de datos**: PostgreSQL + Drizzle ORM
- **OCR**: Tesseract.js (lectura de tickets/comprobantes)
- **Tracking**: Ituran GPS (integración pendiente de credenciales)
- **Scheduler**: node-cron

## Setup

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con los datos reales

# Crear tablas en PostgreSQL
npm run migrate

# Iniciar en modo desarrollo
npm run dev
```

## Estructura del proyecto

```
GARYCIO_Project/
├── src/                        # Codigo fuente principal
│   ├── index.ts                # Entry point + endpoints API
│   ├── config/                 # Configuracion
│   │   ├── env.ts              # Variables de entorno (Zod)
│   │   └── logger.ts           # Logger (pino)
│   ├── database/               # PostgreSQL + Drizzle
│   │   ├── schema.ts           # Modelo de datos completo
│   │   ├── connection.ts       # Pool de conexion
│   │   ├── index.ts            # Re-exports
│   │   └── migrate.ts          # Migraciones automaticas
│   ├── bot/                    # WhatsApp Bot
│   │   ├── client.ts           # Envio de mensajes + descarga de media
│   │   ├── webhook.ts          # Receptor de webhooks de Meta
│   │   ├── handler.ts          # Router de mensajes entrantes
│   │   ├── conversation-manager.ts  # Estado de conversaciones
│   │   ├── queue.ts            # Cola de mensajes con rate limiting
│   │   ├── index.ts            # Re-exports
│   │   └── flows/              # Flujos conversacionales
│   │       ├── types.ts        # Interfaces compartidas
│   │       ├── index.ts        # Registro de flows
│   │       ├── contacto-inicial.ts   # Bienvenida + menu
│   │       ├── reclamo.ts            # Reclamos de donantes
│   │       ├── aviso.ts              # Avisos (vacaciones, etc.)
│   │       ├── consulta-general.ts   # Consultas libres
│   │       ├── nueva-donante.ts      # Alta de donantes
│   │       ├── chofer.ts             # Panel de choferes + fotos
│   │       ├── reporte.ts            # Reportes
│   │       └── envio-masivo.ts       # Mensajes masivos
│   └── services/               # Logica de negocio
│       ├── image-processor.ts       # OCR + analisis de comprobantes
│       ├── ituran-tracker.ts        # Tracking GPS (Ituran)
│       ├── route-optimizer.ts       # Optimizacion de rutas
│       ├── geocoding.ts             # Geocodificacion (Nominatim)
│       ├── reportes-ceo.ts          # Alertas y reportes al CEO
│       ├── reporte-pdf.ts           # Generador de PDF operativo
│       ├── reporte-diario.ts        # Reporte diario automatico
│       ├── mensajeria-masiva.ts     # Envio masivo WhatsApp
│       ├── dead-letter-queue.ts     # Cola de mensajes fallidos
│       └── scheduler.ts            # Tareas programadas (cron)
│
├── scripts/                    # Scripts de utilidad (no son parte del servidor)
│   ├── importar-donantes-excel.ts   # Importar Excel F91 a la DB
│   ├── importar-donantes-csv.ts     # Importar CSV generico a la DB
│   ├── generar-informe-proyecto.ts  # Genera PDF de estado del proyecto
│   ├── test-ocr-ticket.ts          # Test del parser OCR
│   ├── test-bot-local.ts           # Test local del bot
│   ├── test-rutas-optimizadas.ts   # Test de rutas
│   ├── demo-conversaciones.ts      # Demo de flujos conversacionales
│   ├── generar-donantes-test.ts    # Genera donantes de prueba
│   ├── generar-reporte-ejemplo.ts  # Genera reporte PDF ejemplo
│   ├── generate-proposal.py        # Genera propuesta comercial (Python)
│   ├── generar-resumen-cliente.py   # Genera resumen para cliente (Python)
│   └── actualizar-pptx.py          # Actualiza presentacion PPTX (Python)
│
├── docs/                       # Documentos para el cliente
│   ├── GARYCIO_Presentacion.pptx
│   ├── GARYCIO_Propuesta_Presupuesto.docx
│   ├── GARYCIO_Propuesta_Presupuesto.pdf
│   └── GARYCIO_Resumen_Tecnico.pdf
│
├── data/                       # Datos del cliente (gitignored)
│   └── F91 corregido.xlsx       # Excel con 8,404 donantes
│
├── reports/                    # Reportes generados (gitignored)
├── uploads/                    # Fotos de comprobantes (gitignored)
├── test-data/                  # Datos de prueba generados (gitignored)
│
├── .env.example                # Template de variables de entorno
├── .gitignore
├── package.json
├── tsconfig.json
└── drizzle.config.ts           # Config de Drizzle ORM
```

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/webhook` | GET/POST | WhatsApp webhook (Meta) |
| `/health` | GET | Health check completo |
| `/metrics` | GET | Metricas del servidor |
| `/admin/ceo/resumen` | GET | Resumen JSON para CEO |
| `/admin/ceo/reporte.pdf` | GET | Reporte PDF descargable |
| `/admin/tracking/posiciones` | GET | Posicion de todos los camiones |
| `/admin/tracking/vehiculo/:patente` | GET | Posicion de un vehiculo |
| `/admin/geocode` | POST | Geocodificar donantes pendientes |
| `/admin/subzonas/asignar` | POST | Asignar donantes a sub-zonas |
| `/admin/rutas/generar` | POST | Generar ruta optimizada |
| `/admin/dlq/retry` | POST | Reintentar mensajes fallidos |

## Importar donantes

```bash
# Desde Excel (formato F91)
npx tsx scripts/importar-donantes-excel.ts "data/F91 corregido.xlsx"

# Desde CSV generico
npx tsx scripts/importar-donantes-csv.ts donantes.csv 1
```

## Datos clave

- **WhatsApp Business**: +54 9 11 7156-0000
- **Galpon (base)**: Murature 3820, Villa Lynch, Provincia de Buenos Aires
- **Zona**: F91 Zona Sur (Rafael Calzada, Claypole, Temperley, Solano, etc.)
- **Donantes**: ~8,400 con GPS
