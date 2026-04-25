/**
 * P2.1 — Frases gatillo de escalación inmediata.
 */

import { detectEscalationTrigger } from "../src/services/escalation-triggers";

describe("P2.1 — escalation-triggers", () => {
  it("detecta menciones legales", () => {
    expect(detectEscalationTrigger("voy a llamar a mi abogado")?.category).toBe("legal");
    expect(detectEscalationTrigger("los voy a denunciar")?.category).toBe("legal");
    expect(detectEscalationTrigger("esto es un juicio")?.category).toBe("legal");
  });

  it("detecta menciones financieras / estafa", () => {
    expect(detectEscalationTrigger("me estafaron")?.category).toBe("financiero");
    expect(detectEscalationTrigger("se llevaron mi plata")?.category).toBe("financiero");
    expect(detectEscalationTrigger("me robaron un bidón")?.category).toBe("financiero");
  });

  it("detecta urgencia", () => {
    expect(detectEscalationTrigger("necesito ayuda urgente")?.category).toBe("urgencia");
    expect(detectEscalationTrigger("emergencia con el camión")?.category).toBe("urgencia");
  });

  it("detecta frustración larga", () => {
    expect(detectEscalationTrigger("hace meses que no pasan")?.category).toBe("frustracion_larga");
    expect(detectEscalationTrigger("hace varias semanas")?.category).toBe("frustracion_larga");
  });

  it("detecta disconformidad grave", () => {
    expect(detectEscalationTrigger("esto es un desastre")?.category).toBe("disconformidad_grave");
    expect(detectEscalationTrigger("qué vergüenza")?.category).toBe("disconformidad_grave");
  });

  it("detecta amenaza de baja", () => {
    expect(detectEscalationTrigger("no quiero donar más")?.category).toBe("amenaza_baja");
    expect(detectEscalationTrigger("me bajo")?.category).toBe("amenaza_baja");
  });

  it("NO escala mensajes normales", () => {
    expect(detectEscalationTrigger("hola buen dia")).toBeNull();
    expect(detectEscalationTrigger("recibido gracias")).toBeNull();
    expect(detectEscalationTrigger("1")).toBeNull();
    expect(detectEscalationTrigger("cuando pasan?")).toBeNull();
  });

  it("ignora mensajes muy cortos", () => {
    expect(detectEscalationTrigger("")).toBeNull();
    expect(detectEscalationTrigger("ok")).toBeNull();
  });
});
