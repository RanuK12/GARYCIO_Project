# GARYCIO - Historial de Cambios

> Este archivo documenta todos los cambios importantes del proyecto.
> Se actualiza cada vez que se hacen cambios grandes y se despliega.
> Las descripciones estan en las palabras del desarrollador para mantener contexto humano.

---

## 2026-04-15 — Mejoras de IA, anti-loop, admin interactivo y documentacion

### Admin Panel (admin.ts)
- **Export XLS**: Nueva opcion "Exportar XLS" que genera un archivo Excel con todos los contactos nuevos (nombre, telefono, direccion, fecha, notas) y lo envia por WhatsApp
- **Agendar donante directo**: Al ver detalle de un contacto nuevo, aparecen botones interactivos para "Agendar donante" (cambia estado a activa), "Volver a lista", o "Menu principal"
- **Todo interactivo**: Todas las pantallas del admin usan botones interactivos en vez de texto plano — mas facil de usar
- **Detalle mejorado**: Lista de contactos ahora muestra nombre + direccion + fecha en cada fila
- **Resumen rapido** y **Estado difusion** con breakdown MV/MS

### Anti-loop / Handler (handler.ts)
- **Saludos no se ignoran**: "hola", "buen dia" etc. sacados de MENSAJES_IGNORADOS — las donantes ahora reciben respuesta cuando saludan
- **Cooldown reducido**: De 3 minutos a 30 segundos — evita spam sin bloquear donantes legitimas
- **Max interactions subido**: De 5 a 10 por sesion de 30 min
- **Reclamos no se marcan como leidos**: Quedan visibles en el telefono de la empresa

### Webhook (webhook.ts)
- **Feedback para audio/video/sticker**: En vez de ignorar silenciosamente, responde "No puedo escuchar audios todavia. Podrias escribir tu mensaje con texto?" — con cooldown de 10 min para no spammear

### Reclamo flow (reclamo.ts)
- **Gravedad automatica**: "no_pasaron" y "falta_bidon" -> gravedad "moderado", bidon sucio/pelela -> "leve"

### Aviso flow (aviso.ts)
- **Guarda en DB automaticamente**: Vacaciones y enfermedad se guardan en tabla avisos con fechas, ya no solo notifican al chofer

### Clasificador IA (clasificador-ia.ts) — NUEVO
- **Asistente conversacional**: Donantes conocidas que escriben texto libre -> IA clasifica intencion y responde con contexto (dias de recoleccion, zona, chofer)
- **Fallback sin IA**: Si no hay API key, usa matching de keywords
- **Auto-guarda**: Reclamos, avisos y confirmaciones de difusion se guardan en DB automaticamente

### Export de contactos (exportar-contactos.ts) — NUEVO
- **Generador XLS**: Crea archivos Excel con contactos nuevos para importar
- **Activar donante**: Funcion para cambiar estado de nueva a activa desde WhatsApp

### Otros
- **Queue.ts**: Timeout de seguridad en locks (30s) para prevenir deadlocks
- **Client.ts**: Soporte de MIME types para .xlsx, .xls, .csv
- **Timeout recovery**: Guarda info del flow expirado para dar contexto
- **Nueva donante mejorada**: Detecta preguntas, donantes existentes, direcciones confundidas con nombres, y mensajes complejos con IA
- **README.md**: Actualizado con toda la info del proyecto
- **PROYECTO.md**: Documentacion tecnica completa para desarrolladores/IA
- **CHANGELOG.md**: Este archivo

---

## 2026-04-13 — Paginacion admin y correccion de difusion

- Paginacion de 50 en contactos nuevos del panel admin
- Correccion de logica de confirmacion de difusion (normalizacion telefono y prioridad del check)
- Estado difusion con breakdown MV/MS y opcion 10 reconsultable desde step 99

## 2026-04-12 — Menus interactivos y correccion de dias

- Menus interactivos WhatsApp para donantes y admins (botones y listas)
- Correccion de dias de difusion MV/MS (Martes y Viernes / Miercoles y Sabado)
- Correccion del nombre template `recoleccion_miercolesysabados` (con s final)

## 2026-04-11 — Templates de difusion nueva

- Difusion nueva con templates `recoleccion_lj` y `recoleccion_mvms` + cron 6AM ARG
- Correccion de parametros en templates (parameter_name: variable_1)
- Fix: enviar templates sin parametros + soloGrupos para reenvio parcial

## 2026-04-10 — Reportes y admin

- Reporte PDF se envia directo al admin que lo pide
- Reporte PDF responde inmediato y genera en background
- Opciones 9 y 10 en menu admin

## 2026-04-09 — Difusion, tracking, test mode

- Estado de difusion (confirmadas vs pendientes)
- Normalizacion de formato de telefono al registrar confirmacion
- Endpoint /admin/test-mensaje para pruebas directas
- Filtro por telefonos especificos en enviar-rutas
- Logueo de estados de delivery de mensajes salientes
