import { env } from "./config/env";
import { logger } from "./config/logger";
import { testConnection } from "./database";
import { initBot, registerMessageHandler } from "./bot";
import { initScheduler } from "./services/scheduler";
import { initReporteDiario } from "./services/reporte-diario";

async function main(): Promise<void> {
  logger.info("Iniciando GARYCIO System...");

  const dbOk = await testConnection();
  if (!dbOk) {
    logger.fatal("No se pudo conectar a la base de datos. Abortando.");
    process.exit(1);
  }

  const sock = await initBot();
  registerMessageHandler(sock);

  initScheduler();
  initReporteDiario();

  logger.info({ port: env.PORT }, "GARYCIO System iniciado correctamente");
}

main().catch((err) => {
  logger.fatal(err, "Error fatal al iniciar");
  process.exit(1);
});
