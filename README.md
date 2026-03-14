# GARYCIO System

Sistema de automatización logística para recolección. Bot de WhatsApp, optimización de recorridos y gestión operativa.

## Stack

- **Backend**: Node.js + TypeScript
- **Bot**: Baileys (WhatsApp Web)
- **Base de datos**: PostgreSQL + Drizzle ORM
- **Scheduler**: node-cron

## Setup

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con los datos de tu base de datos

# Crear tablas en PostgreSQL
npm run migrate

# Iniciar en modo desarrollo
npm run dev
```

## Estructura

```
src/
├── bot/              # WhatsApp bot (Baileys)
│   ├── flows/        # Flows conversacionales
│   ├── client.ts     # Conexión y envío de mensajes
│   ├── handler.ts    # Handler de mensajes entrantes
│   └── conversation-manager.ts
├── database/         # PostgreSQL + Drizzle
│   ├── schema.ts     # Modelo de datos
│   ├── connection.ts
│   └── migrate.ts
├── services/         # Lógica de negocio
│   ├── mensajeria-masiva.ts
│   └── scheduler.ts
├── scripts/          # Scripts utilitarios
│   └── importar-donantes.ts
├── config/           # Configuración
│   ├── env.ts
│   └── logger.ts
└── index.ts          # Entry point
```

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Iniciar en modo desarrollo |
| `npm run bot` | Iniciar solo el bot |
| `npm run migrate` | Ejecutar migraciones de BD |
| `npm run build` | Compilar TypeScript |
| `npm start` | Iniciar en producción |

## Importar donantes

```bash
npm run migrate
ts-node src/scripts/importar-donantes.ts donantes.csv 1
```

Formato CSV esperado: `nombre,telefono,direccion,dias_recoleccion,donando_actualmente`
