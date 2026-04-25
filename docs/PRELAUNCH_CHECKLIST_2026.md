# Checklist Pre-Lanzamiento — GARYCIO Bot

**Fecha:** 2026-04-22  
**Lanzamiento objetivo:** Mañana  
**Donantes:** 9,300+  
**Servidor:** Hetzner CPX22 (2vCPU, 4GB RAM, 80GB SSD)

---

## 🔴 BLOQUEANTES (sin esto NO puede lanzar)

### 1. WHATSAPP_PHONE_NUMBER_ID = placeholder
**Estado:** ❌ Aún es `placeholder`  
**Impacto:** El bot no puede enviar mensajes salientes. Cada respuesta fallará.  
**Acción:** Reemplazar por el ID real de 360dialog.  
```bash
ssh root@204.168.183.96
sed -i 's/WHATSAPP_PHONE_NUMBER_ID=placeholder/WHATSAPP_PHONE_NUMBER_ID=ID_REAL/' /opt/garycio/.env
```

### 2. TEST_MODE = true
**Estado:** ❌ Activado  
**Impacto:** El bot solo responderá a los 5 números en `TEST_PHONES`. Los otros 9,295 donantes no recibirán nada.  
**Acción:** Cambiar a `false`.
```bash
sed -i 's/TEST_MODE=true/TEST_MODE=false/' /opt/garycio/.env
```

### 3. Dominio apuntando al servidor
**Estado:** ❌ No hay dominio. Hostname actual: `garycio-bot`  
**Impacto:** No se puede configurar SSL (Let's Encrypt requiere dominio). 360dialog/Meta requieren HTTPS para webhooks.  
**Acción:** Comprar/configurar un dominio (ej: `bot.garycio.org`) y apuntar el registro A a `204.168.183.96`.

### 4. SSL (Let's Encrypt)
**Estado:** ❌ No configurado  
**Impacto:** Webhook HTTP será rechazado por Meta/360dialog.  
**Acción:** Una vez que el dominio apunte al servidor:
```bash
ssh root@204.168.183.96
certbot --nginx -d bot.garycio.org
# Actualizar nginx config para redirigir HTTP a HTTPS
```

### 5. Webhook URL configurada en 360dialog
**Estado:** ❌ No verificado  
**Impacto:** 360dialog no sabe dónde enviar los mensajes entrantes.  
**Acción:** En el dashboard de 360dialog, configurar:
- Webhook URL: `https://bot.garycio.org/webhook`
- Verify Token: `garycio_test_2024` (el valor actual en `.env`)

---

## 🟠 CRÍTICOS (pueden causar caída o mala UX en las primeras horas)

### 6. PostgreSQL tuning
**Estado:** ❌ Default (muy conservador para 4GB RAM)  
**Valores actuales:**
- `max_connections = 100` → debe ser `200`
- `shared_buffers = 128MB` → debe ser `1GB` (25% de RAM)
- `effective_cache_size = 4GB` → debe ser `3GB`
- `work_mem = 4MB` → OK
- `maintenance_work_mem = 64MB` → debe ser `256MB`

**Acción:**
```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
# Cambiar:
max_connections = 200
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
# Reiniciar:
sudo systemctl restart postgresql
```

### 7. Límite de file descriptors (ulimit)
**Estado:** ❌ 1024  
**Impacto:** Bajo carga de 9,300 donantes, Node.js + PostgreSQL pueden agotar los file descriptors. El proceso crashea con EMFILE.  
**Acción:**
```bash
# Aumentar a 65535
sudo nano /etc/security/limits.conf
# Agregar:
root soft nofile 65535
root hard nofile 65535

# También para systemd (PM2)
sudo mkdir -p /etc/systemd/system.conf.d/
sudo tee /etc/systemd/system.conf.d/limits.conf << 'EOF'
[Manager]
DefaultLimitNOFILE=65535
EOF
sudo systemctl daemon-reexec
```

### 8. Log rotation (PM2 + nginx)
**Estado:** ❌ Sin configurar. Logs crecen indefinidamente.  
**Impacto:** En 1-2 semanas con 9,300 usuarios activos, el disco de 80GB puede llenarse.  
**Acción:**
```bash
sudo apt-get install -y logrotate

# PM2 logs
sudo tee /etc/logrotate.d/pm2-garycio << 'EOF'
/root/.pm2/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    sharedscripts
    postrotate
        pm2 reloadLogs > /dev/null 2>&1
    endscript
}
EOF

# Nginx logs ya vienen con logrotate por defecto
```

### 9. Backup automático de DB
**Estado:** ❌ Sin backup  
**Impacto:** Si hay corrupción de datos o borrado accidental, no hay forma de recuperar.  
**Acción (mínimo):**
```bash
sudo tee /usr/local/bin/backup-garycio.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/root/backups"
mkdir -p $BACKUP_DIR
pg_dump -U garycio -h localhost garycio | gzip > "$BACKUP_DIR/garycio-$(date +%Y%m%d-%H%M%S).sql.gz"
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
EOF
chmod +x /usr/local/bin/backup-garycio.sh

# Cron diario a las 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/backup-garycio.sh") | crontab -
```

### 10. Limpiar datos de prueba del stress test
**Estado:** ❌ 1,021 `processed_messages` + 6,669 `conversation_states` son de prueba  
**Impacto:** No crítico, pero ensucia métricas y dedup.  
**Acción:**
```bash
sudo -u postgres psql -d garycio -c "TRUNCATE processed_messages;"
sudo -u postgres psql -d garycio -c "TRUNCATE conversation_states;"
```

---

## 🟡 IMPORTANTES (mejoran estabilidad y operación)

### 11. Monitoreo de salud (health check externo)
**Estado:** ❌ Nadie avisa si el bot se cae  
**Acción mínima:** Configurar un uptime checker gratuito (UptimeRobot, Better Uptime) que haga ping a `https://bot.garycio.org/health` cada 5 minutos.

### 12. Rate limiting de 360dialog
**Estado:** ❌ No verificado  
**Acción:** Confirmar con 360dialog los límites de:
- Mensajes por segundo/mes
- Webhook reintentos (ya manejamos dedup)
- Límite de templates

### 13. Plan de rollback
**Estado:** ❌ No documentado  
**Acción:** El backup del código viejo está en `/opt/garycio-backup-20260422`. Si algo sale mal:
```bash
pm2 stop garycio-bot
mv /opt/garycio /opt/garycio-refactor-rollback
mv /opt/garycio-backup-20260422 /opt/garycio
pm2 start /opt/garycio/ecosystem.config.js
```

### 14. Comunicación interna
**Estado:** ❌ No verificado  
**Acción:** Avisar al CEO y al equipo operativo que:
- El bot va a estar activo
- Cómo resolver escalaciones humanas (`/admin/human-escalations`)
- Qué hacer si algo sale mal (contacto técnico)

---

## 📋 Resumen de acciones por persona

### Para ustedes (negocio/configuración externa)
- [ ] Proporcionar dominio y apuntarlo a `204.168.183.96`
- [ ] Proporcionar `WHATSAPP_PHONE_NUMBER_ID` real de 360dialog
- [ ] Configurar webhook URL en dashboard de 360dialog
- [ ] Confirmar rate limits con 360dialog
- [ ] Preparar comunicación al equipo operativo

### Para mí / técnico (puedo hacerlo ahora o mañana temprano)
- [ ] PostgreSQL tuning (max_connections, shared_buffers)
- [ ] ulimit 1024 → 65535
- [ ] Log rotation PM2
- [ ] Backup automático DB
- [ ] Limpiar datos de prueba
- [ ] Certbot SSL (una vez que el dominio apunte)
- [ ] Cambiar TEST_MODE=false + PHONE_NUMBER_ID real
- [ ] Levantar bot y verificar health check

---

## ⏱️ Estimación de tiempo

| Tarea | Tiempo | Bloqueante |
|-------|--------|------------|
| Dominio apuntando | 5 min (si ya lo tienen) | ✅ Sí |
| SSL certbot | 5 min | ✅ Sí |
| WHATSAPP_PHONE_NUMBER_ID | 2 min | ✅ Sí |
| PostgreSQL tuning | 5 min | No |
| ulimit + logrotate + backup | 10 min | No |
| Limpiar datos prueba | 1 min | No |
| Configurar webhook 360dialog | 5 min | ✅ Sí |
| Levantar y testear | 10 min | No |
| **Total** | **~43 min** | 4 tareas bloqueantes |

**Conclusión:** Si me dan el dominio y el `PHONE_NUMBER_ID` hoy o mañana temprano, el resto lo configuro en 30 minutos y está listo para lanzar.
