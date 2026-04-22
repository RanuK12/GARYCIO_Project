const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const CSV_DIR = '/opt/garycio/data/rutas';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://garycio:Fletero91@localhost:5432/garycio'
});

const DIAS_POR_ARCHIVO = {
  'LJ': 'Lunes y Jueves',
  'MS': 'Mi\u00e9rcoles y S\u00e1bado',
  'MV': 'Martes y Viernes',
};

function getDiasRecoleccion(filename) {
  const prefix = filename.split('_')[0].toUpperCase();
  return DIAS_POR_ARCHIVO[prefix] || null;
}

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (!cleaned.startsWith('54') && cleaned.length >= 10) {
    cleaned = '54' + cleaned;
  }
  return cleaned;
}

function buildDireccion(row) {
  const parts = [];
  if (row['Calle']) parts.push(row['Calle'] + ' ' + (row['N\u00famero'] || ''));
  if (row['Entrecalle 1'] && row['Entrecalle 2']) {
    parts.push('entre ' + row['Entrecalle 1'] + ' y ' + row['Entrecalle 2']);
  }
  if (row['Localidad']) parts.push(row['Localidad']);
  return parts.join(', ').trim();
}

function parseLatLon(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

async function main() {
  console.log('=== ACTUALIZAR DONANTES EXISTENTES CON DATOS CSV ===\n');

  const csvData = new Map();
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));

  for (const file of files) {
    const dias = getDiasRecoleccion(file);
    const records = parse(fs.readFileSync(path.join(CSV_DIR, file), 'utf-8'), {
      columns: true, skip_empty_lines: true, trim: true,
    });

    for (const row of records) {
      const telefono = normalizePhone(row['Celular']);
      if (!telefono || telefono.length < 10) continue;

      csvData.set(telefono, {
        nombre: (row['Nombre'] || '') + ' ' + (row['Apellido'] || ''),
        direccion: buildDireccion(row),
        dias_recoleccion: dias,
        latitud: parseLatLon(row['Latitud']),
        longitud: parseLatLon(row['Longitud']),
        sector: row['Sector'] ? parseInt(row['Sector']) || null : null,
        archivo: file,
      });
    }
  }
  console.log('Datos CSV cargados: ' + csvData.size + ' donantes unicos');

  const client = await pool.connect();
  try {
    const { rows: existentes } = await client.query(
      'SELECT id, telefono, nombre, estado, direccion, latitud, longitud, sector, dias_recoleccion FROM donantes WHERE latitud IS NULL OR longitud IS NULL OR sector IS NULL'
    );
    console.log('Existentes sin datos geo: ' + existentes.length);

    let actualizados = 0;
    let noEnCSV = 0;
    let errores = 0;

    for (const ex of existentes) {
      const csv = csvData.get(ex.telefono);
      if (!csv) {
        noEnCSV++;
        continue;
      }

      try {
        await client.query(
          `UPDATE donantes SET
            nombre = COALESCE(NULLIF($1, ''), nombre),
            direccion = COALESCE(NULLIF($2, ''), direccion),
            latitud = $3,
            longitud = $4,
            sector = $5,
            dias_recoleccion = COALESCE(NULLIF($6, ''), dias_recoleccion),
            updated_at = NOW(),
            notas = COALESCE(notas, '') || E'\\nActualizado desde CSV: ' || $7
          WHERE id = $8`,
          [csv.nombre.trim(), csv.direccion, csv.latitud, csv.longitud, csv.sector, csv.dias_recoleccion, csv.archivo, ex.id]
        );
        actualizados++;
      } catch (err) {
        console.error('Error actualizando ' + ex.telefono + ':', err.message);
        errores++;
      }
    }

    console.log('\nActualizados: ' + actualizados);
    console.log('No encontrados en CSV: ' + noEnCSV);
    console.log('Errores: ' + errores);

    console.log('\n=== NORMALIZAR DIAS_RECOLECCION ===');
    let normalizados = 0;
    for (const [telefono, csv] of csvData) {
      const { rowCount } = await client.query(
        `UPDATE donantes SET dias_recoleccion = $1 WHERE telefono = $2 AND (dias_recoleccion IS NULL OR dias_recoleccion = '' OR dias_recoleccion NOT IN ('Lunes y Jueves', 'Mi\u00e9rcoles y S\u00e1bado', 'Martes y Viernes'))`,
        [csv.dias_recoleccion, telefono]
      );
      normalizados += rowCount;
    }
    console.log('Dias normalizados: ' + normalizados);

    const { rows: totales } = await client.query('SELECT COUNT(*) FROM donantes');
    const { rows: conCoords } = await client.query('SELECT COUNT(*) FROM donantes WHERE latitud IS NOT NULL AND longitud IS NOT NULL');
    const { rows: conSector } = await client.query('SELECT COUNT(*) FROM donantes WHERE sector IS NOT NULL');
    const { rows: conDias } = await client.query("SELECT COUNT(*) FROM donantes WHERE dias_recoleccion IS NOT NULL AND dias_recoleccion <> ''");
    const { rows: porDias } = await client.query("SELECT dias_recoleccion, COUNT(*) FROM donantes WHERE dias_recoleccion IN ('Lunes y Jueves', 'Mi\u00e9rcoles y S\u00e1bado', 'Martes y Viernes') GROUP BY dias_recoleccion ORDER BY COUNT(*) DESC");
    const { rows: porEstado } = await client.query('SELECT estado, COUNT(*) FROM donantes GROUP BY estado ORDER BY COUNT(*) DESC');

    console.log('\n=== RESULTADO FINAL ===');
    console.log('Total donantes: ' + totales[0].count);
    console.log('Con coordenadas: ' + conCoords[0].count);
    console.log('Con sector: ' + conSector[0].count);
    console.log('Con dias_recoleccion: ' + conDias[0].count);
    console.log('\nPor dias de recoleccion:');
    for (const r of porDias) {
      console.log('  ' + r.dias_recoleccion + ': ' + r.count);
    }
    console.log('\nPor estado:');
    for (const r of porEstado) {
      console.log('  ' + r.estado + ': ' + r.count);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
