import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { db } from "../database";
import { donantes } from "../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../config/logger";

const EXPORT_DIR = path.join(process.cwd(), "tmp");

/**
 * Genera un archivo XLS con los contactos nuevos (estado="nueva")
 * y lo guarda en /tmp. Retorna la ruta al archivo.
 *
 * Columnas: Nombre, Teléfono, Dirección, Fecha de registro, Notas
 */
export async function generarXLSContactosNuevos(): Promise<{
  filePath: string;
  fileName: string;
  total: number;
}> {
  // Asegurar que el directorio tmp exista
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const nuevos = await db
    .select({
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      direccion: donantes.direccion,
      notas: donantes.notas,
      createdAt: donantes.createdAt,
    })
    .from(donantes)
    .where(and(eq(donantes.estado, "nueva"), eq(donantes.donandoActualmente, false)))
    .orderBy(desc(donantes.createdAt));

  // Preparar datos para el XLS
  const rows = nuevos.map((c) => ({
    Nombre: c.nombre || "",
    "Teléfono": c.telefono || "",
    "Dirección": c.direccion || "",
    "Fecha registro": c.createdAt
      ? new Date(c.createdAt).toLocaleDateString("es-AR")
      : "",
    Notas: c.notas || "",
  }));

  // Crear workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  // Ajustar ancho de columnas
  ws["!cols"] = [
    { wch: 30 }, // Nombre
    { wch: 18 }, // Teléfono
    { wch: 45 }, // Dirección
    { wch: 15 }, // Fecha registro
    { wch: 40 }, // Notas
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Contactos Nuevos");

  // Generar nombre con fecha
  const fecha = new Date().toISOString().split("T")[0];
  const fileName = `Contactos_Nuevos_GARYCIO_${fecha}.xlsx`;
  const filePath = path.join(EXPORT_DIR, fileName);

  // Escribir archivo
  XLSX.writeFile(wb, filePath);

  logger.info({ total: nuevos.length, filePath }, "XLS de contactos nuevos generado");

  return { filePath, fileName, total: nuevos.length };
}

/**
 * Activa una donante: cambia estado de "nueva" a "activa" y donandoActualmente=true.
 * Retorna los datos actualizados o null si no se encontró.
 */
export async function activarDonante(donanteId: number): Promise<{
  nombre: string;
  telefono: string;
  direccion: string;
} | null> {
  const [donante] = await db
    .select({
      id: donantes.id,
      nombre: donantes.nombre,
      telefono: donantes.telefono,
      direccion: donantes.direccion,
      estado: donantes.estado,
    })
    .from(donantes)
    .where(eq(donantes.id, donanteId))
    .limit(1);

  if (!donante) return null;

  await db
    .update(donantes)
    .set({
      estado: "activa",
      donandoActualmente: true,
      fechaAlta: new Date().toISOString().split("T")[0],
      updatedAt: new Date(),
      notas: donante.estado === "nueva"
        ? "Activada desde panel admin WhatsApp"
        : undefined,
    })
    .where(eq(donantes.id, donanteId));

  logger.info({ donanteId, nombre: donante.nombre }, "Donante activada desde admin WhatsApp");

  return {
    nombre: donante.nombre,
    telefono: donante.telefono,
    direccion: donante.direccion,
  };
}

/** Limpia archivos temporales viejos (>1 hora) */
export function limpiarTmpViejos(): void {
  try {
    if (!fs.existsSync(EXPORT_DIR)) return;
    const ahora = Date.now();
    for (const file of fs.readdirSync(EXPORT_DIR)) {
      const fp = path.join(EXPORT_DIR, file);
      const stat = fs.statSync(fp);
      if (ahora - stat.mtimeMs > 60 * 60 * 1000) {
        fs.unlinkSync(fp);
      }
    }
  } catch { /* no es crítico */ }
}
