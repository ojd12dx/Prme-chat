import app from "./app";
import { logger } from "./lib/logger";
import { startRealtimeListener, stopRealtimeListener } from "./lib/realtime";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void startRealtimeListener();
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  // Open SSE streams would otherwise keep server.close() waiting forever.
  const forceExit = setTimeout(() => process.exit(0), 10_000);
  forceExit.unref();
  server.closeIdleConnections();
  server.close();
  await stopRealtimeListener().catch(() => undefined);
  await pool.end().catch(() => undefined);
  server.closeAllConnections();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
