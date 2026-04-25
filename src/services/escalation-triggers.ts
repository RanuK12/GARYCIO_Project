/**
 * P2.1 — Frases gatillo de escalación inmediata.
 *
 * Detección heurística (sin IA) de mensajes que SIEMPRE deben ir a humano,
 * independientemente de lo que clasifique la IA. Son situaciones donde un
 * error de interpretación del bot tiene costo reputacional o legal alto.
 *
 * Categorías:
 * - LEGAL: mención de abogados, denuncia, demanda, juicio.
 * - FINANCIERO: robo, estafa, mención de dinero/pago (el bot no gestiona cobros).
 * - URGENCIA: "urgente", "emergencia", "ayuda" en contexto no-saludo.
 * - FRUSTRACIÓN_LARGA: "hace meses", "hace semanas", "siempre lo mismo".
 * - DISCONFORMIDAD_GRAVE: "voy a denunciar", "se van a arrepentir", "horrible".
 *
 * Se aplica en `handleIncomingMessage` antes de consultar a la IA.
 */

const TRIGGER_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "legal",
    regex: /\b(abogad[oa]s?|denunciar?[ée]?|demand(a|ar|ando)|juicio|jur[ií]dic[oa])\b/i },
  { name: "financiero",
    regex: /\b(robaron|roban|robo(s|aron)?|se\s+llevaron|estaf(a|ar|aron|ando|ados?|adores?)|timaron|dinero|plata|pagar|pag(o|u[eé])|deuda|deb(e|en)|cobran(do)?|cobraron)\b/i },
  { name: "urgencia",
    regex: /\b(urgent(e|ísimo|isimo)|emergencia|socorro|auxili(o|ar))\b/i },
  { name: "frustracion_larga",
    regex: /\bhace\s+(muchos?|varias?|varios?)?\s*(semanas?|meses?|d[ií]as?|tiempo)\b/i },
  { name: "disconformidad_grave",
    regex: /\b(horribl[ée]|pésim[ao]|pesim[ao]|verg(uenza|üenza)|desastre|nunca\s+m[aá]s|se\s+van\s+a\s+arrepentir)\b/i },
  { name: "amenaza_baja",
    regex: /\b(me\s+voy|me\s+bajo|no\s+(vuelvo|quiero)\s+(donar|participar))\b/i },
];

export interface TriggerMatch {
  category: string;
  matched: string;
}

export function detectEscalationTrigger(message: string): TriggerMatch | null {
  if (!message || message.length < 3) return null;
  for (const { name, regex } of TRIGGER_PATTERNS) {
    const m = message.match(regex);
    if (m) return { category: name, matched: m[0] };
  }
  return null;
}
