const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const CSV_DIR = '/opt/garycio/data/rutas';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://garycio:Fletero91@localhost:5432/garycio'
});

// Mapeo archivo -> dias_recoleccion
const DIAS_POR_ARCHIVO = {
  'LJ': 'Lunes y Jueves',
  'MS': 'Miércoles y Sábado',
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
  if (row['Calle']) parts.push(row['Calle'] + ' ' + (row['Número'] || ''));
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
  console.log('=== IMPORTACION UNIFICADA DE DONANTES ===\n');

  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  console.log('Archivos CSV encontrados:', files.length);

  const allDonantes = [];
  const duplicados = new Map(); // telefono -> [filas]
  const telefonosVistos = new Set();

  for (const file of files) {
    const dias = getDiasRecoleccion(file);
    const filepath = path.join(CSV_DIR, file);
    const content = fs.readFileSync(filepath, 'utf-8');

    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`  ${file}: ${records.length} registros -> ${dias}`);

    for (const row of records) {
      const telefono = normalizePhone(row['Celular']);
      if (!telefono || telefono.length < 10) {
        continue;
      }

      const donante = {
        external_id: row['ID'] || null,
        nombre: `${row['Nombre'] || ''} ${row['Apellido'] || ''}`.trim(),
        telefono,
        direccion: buildDireccion(row),
        dias_recoleccion: dias,
        latitud: parseLatLon(row['Latitud']),
        longitud: parseLatLon(row['Longitud']),
        sector: row['Sector'] ? parseInt(row['Sector']) || null : null,
        localidad: row['Localidad'] || null,
        provincia: row['Provincia'] || null,
        fecha_nacimiento: row['Fecha de nacimiento'] || null,
        archivo_origen: file,
      };

      if (telefonosVistos.has(telefono)) {
        if (!duplicados.has(telefono)) duplicados.set(telefono, []);
        duplicados.get(telefono).push({ file, nombre: donante.nombre });
      } else {
        telefonosVistos.add(telefono);
        allDonantes.push(donante);
      }
    }
  }

  console.log(`\nTotal donantes unicos en CSVs: ${allDonantes.length}`);
  console.log(`Duplicados por telefono: ${duplicados.size}`);

  if (duplicados.size > 0) {
    console.log('\n--- Primeros 10 duplicados ---');
    let i = 0;
    for (const [tel, items] of duplicados) {
      console.log(`  ${tel}: ${items.map(x => x.file).join(', ')}`);
      if (++i >= 10) break;
    }
  }

  // Consultar donantes existentes
  const client = await pool.connect();
  try {
    const { rows: existentes } = await client.query('SELECT telefono, nombre, direccion, latitud, longitud, sector, estado FROM donantes');
    const existentesMap = new Map(existentes.map(r => [r.telefono, r]));
    console.log(`\nDonantes existentes en DB: ${existentes.length}`);

    let insertados = 0;
    let actualizados = 0;
    let sinCambios = 0;
    let errores = 0;

    // Procesar en batches de 100 para no saturar
    const BATCH_SIZE = 100;
    for (let i = 0; i < allDonantes.length; i += BATCH_SIZE) {
      const batch = allDonantes.slice(i, i + BATCH_SIZE);

      for (const d of batch) {
        const existente = existentesMap.get(d.telefono);

        if (!existente) {
          // INSERT nuevo
          try {
            await client.query(
              `INSERT INTO donantes 
               (nombre, telefono, direccion, dias_recoleccion, latitud, longitud, sector, estado, donando_actualmente, fecha_alta, notas)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'activa', true, NOW(), $8)`,
              [d.nombre, d.telefono, d.direccion, d.dias_recoleccion, d.latitud, d.longitud, d.sector,
               `Importado desde ${d.archivo_origen}. ID original: ${d.external_id || 'N/A'}`]
            );
            insertados++;
          } catch (err) {
            console.error(`Error insertando ${d.telefono}:`, err.message);
            errores++;
          }
        } else {
          // UPDATE si faltan datos geográficos o dirección
          const necesitaUpdate = !existente.latitud || !existente.longitud || !existente.sector || !existente.direccion;
          if (necesitaUpdate) {
            try {
              await client.query(
                `UPDATE donantes SET
                   direccion = COALESCE(NULLIF(direccion, ''), $1),
                   latitud = COALESCE(latitud, $2),
                   longitud = COALESCE(longitud, $3),
                   sector = COALESCE(sector, $4),
                   dias_recoleccion = COALESCE(NULLIF(dias_recoleccion, ''), $5),
                   updated_at = NOW(),
                   notas = COALESCE(notas, '') || '\nActualizado desde CSV: ' || $6
                 WHERE telefono = $7`,
                [d.direccion, d.latitud, d.longitud, d.sector, d.dias_recoleccion, d.archivo_origen, d.telefono]
              );
              actualizados++;
            } catch (err) {
              console.error(`Error actualizando ${d.telefono}:`, err.message);
              errores++;
            }
          } else {
            sinCambios++;
          }
        }
      }

      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= allDonantes.length) {
        console.log(`  Progreso: ${Math.min(i + BATCH_SIZE, allDonantes.length)}/${allDonantes.length} (I:${insertados} U:${actualizados} S:${sinCambios} E:${errores})`);
      }
    }

    // Reporte final
    const { rows: finalCount } = await client.query('SELECT estado, COUNT(*) FROM donantes GROUP BY estado');
    const { rows: totalDonantes } = await client.query('SELECT COUNT(*) FROM donantes');
    const { rows: conCoords } = await client.query('SELECT COUNT(*) FROM donantes WHERE latitud IS NOT NULL AND longitud IS NOT NULL');
    const { rows: conSector } = await client.query('SELECT COUNT(*) FROM donantes WHERE sector IS NOT NULL');

    console.log('\n=== RESULTADO FINAL ===');
    console.log(`Total donantes en DB: ${totalDonantes[0].count}`);
    console.log(`Con coordenadas: ${conCoords[0].count}`);
    console.log(`Con sector: ${conSector[0].count}`);
    console.log(`Nuevos insertados: ${insertados}`);
    console.log(`Actualizados (datos nuevos): ${actualizados}`);
    console.log(`Sin cambios (ya completos): ${sinCambios}`);
    console.log(`Errores: ${errores}`);
    console.log('\nPor estado:');
    for (const r of finalCount) {
      console.log(`  ${r.estado}: ${r.count}`);
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
