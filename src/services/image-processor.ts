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
 *
 * Estrategia:
 * - TOTAL/monto: buscar primero "TOTAL:" que es el valor final del ticket
 * - Litros: buscar "X" como indicador de cantidad (ej: "72.142 X $83") o "litros"
 * - Bidones: buscar "bidones" o "total bidones"
 * - Patente: excluir falsos positivos (IVA, CAE, etc.)
 */
export function analizarTextoComprobante(texto: string): DatosExtraidos {
  const lower = texto.toLowerCase();
  let confianza = 0;

  // ── MONTO: buscar TOTAL primero (es el valor más importante del ticket) ──
  let monto: number | null = null;

  // Prioridad 1: "TOTAL: $9346.97" o "TOTAL: $ 9.346,97"
  const totalMatch = texto.match(/TOTAL\s*[:=]?\s*\$?\s*([\d.,]+)/i);
  if (totalMatch) {
    monto = parsearMontoArgentino(totalMatch[1]);
    confianza += 25;
  }

  // Prioridad 2: "$ 9.346,97" (formato argentino con punto como separador de miles)
  if (monto === null) {
    const montoArg = texto.match(/\$\s*([\d.]+,\d{2})/);
    if (montoArg) {
      monto = parsearMontoArgentino(montoArg[1]);
      confianza += 25;
    }
  }

  // Prioridad 3: cualquier "$ numero"
  if (monto === null) {
    const montoSimple = texto.match(/\$\s*(\d+[.,]?\d*)/);
    if (montoSimple) {
      monto = parsearMontoArgentino(montoSimple[1]);
      confianza += 20;
    }
  }

  // ── LITROS ──
  let litros: number | null = null;

  // Prioridad 1: "72.142 X" (formato de ticket: cantidad X precio)
  const litrosXMatch = texto.match(/(\d+[.,]\d+)\s*[Xx]\s*\$?\s*\d/);
  if (litrosXMatch) {
    litros = parseFloat(litrosXMatch[1].replace(",", "."));
    confianza += 25;
  }

  // Prioridad 2: "Litros: 55" o "55 litros" o "55 lts"
  if (litros === null) {
    const litrosMatch = texto.match(/(\d+[.,]?\d*)\s*(?:lt(?:s|ros)?|liter|litro)/i)
      || texto.match(/(?:litros?|lts?|volumen)\s*[:\-=]?\s*(\d+[.,]?\d*)/i);
    if (litrosMatch) {
      litros = parseFloat((litrosMatch[1] || litrosMatch[2]).replace(",", "."));
      confianza += 25;
    }
  }

  // ── BIDONES ──
  let bidones: number | null = null;

  // "total bidones: 28" o "28 bidones"
  const bidonesTotalMatch = texto.match(/(?:total\s+)?bidones?\s*[:\-=]?\s*(\d+)/i)
    || texto.match(/(\d+)\s*bidones?/i);
  if (bidonesTotalMatch) {
    bidones = parseInt(bidonesTotalMatch[1], 10);
    confianza += 25;
  }

  // ── FECHA ──
  let fecha: string | null = null;
  // Buscar "Fecha" primero para tomar la fecha correcta (no cualquier dd/mm/yy)
  const fechaLabelMatch = texto.match(/(?:fecha|fec\.?|vto\.?)\s*[:\-=]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (fechaLabelMatch) {
    fecha = `${fechaLabelMatch[1]}/${fechaLabelMatch[2]}/${fechaLabelMatch[3]}`;
    confianza += 10;
  } else {
    const fechaMatch = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (fechaMatch) {
      fecha = `${fechaMatch[1]}/${fechaMatch[2]}/${fechaMatch[3]}`;
      confianza += 10;
    }
  }

  // ── PATENTE (formato argentino, evitando falsos positivos) ──
  let patente: string | null = null;
  // Formato nuevo: AA 123 BB | Formato viejo: ABC 123
  // Excluir: IVA, CAE, ICL, Sft, etc.
  const exclusiones = /^(IVA|CAE|ICL|SFT|PER|GRA|EXE|DC\s)/i;
  const patenteMatches = texto.matchAll(/\b([A-Z]{2})\s*(\d{3})\s*([A-Z]{2})\b/gi);
  for (const m of patenteMatches) {
    if (!exclusiones.test(m[0])) {
      patente = m[0].toUpperCase().replace(/\s+/g, " ");
      confianza += 10;
      break;
    }
  }
  if (!patente) {
    const patenteVieja = texto.match(/\b(?:patente|pat\.?)\s*[:\-=]?\s*([A-Z]{2,3}\s*\d{3}\s*[A-Z]{0,3})/i);
    if (patenteVieja) {
      patente = patenteVieja[1].toUpperCase().replace(/\s+/g, " ");
      confianza += 10;
    }
  }

  // ── DIRECCIÓN ──
  let direccion: string | null = null;
  const dirMatch = texto.match(/(?:calle|av\.?|avenida|bvd?\.?|bvar\.?)\s+[\w\s]+\d+/i);
  if (dirMatch) {
    direccion = dirMatch[0].trim();
    confianza += 5;
  }

  // Confianza mínima si hay texto
  if (texto.length > 10 && confianza === 0) confianza = 5;

  return {
    textoCompleto: texto.slice(0, 2000),
    litros, monto, bidones, fecha, direccion, patente,
    confianza: Math.min(confianza, 100),
  };
}

/**
 * Parsea un monto en formato argentino:
 * "9.346,97" → 9346.97
 * "9346.97" → 9346.97
 * "17,627.50" → 17627.50
 */
function parsearMontoArgentino(raw: string): number {
  // Si tiene formato "9.346,97" (punto=miles, coma=decimales)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) {
    return parseFloat(raw.replace(/\./g, "").replace(",", "."));
  }
  // Si tiene formato "17,627.50" (coma=miles, punto=decimales)
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) {
    return parseFloat(raw.replace(/,/g, ""));
  }
  // Formato simple "9346.97" o "9346,97"
  return parseFloat(raw.replace(",", "."));
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
