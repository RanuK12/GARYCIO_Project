# Auditoría del Servidor Hetzner — GARYCIO Bot

**Fecha:** 2026-04-21  
**Servidor:** CPX22 @ 204.168.183.96 (Ubuntu 24.04, 2vCPU, 4GB RAM, 80GB SSD)  
**Auditor:** Análisis remoto vía SSH

---

## TL;DR — Hallazgos Críticos

| # | Problema | Severidad | Impacto |
|---|----------|-----------|---------|
| 1 | **El bot está DETENIDO desde el 16/04** | 🔴 CRITICAL | Nadie recibe respuestas. WhatsApp parece "muerto". |
| 2 | **`max_memory_restart: 512M` malinterpretado** | 🟠 HIGH | PM2 reinicia el bot cuando Node usa >512MB. Eso NO es la RAM total (son 4GB). |
| 3 | **`PayloadTooLargeError` en webhooks** | 🟠 HIGH | Express rechaza payloads >100KB con 413. Meta puede desactivar el webhook. |
| 4 | **Código en producción = VERSIÓN VIEJA** | 🟠 HIGH | El refactor core (dedup, escalation, state machine) NUNCA fue deployado. |
| 5 | **Sin nginx, sin SSL, sin firewall** | 🟠 HIGH | HTTP crudo en puerto 3000. Exposición directa. Sin protección DDoS/buffering. |
| 6 | **systemd `pm2-root.service` inactive** | 🟡 MEDIUM | Si el servidor reinicia, el bot NO vuelve solo. |
| 7 | **Sin swap** | 🟡 MEDIUM | OOM killer sin red de seguridad si hay spike de memoria. |
| 8 | **`WHATSAPP_PHONE_NUMBER_ID=placeholder`** | 🟡 MEDIUM | Variable de entorno con valor dummy. Puede romper envío de mensajes. |

---

## 1. El bot está detenido desde el 16 de abril

**Evidencia:**
```
PM2 log: App [garycio-bot:0] exited with code [0] via signal [SIGINT]
PM2 log: pid=138636 msg=process killed
```

- Fecha/hora del shutdown: **2026-04-16 13:51:46 UTC**.
- Exit code 0 + SIGINT = **apagado manual o graceful** (`pm2 stop` o `kill -2`).
- No fue un crash.
- Han pasado **5 días** sin servicio.

**Impacto:** Los ~9,300 donantes que escriben al bot no reciben respuesta. El número de WhatsApp parece "fantasma".

---

## 2. `max_memory_restart: 512M` — El origen del mito de "512MB RAM"

**Configuración actual (`ecosystem.config.js`):**
```js
max_memory_restart: "512M",
```

**Esto NO significa que el servidor tenga 512MB de RAM.** Significa que PM2 mata y reinicia el proceso de Node.js si su heap supera los 512MB.

**RAM real del servidor:**
```
Mem: 3.7Gi total, 611Mi used, 3.1Gi available
```

**El problema:** Si el bot tiene memory leaks (Maps sin límite en `conversationCache`, `memCache` de dedup, `interactionCount`, etc.), Node.js crece hasta ~512MB, PM2 lo mata, y se reinicia. Eso explica los **33 reinicios** acumulados. Cada reinicio = pérdida de caché en memoria + posible interrupción de mensajes en proceso.

**Recomendación:** Subir a `1.5G` o `2G` (el servidor tiene 4GB y PostgreSQL usa poco). Idealmente, arreglar los leaks primero.

---

## 3. `PayloadTooLargeError: request entity too large`

**Evidencia:** Últimas 50 líneas del error log son **100% este error**.

**Causa:** Express `body-parser` tiene un límite por defecto de **100KB** para JSON. Los webhooks de WhatsApp pueden traer:
- Múltiples mensajes en un solo payload.
- Metadata de imágenes/documentos.
- Estados de delivery masivos.

Cuando el payload supera 100KB, Express devuelve **HTTP 413**. Meta/360dialog recibe un error y puede:
- Reintentar (creando duplicados).
- Desactivar el webhook si hay muchos 413 consecutivos.

**Fix:** En `src/index.ts`, configurar `express.json({ limit: '1mb' })` o más.

---

## 4. Código en producción = VERSIÓN VIEJA

**Commits en `/opt/garycio`:**
```
ee0e3bb fix: calcular próximo día de recolección en código, no en IA
bc81601 feat: mejorar respuesta IA para reclamos de no_pasaron
dc97bda fix: limpiar Maps en memoria para reducir heap usage
369845e fix: reducir PAGE_SIZE a 10...
```

**Lo que NO está en producción:**
- `src/services/dedup.ts` (deduplicación)
- `src/services/human-escalation.ts` (circuit breaker)
- `src/services/clasificador-ia.ts` (strict router)
- `src/bot/conversation-manager.ts` (state machine persistente)
- `src/bot/handler.ts` (failsafe con timeout)
- `src/bot/queue.ts` (lock timeout 60s)
- Tablas nuevas en DB (`processed_messages`, `human_escalations`)

**El bot que está detenido es el código PRE-refactor.**

**Implicación:** Incluso si lo levantás ahora, seguiría teniendo los 3 modos de falla críticos identificados en FASE 1 (state loss, webhook loops, LLM misuse).

---

## 5. Infraestructura de red: HTTP crudo, sin nginx, sin SSL, sin firewall

### 5.1 Sin nginx / reverse proxy
```
ss -tlnp:
  22   sshd
  5432 postgres
```

No hay nada en los puertos 80, 443, 3000 (porque el bot está parado).

**Riesgos:**
- **Sin buffering:** Si un webhook es grande, Express lo procesa directamente. Con nginx, nginx bufferiza el body antes de enviarlo a Node.js.
- **Sin rate limiting:** Cualquiera puede hacer POST a `/webhook` sin límite (DDoS fácil).
- **Sin compresión:** Respuestas grandes sin gzip.

### 5.2 Sin SSL (HTTPS)
- Meta Cloud API **requiere** HTTPS para webhooks.
- 360dialog puede ser más permisivo, pero para producción es obligatorio.
- No hay certificado SSL instalado.

### 5.3 Firewall inactivo
```
ufw status: inactive
```

El servidor expone:
- SSH (22) a todo internet.
- PostgreSQL (5432) solo en localhost ✅ (bien).
- Nada más... por ahora.

Pero cuando el bot levante en puerto 3000, estará expuesto directamente.

---

## 6. systemd `pm2-root.service` está inactive

**Evidencia:**
```
pm2-root.service — Active: inactive (dead)
```

PM2 daemon está corriendo en memoria, pero systemd no lo gestiona. Esto significa que si el VPS se reinicia (update del kernel, mantenimiento Hetzner, etc.), **el bot NO vuelve solo**.

**Fix:** `pm2 startup systemd && pm2 save`

---

## 7. Sin swap

```
Swap: 0B total, 0B used
```

Con 4GB RAM real, el bot debería tener margen. Pero sin swap:
- Si PostgreSQL hace un VACUUM grande + Node.js en spike = OOM killer.
- `max_memory_restart: 512M` mitiga esto para Node, pero no para el sistema entero.

**Recomendación:** Crear 2GB de swap.

---

## 8. Variables de entorno con valores placeholder

```
WHATSAPP_PHONE_NUMBER_ID=placeholder
WHATSAPP_BUSINESS_ACCOUNT_ID=
```

El `PHONE_NUMBER_ID` es fundamental para enviar mensajes vía 360dialog. Si está en `placeholder`, puede estar rompiendo el envío de mensajes salientes.

**Nota:** Dado que los logs muestran mensajes `status: sent`, es posible que 360dialog no requiera este campo (usa el número configurado a nivel de cuenta), pero es un riesgo.

---

## Diagnóstico de los 33 reinicios

No hay logs de crash recientes (el último fue SIGINT graceful). Los reinicios previos probablemente fueron:

1. **Deploys manuales** (`pm2 restart` tras cambios de código).
2. **Reinicios por `max_memory_restart: 512M`** cuando el heap de Node.js crecía por los Maps sin límite.
3. **Posibles reinicios del servidor** (updates de kernel, etc.).

La falta de `pm2 save` y `pm2 startup` explica por qué, tras algún reinicio de VPS, el bot quedó en estado `stopped`.

---

## Checklist para poner el servidor en orden

### Antes de levantar el bot (infraestructura)
- [ ] Crear swap de 2GB (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`)
- [ ] Instalar nginx (`apt install nginx`)
- [ ] Configurar nginx reverse proxy + SSL (Let's Encrypt con certbot)
- [ ] Configurar `client_max_body_size 5M;` en nginx (previene PayloadTooLargeError)
- [ ] Activar UFW: `ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable`
- [ ] Configurar PM2 startup: `pm2 startup systemd && pm2 save`

### Antes de levantar el bot (aplicación)
- [ ] Deployar el refactor core (código actual del repo local)
- [ ] Correr migraciones de DB (`processed_messages`, `human_escalations`)
- [ ] Verificar `WHATSAPP_PHONE_NUMBER_ID` (no placeholder)
- [ ] Aumentar `max_memory_restart` a `1.5G` en `ecosystem.config.js`
- [ ] Aumentar límite de body-parser en Express a `1mb` (o más)
- [ ] Hacer build: `npm run build`
- [ ] Testear localmente que arranque sin `process.exit(1)` por env vars

### Post-deploy (validación)
- [ ] `pm2 start ecosystem.config.js --env production`
- [ ] Verificar webhook responde 200 en `https://dominio.com/webhook`
- [ ] Enviar mensaje de prueba y verificar respuesta
- [ ] Monitorear `pm2 monit` y logs por 30 minutos
