/**
 * P0.5 — Mapper IA → enum DB.
 */

import {
  mapTipoReclamoIaToDb,
  mapTipoAvisoIaToDb,
  classifierResultSchema,
} from "../src/services/ia-enum-mapper";

describe("P0.5 — mapTipoReclamoIaToDb", () => {
  const casos: Array<[string, string]> = [
    ["regalo", "regalo"],
    ["falta_bidon", "falta_bidon"],
    ["falta_bidon_vacio", "falta_bidon"],
    ["no_pasaron", "falta_bidon"],
    ["pelela", "nueva_pelela"],
    ["nueva_pelela", "nueva_pelela"],
    ["bidon_sucio", "otro"],
    ["otro", "otro"],
    ["valor_desconocido_de_IA", "otro"],
    ["", "otro"],
    ["REGALO", "regalo"],
  ];
  it.each(casos)("%s → %s", (input, expected) => {
    expect(mapTipoReclamoIaToDb(input)).toBe(expected);
  });
  it("null/undefined → otro", () => {
    expect(mapTipoReclamoIaToDb(null)).toBe("otro");
    expect(mapTipoReclamoIaToDb(undefined)).toBe("otro");
  });
});

describe("P0.5 — mapTipoAvisoIaToDb", () => {
  it("valores válidos se mapean a sí mismos", () => {
    expect(mapTipoAvisoIaToDb("vacaciones")).toBe("vacaciones");
    expect(mapTipoAvisoIaToDb("enfermedad")).toBe("enfermedad");
    expect(mapTipoAvisoIaToDb("medicacion")).toBe("medicacion");
  });
  it("valores NO ausencia devuelven null (no insertar)", () => {
    expect(mapTipoAvisoIaToDb("mudanza")).toBeNull();
    expect(mapTipoAvisoIaToDb("cambio_direccion")).toBeNull();
    expect(mapTipoAvisoIaToDb("cambio_telefono")).toBeNull();
    expect(mapTipoAvisoIaToDb("general")).toBeNull();
  });
  it("desconocidos devuelven null", () => {
    expect(mapTipoAvisoIaToDb("lo_que_sea")).toBeNull();
    expect(mapTipoAvisoIaToDb(null)).toBeNull();
  });
});

describe("P0.5 — classifierResultSchema", () => {
  it("parsea response mínimo válido", () => {
    const r = classifierResultSchema.parse({ intent: "saludo" });
    expect(r.entities).toEqual([]);
    expect(r.needsHuman).toBe(false);
    expect(r.sentiment).toBe("calm");
    expect(r.confidence).toBe("low");
  });
  it("rechaza intent inválido", () => {
    expect(() => classifierResultSchema.parse({ intent: "inventado" })).toThrow();
  });
  it("rechaza sentiment inválido", () => {
    expect(() =>
      classifierResultSchema.parse({ intent: "reclamo", sentiment: "raging" }),
    ).toThrow();
  });
});
