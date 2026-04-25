import { and, desc, eq } from "drizzle-orm";
import { db } from "../database";
import { mensajesLog } from "../database/schema";
import { logger } from "../config/logger";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function isConversationWindowOpen(phone: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ createdAt: mensajesLog.createdAt })
      .from(mensajesLog)
      .where(and(eq(mensajesLog.telefono, phone), eq(mensajesLog.direccion, "entrante")))
      .orderBy(desc(mensajesLog.id))
      .limit(1);

    if (rows.length === 0) return false;
    const last = rows[0].createdAt;
    if (!last) return false;

    return Date.now() - new Date(last).getTime() < WINDOW_MS;
  } catch (err) {
    logger.error({ phone, err }, "Error consultando ventana 24h — por seguridad devuelve false");
    return false;
  }
}
