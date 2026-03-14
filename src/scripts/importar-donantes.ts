import { readFileSync } from "fs";
import { parse } from "path";
import { db } from "../database";
import { donantes, zonas } from "../database/schema";
import { logger } from "../config/logger";

/**
 * Script para importar donantes desde un archivo CSV.
 *
 * Formato esperado del CSV:
 * nombre,telefono,direccion,zona,dias_recoleccion,donando_actualmente
 *
 * Uso: ts-node src/scripts/importar-donantes.ts <archivo.csv> <zona_id>
 */
async function importarDonantes(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Uso: ts-node src/scripts/importar-donantes.ts <archivo.csv> <zona_id>");
    console.log("Ejemplo: ts-node src/scripts/importar-donantes.ts donantes_zona1.csv 1");
    process.exit(1);
  }

  const [archivo, zonaIdStr] = args;
  const zonaId = parseInt(zonaIdStr, 10);

  const contenido = readFileSync(archivo, "utf-8");
  const lineas = contenido.split("\n").filter((l) => l.trim());
  const encabezados = lineas[0].split(",").map((h) => h.trim().toLowerCase());

  const colNombre = encabezados.indexOf("nombre");
  const colTelefono = encabezados.indexOf("telefono");
  const colDireccion = encabezados.indexOf("direccion");
  const colDias = encabezados.indexOf("dias_recoleccion");
  const colDonando = encabezados.indexOf("donando_actualmente");

  if (colNombre === -1 || colTelefono === -1 || colDireccion === -1) {
    console.error("El CSV debe tener al menos: nombre, telefono, direccion");
    process.exit(1);
  }

  let importados = 0;
  let errores = 0;

  for (let i = 1; i < lineas.length; i++) {
    const campos = lineas[i].split(",").map((c) => c.trim());

    try {
      await db.insert(donantes).values({
        nombre: campos[colNombre],
        telefono: campos[colTelefono],
        direccion: campos[colDireccion],
        zonaId,
        diasRecoleccion: colDias >= 0 ? campos[colDias] : null,
        donandoActualmente: colDonando >= 0 ? campos[colDonando] === "si" : true,
      });
      importados++;
    } catch (err) {
      errores++;
      console.error(`  Error en línea ${i + 1} (${campos[colTelefono]}): ${(err as Error).message}`);
    }
  }

  console.log(`\nImportación completada:`);
  console.log(`  Importados: ${importados}`);
  console.log(`  Errores: ${errores}`);
  console.log(`  Total procesados: ${importados + errores}`);

  process.exit(0);
}

importarDonantes();
