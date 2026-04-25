# Guia de Pruebas GARYCIO

## Requisitos previos (ya instalados)
- PostgreSQL 16 (corriendo en localhost:5432)
- ngrok (instalado via winget)
- Node.js >= 20
- `.env` configurado con `TEST_MODE=true`

## Numeros de prueba
| Persona | Numero | Rol en pruebas |
|---------|--------|----------------|
| Emilio | +39 344 572 1753 | Admin + Peon + Donante |
| Stefano | +54 9 11 2633-0388 | CEO + Chofer + Donante |

**TEST_MODE activo**: cualquier envio a otro numero se BLOQUEA automaticamente.

---

## Paso 0: Arrancar todo

### Terminal 1 - Servidor
```bash
npm run dev
```
Deberia mostrar:
- `TEST_MODE ACTIVO: solo se envian mensajes a numeros en whitelist`
- `Servidor HTTP iniciado { port: 3000 }`

### Terminal 2 - ngrok
```bash
ngrok http 3000
```
Copiar la URL tipo: `https://xxxx.ngrok-free.app`

### Configurar webhook en Meta
1. Ir a https://developers.facebook.com/apps/1414078203361212/whatsapp-business/wa-dev-console/
2. En "Configuration" > "Webhook"
3. Callback URL: `https://xxxx.ngrok-free.app/webhook`
4. Verify token: `garycio_verify_2026`
5. Click "Verify and Save"
6. Suscribir campo: `messages`

### Verificar que todo funciona
```bash
curl http://localhost:3000/health
```

---

## PRUEBAS DE FLUJOS

### 1. Flujo Donante - Reclamo de regalo
**Quien prueba**: Emilio (+39 344 572 1753)
**Enviar al**: +1 555 169 3562

1. Enviar: `hola`
   - Esperar: menu principal con opciones
2. Seleccionar opcion de reclamo
3. Seguir el flujo (seleccionar tipo, confirmar)
4. **Verificar**: llega notificacion a los admins (Emilio y Stefano)

### 2. Flujo Donante - Aviso de ausencia
**Quien prueba**: Emilio

1. Enviar: `hola`
2. Seleccionar opcion de aviso (vacaciones/enfermedad)
3. Indicar fechas
4. **Verificar**: se registra en DB, llega notificacion admin

### 3. Flujo Chofer
**Quien prueba**: Stefano (registrado como chofer de prueba)

> Nota: Stefano debe estar registrado como chofer. Si no, agregarlo:
> ```sql
> INSERT INTO choferes (nombre, telefono) VALUES ('Stefano Test', '5491126330388');
> ```

1. Enviar: `hola` desde el numero de Stefano
2. Deberia reconocerlo como chofer y mostrar menu de chofer
3. Probar: reportar incidente
4. Probar: reportar baja de donante
5. **Verificar**: notificaciones llegan a admins

### 4. Flujo Peon
**Quien prueba**: Emilio (registrado como peon en seed)

1. Enviar: `hola`
2. Deberia reconocerlo como peon y mostrar menu de peon
3. Probar: marcar entrega de regalo
4. Probar: reportar baja de donante
5. **Verificar**: registro en DB

### 5. Flujo Admin
**Quien prueba**: Stefano (CEO_PHONE en .env)

1. Enviar: `admin` o el comando de admin
2. Probar los 7 comandos:
   - `/estado` - resumen del sistema
   - `/donantes` - buscar donantes
   - `/reclamos` - ver reclamos pendientes
   - `/bajas` - ver reportes de baja pendientes
   - `/velocidad` - alertas de velocidad (Ituran)
   - `/viajes` - viajes del dia (Ituran REST)
   - `/ayuda` - lista de comandos

### 6. Endpoints HTTP (probar con curl)

```bash
# Health check
curl http://localhost:3000/health

# Metricas
curl http://localhost:3000/metrics

# Buscar donantes
curl "http://localhost:3000/admin/donantes/buscar?q=Emilio"

# Ver donante por ID
curl http://localhost:3000/admin/donantes/1

# Viajes Ituran (fecha actual)
curl http://localhost:3000/admin/ituran/viajes

# Alertas de velocidad
curl http://localhost:3000/admin/ituran/velocidad

# Resumen CEO
curl http://localhost:3000/admin/ceo/resumen

# Dead Letter Queue stats
curl http://localhost:3000/health | jq .deadLetterQueue

# Progreso de rutas
curl http://localhost:3000/admin/rutas/progreso

# Contactos auto-registrados
curl http://localhost:3000/admin/donantes/nuevos
```

### 7. Cron jobs (se ejecutan automaticamente)
- Progreso de rutas: cada 20min Lun-Sab 6am-6pm
- Reporte diario CEO: automatico al final del dia
- Para forzar manualmente:
```bash
curl -X POST http://localhost:3000/admin/rutas/verificar-progreso
```

---

## Que verificar en cada prueba

- [ ] Mensaje llega al WhatsApp
- [ ] Bot responde correctamente
- [ ] Flujo completo funciona (no se queda colgado)
- [ ] Notificaciones admin llegan a Emilio Y Stefano
- [ ] Mensajes a numeros fuera de whitelist se BLOQUEAN (ver logs)
- [ ] Health check muestra status OK
- [ ] Ituran REST devuelve viajes
- [ ] Logs en terminal muestran actividad

## Troubleshooting

### "Webhook verification failed"
- Verificar que el verify token sea exactamente: `garycio_verify_2026`
- Verificar que ngrok esta corriendo y la URL es correcta

### "Token expired"
- El token de WhatsApp es temporal (24h)
- Generar uno nuevo en Meta Developer > API Setup > Generate Token

### "TEST_MODE: bloqueado envio a..."
- Esto es CORRECTO. Significa que el filtro funciona.
- Si necesitas agregar un numero, editar TEST_PHONES en .env

### Bot no responde
- Verificar logs en Terminal 1
- Verificar que ngrok esta forwarding (Terminal 2)
- Verificar webhook esta suscrito a "messages" en Meta
