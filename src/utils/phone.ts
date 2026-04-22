/**
 * Normalizador de números de teléfono argentinos.
 *
 * WhatsApp / 360dialog envía números en formatos inconsistentes:
 * +54911XXXXXXXX, 54911XXXXXXXX, 911XXXXXXXX, 11XXXXXXXX
 *
 * Esta función canonicaliza a un formato consistente para lookups y registro.
 * Formato de salida: 54911XXXXXXXX (solo dígitos, sin +, siempre con 54)
 *
 * REGLAS:
 * 1. Eliminar todo excepto dígitos.
 * 2. Si empieza con 54 → mantener.
 * 3. Si empieza con 9 y tiene 10 dígitos → agregar 54.
 * 4. Si empieza con 11 y tiene 10 dígitos → agregar 549.
 * 5. Si tiene 8 dígitos (sin área) → asumir 54911 + número.
 * 6. Si no encaja en ningún patrón → devolver los dígitos tal cual (fallback).
 */

export function normalizePhone(phone: string): string {
  if (!phone) return "";

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 0) return "";

  // Ya tiene código de país completo (54 + 9 + área + número)
  // Ej: 54911XXXXXXXX (13 dígitos)
  if (digits.startsWith("54") && digits.length >= 12) {
    return digits;
  }

  // Tiene 9 + área + número (ej: 911XXXXXXXX = 11 dígitos)
  if (digits.startsWith("9") && digits.length === 11) {
    return "54" + digits;
  }

  // Tiene área + número sin 9 (ej: 11XXXXXXXX = 10 dígitos)
  if (digits.length === 10) {
    return "549" + digits;
  }

  // Solo número local (8 dígitos) — asumir AMBA (11)
  if (digits.length === 8) {
    return "54911" + digits;
  }

  // Fallback: devolver tal cual (permite números internacionales u otros formatos)
  return digits;
}

/**
 * Compara dos números de teléfono normalizados.
 * Útil para evitar duplicados en inserts.
 */
export function phonesAreEqual(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}
