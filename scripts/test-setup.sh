#!/bin/bash
# GARYCIO - Script de setup para pruebas locales
# Ejecutar desde la raiz del proyecto: bash scripts/test-setup.sh

set -e

PSQL="/c/Program Files/PostgreSQL/16/bin/psql.exe"
export PGPASSWORD=postgres

echo "=== GARYCIO Test Setup ==="
echo ""

# 1. Verificar PostgreSQL
echo "[1/4] Verificando PostgreSQL..."
"$PSQL" -U postgres -h localhost -tc "SELECT 'OK'" > /dev/null 2>&1 || {
  echo "ERROR: PostgreSQL no esta corriendo. Inicialo desde pgAdmin o Services."
  exit 1
}
echo "  PostgreSQL: OK"

# 2. Crear DB si no existe
echo "[2/4] Verificando base de datos..."
DB_EXISTS=$("$PSQL" -U postgres -h localhost -tc "SELECT 1 FROM pg_database WHERE datname='garycio'" | tr -d ' ')
if [ "$DB_EXISTS" != "1" ]; then
  "$PSQL" -U postgres -h localhost -c "CREATE DATABASE garycio"
  echo "  DB 'garycio' creada"
else
  echo "  DB 'garycio' ya existe"
fi

# 3. Migraciones
echo "[3/4] Ejecutando migraciones..."
npx ts-node src/database/migrate.ts

# 4. Verificar .env
echo "[4/4] Verificando .env..."
if [ ! -f .env ]; then
  echo "ERROR: No existe .env. Copia .env.example y completa los valores."
  exit 1
fi

# Verificar que TEST_MODE esta activo
if grep -q "TEST_MODE=true" .env; then
  echo "  TEST_MODE: ACTIVO (solo envia a whitelist)"
else
  echo "  ADVERTENCIA: TEST_MODE no esta activo. Los mensajes iran a TODOS los numeros!"
fi

echo ""
echo "=== Setup completo ==="
echo ""
echo "Proximos pasos:"
echo "  1. Terminal 1:  npm run dev"
echo "  2. Terminal 2:  ngrok http 3000"
echo "  3. Copiar URL de ngrok (https://xxxx.ngrok-free.app)"
echo "  4. En Meta Developer > WhatsApp > Configuration:"
echo "     - Callback URL: https://xxxx.ngrok-free.app/webhook"
echo "     - Verify token:  garycio_verify_2026"
echo "     - Suscribir: messages"
echo "  5. Enviar 'hola' al +1 555 169 3562 desde WhatsApp"
echo ""
