/**
 * P1.2 — Circuit breaker minimalista (sin dependencias).
 *
 * Estados:
 *   CLOSED   — llamadas pasan normalmente
 *   OPEN     — fallos consecutivos >= threshold: rechazar rápido sin llamar
 *   HALF_OPEN — después de cooldown, dejar pasar 1 llamada de prueba
 *
 * Uso:
 *   const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
 *   const result = await cb.exec(() => callOpenAI(...));
 *
 * Si el circuito está OPEN, `exec` lanza `CircuitOpenError` inmediatamente.
 */

import { logger } from "../config/logger";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit ${name} is OPEN — rejecting fast`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  name: string;
  threshold: number;    // fallos consecutivos para abrir
  cooldownMs: number;   // tiempo antes de half-open
}

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: State = "CLOSED";
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  getState(): State {
    this.tickStateTransitions();
    return this.state;
  }

  private tickStateTransitions(): void {
    if (this.state === "OPEN" && Date.now() - this.openedAt >= this.opts.cooldownMs) {
      this.state = "HALF_OPEN";
      logger.info({ name: this.opts.name }, "Circuit → HALF_OPEN (probe)");
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      logger.info({ name: this.opts.name }, "Circuit → CLOSED (recovered)");
    }
    this.state = "CLOSED";
    this.failures = 0;
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === "HALF_OPEN" || this.failures >= this.opts.threshold) {
      if (this.state !== "OPEN") {
        logger.warn(
          { name: this.opts.name, failures: this.failures },
          "Circuit → OPEN",
        );
      }
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.tickStateTransitions();

    if (this.state === "OPEN") {
      throw new CircuitOpenError(this.opts.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Test-only. Resetea el circuito a CLOSED con 0 fallos. */
  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.openedAt = 0;
  }
}

// Instancia global para OpenAI. 3 fallos seguidos abre 60s.
export const openaiBreaker = new CircuitBreaker({
  name: "openai",
  threshold: 3,
  cooldownMs: 60_000,
});
