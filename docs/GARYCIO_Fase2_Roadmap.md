# GARYCIO — Roadmap Completo

## Fase 1: Bot WhatsApp + Gestión Operativa (EN CURSO)

### Completado
- Bot WhatsApp con flujos: contacto inicial, reclamos, avisos, consultas, nueva donante
- Flujo choferes: reporte de incidentes, envío de fotos/comprobantes (OCR)
- Sistema OCR para tickets de combustible, lavado, bidones
- Reportes CEO con alertas automáticas por gravedad
- Persistencia de reclamos e incidentes en base de datos
- Optimización de rutas (nearest-neighbor desde galpón)
- Geocodificación de donantes (Nominatim)
- Integración Ituran GPS (REST API + SOAP)
- Dead Letter Queue para mensajes fallidos
- Importador de donantes desde Excel (F91)

### En implementación (Fase 1.5)
| Feature | Descripción | Estado |
|---------|-------------|--------|
| Flujo peones | Reclamos de donantes, similar a choferes | En desarrollo |
| Donantes de baja | Chofer/peón reporta baja → notifica admin → admin decide | En desarrollo |
| Alertas velocidad | Notificación cuando camión excede velocidad | En desarrollo |
| Notificaciones recorrido | Salida galpón, llegada zona, 50%, 100%, descarga, laboratorio | En desarrollo |
| Marcar entrega regalo | Peón marca a qué donantes entregó regalo | En desarrollo |
| Encuesta mensual | Mensaje automático a 1000 donantes aleatorias: "¿recibiste el regalo?" | En desarrollo |
| Auto-guardar contacto | Cuando donante responde, guardar nombre/dirección/días | En desarrollo |
| Consulta de donantes | Admin puede pedir info de cualquier donante por WhatsApp | En desarrollo |
| Reporte altas/bajas | Reporte semanal de nuevas donantes y bajas | En desarrollo |

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
- Alertas de velocidad excesiva
- Geofencing: notificación al entrar/salir de zonas
- Notificaciones automáticas: salida galpón → zona → 50% → 100% → descarga → laboratorio

### 2.5 Flujo Visitadoras
- Gestión completa con asignación y seguimiento
- Asignación automática de visitadora a reclamos escalados
- Seguimiento de visitas con resultado y devolución
- Métricas de resolución por visitadora

### 2.6 Tracking Peones
- Marcación de bidones para trazabilidad
- Registro de entrega de regalos por donante
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
- **Ituran REST API**: Activa (GARYCIO_API)
- **Ituran SOAP API**: Pendiente permiso CanUseWebserviceApi

### 🔴 Pendientes críticos
- 73 donantes sin número de celular
- Asignación chofer → zona
- Hosting / servidor de producción
- Token permanente WhatsApp Business API
- Días de recolección por zona (LMV / MJS)
