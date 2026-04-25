# GARYCIO — Roadmap Completo

## Fase 1: Bot WhatsApp + Gestión Operativa (EN CURSO)

### Completado
- Bot WhatsApp con flujos: contacto inicial, reclamos, avisos, consultas, nueva donante
- Flujo choferes: reporte de incidentes, envío de fotos/comprobantes (OCR)
- Flujo peones: reclamos, entrega de regalos, fotos, reportar bajas
- Panel admin por WhatsApp: contactos nuevos, buscar donantes, reclamos, bajas, progreso rutas
- Sistema OCR para tickets de combustible, lavado, bidones
- Reportes CEO con alertas automáticas por gravedad
- Alertas multi-admin (Stefano, Luciano, Vicente)
- Persistencia de reclamos e incidentes en base de datos
- Optimización de rutas (nearest-neighbor desde galpón)
- Geocodificación de donantes (Nominatim)
- Integración Ituran GPS (REST API + SOAP)
- Alertas de exceso de velocidad (>80 km/h)
- Notificaciones de progreso de ruta (salida galpón, zona, retorno)
- Donantes de baja: chofer/peón reporta → notifica admin → admin decide
- Entrega de regalos: peón marca entrega por donante
- Encuesta mensual automática (1000 donantes aleatorias: "¿recibiste el regalo?")
- Auto-registro de contactos: cuando un número nuevo escribe, se guarda para revisión
- Consulta de donantes por WhatsApp (admin busca por nombre/teléfono/dirección)
- Endpoint de contactos nuevos (pendientes de revisión)
- Reporte altas/bajas semanal
- Dead Letter Queue para mensajes fallidos
- Importador de donantes desde Excel (F91)

### Pendiente para producción
| Item | Responsable | Estado |
|------|-------------|--------|
| Hosting / servidor | Stefano | Pendiente |
| Token WhatsApp Business API | Stefano | Token temporal obtenido - faltan Phone ID y WABA ID |
| Asignación chofer → zona | Stefano | Pendiente |
| 73 donantes sin teléfono | Stefano | Pendiente |
| Días de recolección por zona | Stefano | Pendiente |
| Ituran SOAP CanUseWebserviceApi | Stefano→Ituran | Pendiente |

---

## Fase 2: Plataforma Completa (FUTURO)

> El alcance y presupuesto se definen al inicio de esta fase.

### 2.1 Dashboard Web Admin
- Panel web con métricas en tiempo real
- Mapa interactivo con posición de camiones GPS
- Gráficos de litros recolectados, km recorridos, eficiencia
- Alertas en pantalla (velocidad, desvíos, incidentes)
- Gestión de usuarios y permisos

### 2.2 CRM de Donantes
- Ficha completa de cada donante (datos, historial, reclamos, avisos)
- Semáforo verde/amarillo/rojo por consistencia y productividad:
  - **Verde**: dona regularmente, sin reclamos
  - **Amarillo**: donación irregular o reclamo reciente
  - **Rojo**: múltiples reclamos, baja reportada, o no dona hace +30 días
- Detección automática de donantes en riesgo
- Historial cruzado de reclamos (donante vs chofer/peón) para detectar patrones
- Diferenciación entre reclamo genuino vs insistencia repetida

### 2.3 Optimización de Recorridos Avanzada
- Algoritmo inteligente para rutas de recolección (OR-Tools / OptimoRoute)
- Consideración de ventanas horarias, capacidad del camión, prioridad
- Re-optimización en tiempo real cuando hay desvío
- Comparación automática ruta planificada vs recorrida

### 2.4 Geolocalización y Tracking GPS
- Tracking GPS de camiones en tiempo real (Ituran integrado)
- Historial de recorridos con replay en mapa
- Geofencing: notificación al entrar/salir de zonas
- Notificaciones avanzadas con % de completitud por ruta

### 2.5 Flujo Visitadoras
- Gestión completa con asignación y seguimiento
- Asignación automática de visitadora a reclamos escalados
- Seguimiento de visitas con resultado y devolución
- Métricas de resolución por visitadora

### 2.6 Tracking Peones Avanzado
- Marcación de bidones para trazabilidad
- Reporte de donantes de baja con foto de puerta (dirección visible)
- Comunicación automática WhatsApp→donante cuando peón reporta baja o poca donación

### 2.7 Ausencias y Cobertura
- Reasignación automática de choferes cuando hay ausencia
- Notificación al chofer de reemplazo con la ruta del día
- Historial de ausencias y cobertura por chofer

### 2.8 Lavado de Camiones
- Registro con foto comprobante cada 15 días
- Alerta automática cuando se acerca la fecha de lavado
- Historial de lavados por camión

### 2.9 Etiquetas y Organización
- Etiqueta de color por chofer con LMV (Lunes/Miércoles/Viernes) o MJS (Martes/Jueves/Sábado)
- Auto-etiquetado de donantes al responder (nombre, dirección, días)
- Filtros avanzados por zona, estado, chofer, días

---

## Fase 3: App Móvil (BACKLOG)

> Ideas recopiladas para futura app nativa. Se presupuestan por separado.

### Para choferes
- App con ruta del día, mapa y lista de paradas
- Check-in/check-out en cada donante
- Foto de bidones + escaneo de etiquetas
- Reporte de incidentes con geolocalización automática
- Chat directo con admin

### Para peones
- Lista de donantes de la zona del día
- Marcar entrega de regalo con foto
- Reportar baja con foto de puerta
- Registro de bidones retirados

### Para admin/CEO
- Dashboard con KPIs en tiempo real
- Mapa con posición de todos los camiones
- Notificaciones push de alertas
- Aprobación de bajas y reclamos desde la app
- Métricas comparativas por zona/chofer/mes

### Para donantes
- Portal de consulta del estado de su donación
- Historial de recolecciones
- Solicitar vacaciones/ausencia
- Reportar reclamo directamente

---

## Datos operativos confirmados

### Choferes
| Chofer | Patente | Teléfono |
|--------|---------|----------|
| Jaime Barrios | AH355HJ | +5491132425209 |
| Matias Bielik | AG185RG | +5491158599344 |
| Carlos Vera | AD795GK | +5491166044005 |
| (sin asignar) | AD609BE | — |

### Admin / Alertas CEO
| Nombre | Rol | Teléfono |
|--------|-----|----------|
| Stefano Gargiulo | CEO | Pendiente |
| Luciano Gargiulo Ciocca | Admin (hermano) | +5491130128112 |
| Vicente Gargiulo | Admin (padre) | +5491151042517 |

### Infraestructura
- **Galpón**: Murature 3820, Villa Lynch, Provincia de Buenos Aires
- **WhatsApp Business**: +54 9 11 7156-0000
- **Donantes**: 8,404 con GPS
- **Ituran REST API**: Activa (GARYCIO_API) — probada y funcionando
- **Ituran SOAP API**: Pendiente permiso CanUseWebserviceApi

### Pendientes críticos
- 73 donantes sin número de celular
- Asignación chofer → zona
- Hosting / servidor de producción
- Token permanente WhatsApp Business API
- Días de recolección por zona (LMV / MJS)
