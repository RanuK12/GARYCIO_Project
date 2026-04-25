/**
 * P0.12 — Debounce 10s por teléfono para mensajes entrantes.
 *
 * Razón: las donantes mandan varios mensajes seguidos cortos ("hola",
 * "no vinieron", "ayer"). Si el bot responde al primero ignorando los
 * siguientes, la conversación queda rota. Esperamos 10s sin mensajes
 * nuevos antes de procesar; concatenamos los textos para que el
 * clasificador vea el mensaje completo.
 *
 * Cada mensaje nuevo del mismo teléfono REINICIA el timer (debounce
 * trailing). Solo el último inbound dispara `flush`, y la IA ve todos
 * los mensajes acumulados como un único texto.
 *
 * Todas las promesas de la misma tanda se resuelven juntas cuando
 * el flush termina — así pg-boss marca todos los jobs como OK en batch.
 */

import { logger } from "../config/logger";
import type { InboundJob } from "./queue";

const DEFAULT_WINDOW_MS = 10_000;

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface PendingEntry {
  texts: string[];
  messageIds: string[];
  lastJob: InboundJob;
  firstSeenAt: number;
  timer: NodeJS.Timeout;
  waiters: Waiter[];
}

const pending = new Map<string, PendingEntry>();

export interface DebounceOptions {
  windowMs?: number;
  onFlush: (job: InboundJob) => Promise<void>;
}

export function debounceInbound(job: InboundJob, opts: DebounceOptions): Promise<void> {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;

  return new Promise<void>((resolve, reject) => {
    const existing = pending.get(job.phone);

    const scheduleFlush = (entry: PendingEntry): void => {
      entry.timer = setTimeout(async () => {
        pending.delete(job.phone);
        const waiters = entry.waiters;
        try {
          const concat = entry.texts.join(" ").trim();
          const flushed: InboundJob = {
            ...entry.lastJob,
            text: concat,
            messageId: entry.lastJob.messageId,
          };
          logger.info(
            {
              phone: job.phone,
              batched: entry.texts.length,
              preview: concat.slice(0, 80),
            },
            "Debounce: flush batch de mensajes",
          );
          await opts.onFlush(flushed);
          for (const w of waiters) w.resolve();
        } catch (err) {
          for (const w of waiters) w.reject(err);
        }
      }, windowMs);
    };

    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(job.text);
      existing.messageIds.push(job.messageId);
      existing.lastJob = job;
      existing.waiters.push({ resolve, reject });
      scheduleFlush(existing);
    } else {
      const entry: PendingEntry = {
        texts: [job.text],
        messageIds: [job.messageId],
        lastJob: job,
        firstSeenAt: Date.now(),
        timer: null as unknown as NodeJS.Timeout,
        waiters: [{ resolve, reject }],
      };
      pending.set(job.phone, entry);
      scheduleFlush(entry);
    }
  });
}

/** Test-only. */
export function _resetDebounce(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}

export function debounceStats(): { pendingPhones: number } {
  return { pendingPhones: pending.size };
}
