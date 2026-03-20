import { downloadMedia } from "../bot/client";
import { db } from "../database";
import {
  registrosRecoleccion,
  registrosCombustible,
  registrosLavado,
} from "../database/schema";
import { logger } from "../config/logger";
import Tesseract from "tesseract.js";
import fs from "fs";
import path from "path";

// ============================================================
// Directorio para guardar fotos localmente
// ============================================================
const PHOTOS_DIR = path.join(process.cwd(), "uploads", "comprobantes");

function ensurePhotosDir(): void {
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }
}

// ============================================================
// Tipos de comprobante
// ============================================================

export type TipoComprobante = "recoleccion" | "combustible" | "lavado";

export interface DatosExtraidos {
  textoCompleto: string;
  litros: number | null;
  monto: number | null;
  bidones: number | null;
  fecha: string | null;
  direccion: string | null;
  patente: string | null;
  confianza: number; // 0-100, qué tan seguro estamos de los datos
}

// ============================================================
// Descargar y guardar foto de WhatsApp
// ============================================================

/**
 * Descarga una imagen de WhatsApp, la guarda localmente,
 * y retorna la ruta del archivo guardado.
 */
export async function descargarYGuardarFoto(
  mediaId: string,
  tipo: TipoComprobante,
  choferId: number,
): Promise<string> {
  ensurePhotosDir();

  const { buffer, mimeType } = await downloadMedia(mediaId);

  // Determinar extensión
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";

  // Nombre: tipo_choferId_timestamp.ext
  const fileName = `${tipo}_chofer${choferId}_${Date.now()}.${ext}`;
  const filePath = path.join(PHOTOS_DIR, fileName);

  fs.writeFileSync(filePath, buffer);

  logger.info({ filePath, tipo, choferId, size: buffer.length }, "Foto guardada");

  return filePath;
}

// ============================================================
// OCR: Extraer texto de la imagen
// ============================================================

/**
 * Usa Tesseract.js para extraer texto de una imagen.
 * Detecta español por defecto.
 */
export async function extraerTextoDeImagen(imagePath: string): Promise<string> {
  try {
    const result = await Tesseract.recognize(imagePath, "spa", {
      logger: () => {}, // silenciar logs de progreso
    });

    const texto = result.data.text.trim();
    logger.info(
      { imagePath, textLength: texto.length, confidence: result.data.confidence },
      "OCR completado",
    );

    return texto;
  } catch (err) {
    logger.error({ imagePath, err }, "Error en OCR");
    return "";
  }
}

// ============================================================
// Analizar texto extraído y encontrar datos relevantes
// ============================================================

/**
 * Parsea el texto OCR buscando datos relevantes:
 * litros, montos, bidones, fechas, patentes, direcciones.
 */
export function analizarTextoComprobante(texto: string): DatosExtraidos {
  const lower = texto.toLowerCase();
  let confianza = 0;

  // Buscar litros (ej: "45.5 lt", "100 litros", "LTS: 85")
  let litros: number | null = null;
  const litrosMatch = texto.match(/(\d+[.,]?\d*)\s*(?:lt(?:s|ros)?|liter|litro)/i)
    || texto.match(/(?:litros?|lts?|volumen)\s*[:\-=]?\s*(\d+[.,]?\d*)/i);
  if (litrosMatch) {
    litros = parseFloat((litrosMatch[1] || litrosMatch[1]).replace(",", "."));
    confianza += 25;
  }

  // Buscar monto ($, pesos, total)
  let monto: number | null = null;
  const montoMatch = texto.match(/\$\s*(\d+[.,]?\d*)/i)
    || texto.match(/(?:total|importe|monto|precio)\s*[:\-=]?\s*\$?\s*(\d+[.,]?\d*)/i);
  if (montoMatch) {
    monto = parseFloat(montoMatch[1].replace(",", "."));
    confianza += 25;
  }

  // Buscar bidones (ej: "25 bidones", "bid: 18")
  let bidones: number | null = null;
  const bidonesMatch = texto.match(/(\d+)\s*(?:bidones?|bid)/i)
    || texto.match(/(?:bidones?|bid)\s*[:\-=]?\s*(\d+)/i);
  if (bidonesMatch) {
    bidones = parseInt(bidonesMatch[1] || bidonesMatch[2], 10);
    confianza += 25;
  }

  // Buscar fecha (dd/mm/yyyy, dd-mm-yyyy)
  let fecha: string | null = null;
  const fechaMatch = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (fechaMatch) {
    fecha = `${fechaMatch[1]}/${fechaMatch[2]}/${fechaMatch[3]}`;
    confianza += 10;
  }

  // Buscar patente (formato argentino: AA 123 BB o ABC 123)
  let patente: string | null = null;
  const patenteMatch = texto.match(/([A-Z]{2,3})\s*(\d{3})\s*([A-Z]{2,3})/i)
    || texto.match(/([A-Z]{3})\s*(\d{3})/i);
  if (patenteMatch) {
    patente = patenteMatch[0].toUpperCase().replace(/\s+/g, " ");
    confianza += 10;
  }

  // Buscar dirección (calle + número)
  let direccion: string | null = null;
  const dirMatch = texto.match(/(?:calle|av\.?|avenida|bvd?\.?)\s+[\w\s]+\d+/i);
  if (dirMatch) {
    direccion = dirMatch[0].trim();
    confianza += 5;
  }

  // Confianza mínima si hay texto
  if (texto.length > 10 && confianza === 0) confianza = 5;

  return {
    textoCompleto: texto.slice(0, 2000), // limitar tamaño
    litros,
    monto,
    bidones,
    fecha,
    direccion,
    patente,
    confianza: Math.min(confianza, 100),
  };
}

// ============================================================
// Proceso completo: descargar, OCR, analizar, guardar en DB
// ============================================================

export interface ResultadoProcesamiento {
  filePath: string;
  datosExtraidos: DatosExtraidos;
  guardadoEnDB: boolean;
  registroId: number | null;
}

/**
 * Proceso completo de comprobante:
 * 1. Descarga la imagen de WhatsApp
 * 2. Ejecuta OCR para extraer texto
 * 3. Analiza el texto buscando datos (litros, montos, etc.)
 * 4. Guarda en la base de datos correspondiente
 */
export async function procesarComprobante(
  mediaId: string,
  tipo: TipoComprobante,
  choferId: number,
  datosAdicionales?: {
    litros?: number;
    bidones?: number;
    monto?: number;
    camionId?: number;
  },
): Promise<ResultadoProcesamiento> {
  // 1. Descargar y guardar
  const filePath = await descargarYGuardarFoto(mediaId, tipo, choferId);

  // 2. OCR
  const textoOCR = await extraerTextoDeImagen(filePath);

  // 3. Analizar
  const datos = analizarTextoComprobante(textoOCR);

  // Combinar datos del OCR con datos que el chofer ya cargó manualmente
  const litrosFinal = datosAdicionales?.litros || datos.litros;
  const bidonesFinal = datosAdicionales?.bidones || datos.bidones;
  const montoFinal = datosAdicionales?.monto || datos.monto;

  // 4. Guardar en DB según tipo
  let registroId: number | null = null;
  let guardadoEnDB = false;

  try {
    switch (tipo) {
      case "recoleccion": {
        const [row] = await db.insert(registrosRecoleccion).values({
          fecha: new Date().toISOString().split("T")[0],
          litrosTotales: litrosFinal?.toString() || null,
          bidonesTotales: bidonesFinal || null,
          fotoComprobante: filePath,
        }).returning({ id: registrosRecoleccion.id });
        registroId = row.id;
        guardadoEnDB = true;
        break;
      }

      case "combustible": {
        const [row] = await db.insert(registrosCombustible).values({
          camionId: datosAdicionales?.camionId || 1,
          choferId,
          fecha: new Date().toISOString().split("T")[0],
          litros: litrosFinal?.toString() || null,
          monto: montoFinal?.toString() || null,
          fotoComprobante: filePath,
        }).returning({ id: registrosCombustible.id });
        registroId = row.id;
        guardadoEnDB = true;
        break;
      }

      case "lavado": {
        const [row] = await db.insert(registrosLavado).values({
          camionId: datosAdicionales?.camionId || 1,
          fecha: new Date().toISOString().split("T")[0],
          fotoComprobante: filePath,
          notas: textoOCR.length > 0 ? `OCR: ${textoOCR.slice(0, 500)}` : null,
        }).returning({ id: registrosLavado.id });
        registroId = row.id;
        guardadoEnDB = true;
        break;
      }
    }
  } catch (err) {
    logger.error({ tipo, choferId, err }, "Error guardando comprobante en DB");
  }

  logger.info(
    {
      tipo,
      choferId,
      registroId,
      datosExtraidos: {
        litros: datos.litros,
        monto: datos.monto,
        bidones: datos.bidones,
        confianza: datos.confianza,
      },
    },
    "Comprobante procesado",
  );

  return { filePath, datosExtraidos: datos, guardadoEnDB, registroId };
}
