/**
 * P1.6 — Rate limiter adaptativo a 131056.
 */

import {
  recordRateLimitHit,
  isPhoneRateLimited,
  isGlobalThrottled,
  _resetRateLimit,
  rateLimitStats,
} from "../src/services/rate-limit-adaptive";

describe("P1.6 — rate-limit-adaptive", () => {
  beforeEach(() => {
    _resetRateLimit();
  });

  it("marca un phone en backoff tras 131056", () => {
    recordRateLimitHit("391");
    expect(isPhoneRateLimited("391")).toBe(true);
    expect(isPhoneRateLimited("392")).toBe(false);
  });

  it("activa throttle global al cruzar el umbral de hits en la ventana", () => {
    for (let i = 0; i < 5; i++) recordRateLimitHit(`39${i}`);
    expect(isGlobalThrottled()).toBe(true);
  });

  it("no activa throttle global si hits están espaciados", () => {
    recordRateLimitHit("391");
    recordRateLimitHit("392");
    expect(isGlobalThrottled()).toBe(false);
  });

  it("rateLimitStats reporta estado actual", () => {
    recordRateLimitHit("391");
    recordRateLimitHit("392");
    const s = rateLimitStats();
    expect(s.phonesBackoff).toBe(2);
    expect(s.hitsInWindow).toBe(2);
    expect(s.globalThrottled).toBe(false);
  });
});
