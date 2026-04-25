# Verificación Final — Servidor + Código + Stress Test

**Fecha:** 2026-04-22  
**Servidor:** Hetzner CPX22 @ 204.168.183.96  
**Estado:** Bot corriendo en TEST_MODE (solo whitelist). Listo para uso interno. NO público hasta OK de la empresa.

---

## 1. Configuración del Servidor

### ✅ Swap 2GB
```
NAME      TYPE SIZE USED PRIO
/swapfile file   2G   0B   -2
```

### ✅ Nginx + Reverse Proxy
- Instalado y activo.
- Configurado como reverse proxy a `localhost:3000`.
- `client_max_body_size 5M` (soluciona PayloadTooLargeError del código viejo).
- Buffering desactivado para webhooks en tiempo real.

### ✅ UFW (Firewall)
```
Status: active
22/tcp   ALLOW IN  Anywhere
80/tcp   ALLOW IN  Anywhere
443/tcp  ALLOW IN  Anywhere
```

### ✅ PM2 Startup
- `pm2 startup systemd` configurado.
- `pm2 save` ejecutado.
- Bot se levantará automáticamente al reiniciar el VPS.
- `max_memory_restart: 1500M` (antes 512M, causa de los 33 reinicios previos).

### ✅ PostgreSQL
- DB `garycio`: 23 MB.
- Tablas nuevas creadas por migración:
  - `processed_messages` (dedup): 1,021 registros (post-stress-test)
  - `human_escalations` (escalación): 0 registros (TEST_MODE activo)
  - `conversation_states` (estado): 6,669 registros (post-stress-test)

---

## 2. Código Subido y Buildado

### Archivos modificados (fixes QA FASE 1-6)

| Archivo | Fix aplicado |
|---------|-------------|
| `src/bot/handler.ts` | F3.11 (needsHuman envía reply+notify), F5.5 (spam anti-IA), F5.6/F5.7 (whitespace/emoji), F6.3 (doble mensaje) |
| `src/bot/webhook.ts` | Phone normalization, ignore whitespace |
| `src/bot/queue.ts` | F6.2 (lock timeout 120s) |
| `src/bot/conversation-manager.ts` | F3.6 (whitelist entidades), F4.1 (reason ia_fail), F1.2 (estado nueva redirige a registro) |
| `src/bot/flows/index.ts` | F1.1 (isAdminPhone normalizado) |
| `src/services/clasificador-ia.ts` | F3.5 (intent inválido → fallback 100%), F4.1 (timeout reason) |
| `src/services/dedup.ts` | F2.10 (hard limit memCache) |
| `src/services/human-escalation.ts` | F6.4 (cleanup escalatedCache) |
| `src/services/contacto-donante.ts` | F1.1 (normalizePhone en lookup/insert), F1.2 (no trap en estado nueva) |
| `src/index.ts` | F6.7 (graceful shutdown uncaughtException/unhandledRejection) |
| `src/config/env.ts` | Tests de flujos ya no crashean por process.exit(1) en modo test |
| `src/utils/phone.ts` | **NUEVO** — Normalizador de teléfonos argentinos |

### Build
- ✅ TypeScript compila sin errores.
- ✅ Tests core pasan (12/12 conversation-manager, 7/7 admin-access).
- Tests de flujos: 14 fallas pre-existentes por lógica de flujos (no por refactor).

---

## 3. Stress Tests Ejecutados

### Test 1: 100 usuarios concurrentes × 10 mensajes = 1,000 total
```
HTTP 200 OK:    1000
Errores:        0
Timeouts:       0
Duración:       2819ms
RPS:            354.7
Latencia avg:   158ms
Latencia p95:   549ms
Latencia p99:   614ms
✅ PASS
```

### Test 2: Mismo usuario × 20 mensajes seguidos (lock serialization)
```
HTTP 200 OK:    20
Errores:        0
Duración:       104ms
Latencia avg:   5ms
✅ PASS — Lock por usuario serializa correctamente
```

### Estado post-stress
- Memoria bot: 174 MB (dentro del límite 1500M).
- Sin reinicios automáticos de PM2.
- DB sin errores de conexión.

---

## 4. Falencias Corregidas

### 🔴 Críticas
| # | Falencia | Estado |
|---|----------|--------|
| 1 | Bot detenido desde 16/04 | ✅ Levantado y funcionando |
| 2 | F3.11 needsHuman silenciaba notificaciones | ✅ Fix en handler.ts |
| 3 | F3.5 Intent inválido anulaba fallback | ✅ Fix en clasificador-ia.ts |
| 4 | F1.1 Phone format loop (+549 vs 549) | ✅ Normalizador en todas las capas |
| 5 | F1.2 Estado "nueva" trap | ✅ Redirige a completar registro, no loop |

### 🟠 High
| # | Falencia | Estado |
|---|----------|--------|
| 6 | F6.2 Lock timeout permite race | ✅ 60s → 120s |
| 7 | F2.10 memCache dedup sin límite | ✅ Hard limit 5000 |
| 8 | F6.4 escalatedCache memory leak | ✅ Cleanup cada 30 min |
| 9 | F3.6 Entidades no validadas | ✅ Whitelist tipoReclamo/tipoAviso |
| 10 | F6.7 uncaughtException mata proceso | ✅ Graceful shutdown 5s |
| 11 | PayloadTooLargeError (código viejo) | ✅ body-parser 5MB en nuevo código |
| 12 | max_memory_restart 512M malinterpretado | ✅ 1500M configurado |

### 🟡 Medium
| # | Falencia | Estado |
|---|----------|--------|
| 13 | F5.5 Spam procesa 50x completo | ✅ Rechazo a los 20 mensajes entrantes |
| 14 | F5.6 Whitespace vacío genera respuesta | ✅ Ignorado en webhook.ts |
| 15 | F5.7 Emoji spam >6 no ignorado | ✅ Regex ampliado a 20 emojis |
| 16 | F4.1 Reason incorrecto en fallback IA | ✅ "ia_fail" para confidence low |
| 17 | F6.3 DB caída = doble mensaje | ✅ Eliminado sendMessage duplicado en catch |
| 18 | systemd PM2 inactive | ✅ pm2 startup + save configurados |
| 19 | Sin swap | ✅ 2GB swap creado |
| 20 | Sin nginx/SSL/firewall | ✅ nginx + UFW activos |

---

## 5. Pendientes antes de hacerlo público

### Variables de entorno
- [ ] `WHATSAPP_PHONE_NUMBER_ID=placeholder` → reemplazar por ID real de 360dialog.
- [ ] `WHATSAPP_TOKEN` → verificar que sea el D360-API-KEY correcto.
- [ ] `TEST_MODE=true` → cambiar a `false` cuando se apruebe.
- [ ] `TEST_PHONES` → limpiar o mantener solo números de prueba internos.

### SSL (Let's Encrypt)
- [ ] Tener un dominio apuntando al servidor.
- [ ] Ejecutar `certbot --nginx -d dominio.com`.
- [ ] Configurar webhook en 360dialog/Meta con `https://dominio.com/webhook`.

### Limpieza post-stress-test
- [ ] Limpiar `processed_messages` de prueba: `TRUNCATE processed_messages;` (opcional).
- [ ] Limpiar `conversation_states` de prueba: `TRUNCATE conversation_states;` (opcional).
- [ ] Los 1,021 mensajes de stress test están marcados como procesados. No afectan producción.

### Migración de datos (phone normalization)
- [ ] Ejecutar script para normalizar teléfonos existentes en `donantes`, `choferes`, `peones`, `visitadoras`:
```sql
UPDATE donantes SET telefono = REGEXP_REPLACE(telefono, '\D', '', 'g');
-- y agregar 54 si no lo tienen
```

---

## 6. Comandos útiles para operación

```bash
# Ver estado del bot
pm2 status
pm2 logs garycio-bot --lines 50

# Reiniciar bot
pm2 restart garycio-bot

# Ver métricas
pm2 monit

# Health check local
curl http://localhost:3000/health

# Ver escalaciones activas
sudo -u postgres psql -d garycio -c "SELECT * FROM human_escalations WHERE estado = 'activa';"

# Ver estadísticas de dedup
sudo -u postgres psql -d garycio -c "SELECT COUNT(*) FROM processed_messages;"
```

---

## 7. Decisiones tomadas

1. **Bot corriendo en TEST_MODE=true**: No enviará mensajes a números fuera de la whitelist. Seguro para pruebas internas.
2. **HTTP en puerto 80 (sin SSL)**: El webhook público requiere HTTPS. Se configura certbot cuando haya dominio y OK de la empresa.
3. **PM2 mode "cluster" con 1 instancia**: No es cluster real (solo 1 worker). Seguro sin Redis.
4. **Backup del código viejo**: `/opt/garycio-backup-20260422` disponible por si se necesita rollback.
