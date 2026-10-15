import type { PoolClient, Notification as PgNotification } from "pg";
import { pool } from "@workspace/db";
import { logger } from "./logger";

type RealtimeEvent = {
  userId: string;
  event: "message" | "notification";
  data: unknown;
};

const subscribers = new Map<string, Set<(event: RealtimeEvent) => void>>();
let listener: PoolClient | undefined;
let reconnectTimer: NodeJS.Timeout | undefined;
let closed = false;

export function subscribeUser(
  userId: string,
  callback: (event: RealtimeEvent) => void,
): () => void {
  const set = subscribers.get(userId) ?? new Set();
  set.add(callback);
  subscribers.set(userId, set);
  return () => {
    set.delete(callback);
    if (set.size === 0) subscribers.delete(userId);
  };
}

function handleNotification(message: PgNotification): void {
  if (message.channel !== "social_pulse_events" || !message.payload) return;
  let event: RealtimeEvent;
  try {
    event = JSON.parse(message.payload) as RealtimeEvent;
  } catch (error) {
    logger.warn({ err: error }, "Discarding malformed realtime notification");
    return;
  }
  for (const callback of subscribers.get(event.userId) ?? []) callback(event);
}

async function connectListener(): Promise<void> {
  if (closed) return;
  try {
    listener = await pool.connect();
    listener.on("notification", handleNotification);
    listener.on("error", (error) => {
      logger.error({ err: error }, "Realtime database listener failed");
      listener?.release(true);
      listener = undefined;
      scheduleReconnect();
    });
    await listener.query("LISTEN social_pulse_events");
    logger.info("Realtime database listener connected");
  } catch (error) {
    listener?.release(true);
    listener = undefined;
    logger.error({ err: error }, "Unable to start realtime database listener");
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (closed || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectListener();
  }, 2000);
  reconnectTimer.unref();
}

export async function publishUserEvent(
  userId: string,
  event: RealtimeEvent["event"],
  data: unknown,
): Promise<void> {
  const payload = JSON.stringify({ userId, event, data } satisfies RealtimeEvent);
  await pool.query("SELECT pg_notify($1, $2)", ["social_pulse_events", payload]);
}

export async function startRealtimeListener(): Promise<void> {
  closed = false;
  await connectListener();
}

export async function stopRealtimeListener(): Promise<void> {
  closed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (listener) {
    await listener.query("UNLISTEN social_pulse_events").catch(() => undefined);
    listener.release();
    listener = undefined;
  }
}
