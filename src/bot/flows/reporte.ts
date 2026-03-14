import { FlowHandler, ConversationState, FlowResponse } from "./types";
import { enviarReportePDF, marcarReporteEnviado } from "../../services/reporte-diario";
import { logger } from "../../config/logger";

/**
 * Flow de reporte on-demand.
 * El CEO envía "reporte" y recibe el PDF al instante.
 * Se marca como enviado para evitar el envío automático del día.
 *
 * Secuencia:
 * 0 - Genera y envía el PDF
 */
export const reporteFlow: FlowHandler = {
  name: "reporte",
  keyword: ["reporte", "informe", "resumen del dia", "reporte diario"],

  async handle(state: ConversationState, _message: string): Promise<FlowResponse> {
    try {
      // Dispara la generación y envío en background
      enviarReportePDF().then(() => {
        marcarReporteEnviado();
      }).catch((err) => {
        logger.error({ err }, "Error al generar reporte on-demand");
      });

      return {
        reply:
          "📊 Generando tu reporte diario con gráficos...\n" +
          "Te lo envío como PDF en unos segundos. ⏳",
        endFlow: true,
      };
    } catch (err) {
      logger.error({ err }, "Error al iniciar reporte on-demand");
      return {
        reply: "Hubo un error al generar el reporte. Intentá de nuevo en unos minutos.",
        endFlow: true,
      };
    }
  },
};
