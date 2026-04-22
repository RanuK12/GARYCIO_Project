import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  decimal,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ============================================================
// Enums
// ============================================================

export const estadoDonante = pgEnum("estado_donante", [
  "activa",
  "inactiva",
  "vacaciones",
  "baja_medica",
  "nueva",
]);

export const tipoReclamo = pgEnum("tipo_reclamo", [
  "regalo",
  "falta_bidon",
  "nueva_pelela",
  "otro",
]);

export const tipoAviso = pgEnum("tipo_aviso", [
  "vacaciones",
  "enfermedad",
  "medicacion",
]);

export const estadoReclamo = pgEnum("estado_reclamo", [
  "pendiente",
  "notificado_chofer",
  "seguimiento_enviado",
  "escalado_visitadora",
  "resuelto",
]);

export const estadoCamion = pgEnum("estado_camion", ["disponible", "en_ruta", "mantenimiento"]);

// ============================================================
// Tablas principales
// ============================================================

export const zonas = pgTable("zonas", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 100 }).notNull(),
  descripcion: text("descripcion"),
  activa: boolean("activa").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const donantes = pgTable("donantes", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  telefono: varchar("telefono", { length: 20 }).notNull().unique(),
  direccion: text("direccion").notNull(),
  zonaId: integer("zona_id").references(() => zonas.id),
  subZona: varchar("sub_zona", { length: 10 }),
  latitud: decimal("latitud", { precision: 10, scale: 7 }),
  longitud: decimal("longitud", { precision: 10, scale: 7 }),
  geocodificado: boolean("geocodificado").default(false),
  estado: estadoDonante("estado").default("activa"),
  diasRecoleccion: varchar("dias_recoleccion", { length: 100 }),
  donandoActualmente: boolean("donando_actualmente").default(true),
  fechaAlta: date("fecha_alta").defaultNow(),
  fechaVueltaDonacion: date("fecha_vuelta_donacion"),
  notas: text("notas"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const choferes = pgTable("choferes", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  telefono: varchar("telefono", { length: 20 }).notNull().unique(),
  licencia: varchar("licencia", { length: 50 }),
  activo: boolean("activo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const peones = pgTable("peones", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  telefono: varchar("telefono", { length: 20 }).notNull().unique(),
  activo: boolean("activo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const camiones = pgTable("camiones", {
  id: serial("id").primaryKey(),
  patente: varchar("patente", { length: 20 }).notNull().unique(),
  modelo: varchar("modelo", { length: 100 }),
  capacidadLitros: integer("capacidad_litros"),
  estado: estadoCamion("estado").default("disponible"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const visitadoras = pgTable("visitadoras", {
  id: serial("id").primaryKey(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  telefono: varchar("telefono", { length: 20 }).notNull().unique(),
  activa: boolean("activa").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Recorridos y asignaciones
// ============================================================

export const recorridos = pgTable("recorridos", {
  id: serial("id").primaryKey(),
  zonaId: integer("zona_id").references(() => zonas.id),
  choferId: integer("chofer_id").references(() => choferes.id),
  camionId: integer("camion_id").references(() => camiones.id),
  fecha: date("fecha").notNull(),
  orden: text("orden"),
  completado: boolean("completado").default(false),
  porcentajeCompletado: decimal("porcentaje_completado", { precision: 5, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const recorridoPeones = pgTable("recorrido_peones", {
  id: serial("id").primaryKey(),
  recorridoId: integer("recorrido_id").references(() => recorridos.id),
  peonId: integer("peon_id").references(() => peones.id),
});

export const recorridoDonantes = pgTable("recorrido_donantes", {
  id: serial("id").primaryKey(),
  recorridoId: integer("recorrido_id").references(() => recorridos.id),
  donanteId: integer("donante_id").references(() => donantes.id),
  orden: integer("orden"),
  recolectado: boolean("recolectado").default(false),
  litros: decimal("litros", { precision: 8, scale: 2 }),
  bidones: integer("bidones"),
  horaRecoleccion: timestamp("hora_recoleccion"),
});

// ============================================================
// Reclamos y avisos
// ============================================================

export const gravedadReclamo = pgEnum("gravedad_reclamo", [
  "leve",
  "moderado",
  "grave",
  "critico",
]);

export const reclamos = pgTable("reclamos", {
  id: serial("id").primaryKey(),
  donanteId: integer("donante_id").references(() => donantes.id).notNull(),
  tipo: tipoReclamo("tipo").notNull(),
  descripcion: text("descripcion"),
  estado: estadoReclamo("estado").default("pendiente"),
  gravedad: gravedadReclamo("gravedad").default("leve"),
  choferId: integer("chofer_id").references(() => choferes.id),
  visitadoraId: integer("visitadora_id").references(() => visitadoras.id),
  notificadoCeo: boolean("notificado_ceo").default(false),
  fechaCreacion: timestamp("fecha_creacion").defaultNow(),
  fechaSeguimiento: timestamp("fecha_seguimiento"),
  fechaResolucion: timestamp("fecha_resolucion"),
  resuelto: boolean("resuelto").default(false),
  devolucionVisitadora: text("devolucion_visitadora"),
});

export const avisos = pgTable("avisos", {
  id: serial("id").primaryKey(),
  donanteId: integer("donante_id").references(() => donantes.id).notNull(),
  tipo: tipoAviso("tipo").notNull(),
  fechaInicio: date("fecha_inicio").notNull(),
  fechaFin: date("fecha_fin"),
  notificacionVueltaEnviada: boolean("notificacion_vuelta_enviada").default(false),
  notas: text("notas"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Registros operativos
// ============================================================

export const registrosRecoleccion = pgTable("registros_recoleccion", {
  id: serial("id").primaryKey(),
  recorridoId: integer("recorrido_id").references(() => recorridos.id),
  fecha: date("fecha").notNull(),
  litrosTotales: decimal("litros_totales", { precision: 10, scale: 2 }),
  bidonesTotales: integer("bidones_totales"),
  fotoComprobante: text("foto_comprobante"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const registrosCombustible = pgTable("registros_combustible", {
  id: serial("id").primaryKey(),
  camionId: integer("camion_id").references(() => camiones.id).notNull(),
  choferId: integer("chofer_id").references(() => choferes.id),
  fecha: date("fecha").notNull(),
  litros: decimal("litros", { precision: 8, scale: 2 }),
  monto: decimal("monto", { precision: 10, scale: 2 }),
  fotoComprobante: text("foto_comprobante"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const registrosLavado = pgTable("registros_lavado", {
  id: serial("id").primaryKey(),
  camionId: integer("camion_id").references(() => camiones.id).notNull(),
  fecha: date("fecha").notNull(),
  fotoComprobante: text("foto_comprobante"),
  notas: text("notas"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Progreso mensual
// ============================================================

export const progresoMensual = pgTable("progreso_mensual", {
  id: serial("id").primaryKey(),
  mes: integer("mes").notNull(),
  anio: integer("anio").notNull(),
  litrosRecolectados: decimal("litros_recolectados", { precision: 12, scale: 2 }).default("0"),
  objetivoLitros: decimal("objetivo_litros", { precision: 12, scale: 2 }).default("260000"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// Asignación zona-chofer
// ============================================================

export const zonaChoferes = pgTable("zona_choferes", {
  id: serial("id").primaryKey(),
  zonaId: integer("zona_id").references(() => zonas.id).notNull(),
  choferId: integer("chofer_id").references(() => choferes.id).notNull(),
  activo: boolean("activo").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Incidentes
// ============================================================

export const tipoIncidente = pgEnum("tipo_incidente", [
  "accidente",
  "retraso",
  "averia",
  "robo",
  "clima",
  "otro",
]);

export const gravedadIncidente = pgEnum("gravedad_incidente", [
  "baja",
  "media",
  "alta",
  "critica",
]);

export const incidentes = pgTable("incidentes", {
  id: serial("id").primaryKey(),
  choferId: integer("chofer_id").references(() => choferes.id),
  tipo: tipoIncidente("tipo").notNull(),
  gravedad: gravedadIncidente("gravedad").default("media"),
  descripcion: text("descripcion").notNull(),
  zonaId: integer("zona_id").references(() => zonas.id),
  notificadoCeo: boolean("notificado_ceo").default(false),
  resuelto: boolean("resuelto").default(false),
  fecha: timestamp("fecha").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Mensajes WhatsApp (log)
// ============================================================

export const mensajesLog = pgTable("mensajes_log", {
  id: serial("id").primaryKey(),
  telefono: varchar("telefono", { length: 20 }).notNull(),
  tipo: varchar("tipo", { length: 50 }).notNull(),
  contenido: text("contenido"),
  direccion: varchar("direccion_msg", { length: 10 }).notNull(),
  exitoso: boolean("exitoso").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Estado de conversación (persistencia en DB)
// ============================================================

export const conversationStates = pgTable("conversation_states", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  currentFlow: varchar("current_flow", { length: 50 }),
  step: integer("step").default(0),
  data: jsonb("data").default({}),
  lastInteraction: timestamp("last_interaction").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Sub-zonas (A/B por zona - Lun/Mié/Vie vs Mar/Jue/Sáb)
// ============================================================

export const subZonas = pgTable("sub_zonas", {
  id: serial("id").primaryKey(),
  zonaId: integer("zona_id").references(() => zonas.id).notNull(),
  codigo: varchar("codigo", { length: 10 }).notNull(),
  nombre: varchar("nombre", { length: 100 }).notNull(),
  diasRecoleccion: varchar("dias_recoleccion", { length: 50 }).notNull(),
  activa: boolean("activa").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Rutas optimizadas (generadas por OR-Tools/OptimoRoute)
// ============================================================

export const estadoRuta = pgEnum("estado_ruta", [
  "borrador",
  "activa",
  "completada",
  "cancelada",
]);

export const rutasOptimizadas = pgTable("rutas_optimizadas", {
  id: serial("id").primaryKey(),
  subZonaId: integer("sub_zona_id").references(() => subZonas.id),
  choferId: integer("chofer_id").references(() => choferes.id),
  fecha: date("fecha").notNull(),
  estado: estadoRuta("estado").default("borrador"),
  distanciaEstimadaKm: decimal("distancia_estimada_km", { precision: 8, scale: 2 }),
  tiempoEstimadoMin: integer("tiempo_estimado_min"),
  paradas: jsonb("paradas").default([]),
  generadoPor: varchar("generado_por", { length: 50 }).default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================
// Entregas de regalos
// ============================================================

export const entregasRegalo = pgTable("entregas_regalo", {
  id: serial("id").primaryKey(),
  donanteId: integer("donante_id").references(() => donantes.id),
  donanteNombre: varchar("donante_nombre", { length: 150 }),
  donanteDireccion: text("donante_direccion"),
  peonId: integer("peon_id").references(() => peones.id),
  choferId: integer("chofer_id").references(() => choferes.id),
  entregado: boolean("entregado").default(true),
  fecha: timestamp("fecha").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Reportes de baja (pendientes de confirmación admin)
// ============================================================

export const reportesBaja = pgTable("reportes_baja", {
  id: serial("id").primaryKey(),
  donanteId: integer("donante_id").references(() => donantes.id),
  donanteNombre: varchar("donante_nombre", { length: 150 }),
  donanteDireccion: text("donante_direccion"),
  reportadoPor: varchar("reportado_por", { length: 20 }).notNull(),
  reportadoPorId: integer("reportado_por_id"),
  reportadoPorNombre: varchar("reportado_por_nombre", { length: 150 }),
  motivo: text("motivo"),
  confirmado: boolean("confirmado").default(false),
  contactadaDonante: boolean("contactada_donante").default(false),
  notaAdmin: text("nota_admin"),
  fecha: timestamp("fecha").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Encuestas de regalo
// ============================================================

export const encuestasRegalo = pgTable("encuestas_regalo", {
  id: serial("id").primaryKey(),
  donanteId: integer("donante_id").references(() => donantes.id).notNull(),
  telefono: varchar("telefono", { length: 20 }).notNull(),
  pregunta: text("pregunta").notNull(),
  respuesta: text("respuesta"),
  respondida: boolean("respondida").default(false),
  fecha: timestamp("fecha").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Dead Letter Queue (mensajes fallidos para reintentar/auditar)
// ============================================================

export const estadoDLQ = pgEnum("estado_dlq", [
  "pendiente",
  "reintentado",
  "descartado",
  "exitoso",
]);

// ============================================================
// Difusión masiva — envíos y confirmaciones
// ============================================================

export const difusionEnvios = pgTable("difusion_envios", {
  id: serial("id").primaryKey(),
  telefono: varchar("telefono", { length: 20 }).notNull().unique(),
  nombre: varchar("nombre", { length: 150 }),
  diasRecoleccion: varchar("dias_recoleccion", { length: 100 }),
  chofer: integer("chofer"),
  horarioEstimado: varchar("horario_estimado", { length: 10 }),
  confirmado: boolean("confirmado").default(false),
  fechaEnvio: timestamp("fecha_envio").defaultNow(),
  fechaConfirmacion: timestamp("fecha_confirmacion"),
});

// ============================================================
// Deduplicación de mensajes procesados (evita loops por reintentos de webhook)
// ============================================================

export const processedMessages = pgTable("processed_messages", {
  id: serial("id").primaryKey(),
  messageId: varchar("message_id", { length: 100 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("ok"), // ok | error | ignored
  processedAt: timestamp("processed_at").defaultNow(),
});

// ============================================================
// Escalación a humano — bloquea automatización para usuarios frustrados o con fallos
// ============================================================

export const estadoEscalacion = pgEnum("estado_escalacion", [
  "activa",
  "resuelta",
  "expirada",
]);

export const humanEscalations = pgTable("human_escalations", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  reason: varchar("reason", { length: 100 }).notNull(), // ia_fail | frustration | multiple_issues | user_request | system_error
  estado: estadoEscalacion("estado").default("activa"),
  escalatedAt: timestamp("escalated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 100 }),
  notas: text("notas"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================
// Feedback IA — mensajes que la IA no entendió o clasificó mal
// Se usa para mejorar el prompt con ejemplos reales
// ============================================================
export const iaFeedback = pgTable("ia_feedback", {
  id: serial("id").primaryKey(),
  telefono: varchar("telefono", { length: 20 }).notNull(),
  mensajeOriginal: text("mensaje_original").notNull(),
  intencionDetectada: varchar("intencion_detectada", { length: 50 }),
  respuestaGenerada: text("respuesta_generada"),
  urgenciaDetectada: varchar("urgencia_detectada", { length: 10 }),
  confianza: varchar("confianza", { length: 10 }), // alta, media, baja — que tan seguro estuvo el modelo
  useFallback: boolean("use_fallback").default(false), // true si se usó fallback por error de IA
  errorDetalle: text("error_detalle"), // error si falló la API
  revisado: boolean("revisado").default(false), // true cuando un admin lo revisó
  intencionCorrecta: varchar("intencion_correcta", { length: 50 }), // corrección manual del admin
  createdAt: timestamp("created_at").defaultNow(),
});

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: serial("id").primaryKey(),
  telefono: varchar("telefono", { length: 20 }).notNull(),
  tipo: varchar("tipo", { length: 50 }).notNull(),
  contenido: text("contenido"),
  templateName: varchar("template_name", { length: 100 }),
  templateParams: jsonb("template_params"),
  errorMessage: text("error_message"),
  errorCode: integer("error_code"),
  intentos: integer("intentos").default(0),
  estado: estadoDLQ("estado").default("pendiente"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const iaTrainingExamples = pgTable("ia_training_examples", {
  id: serial("id").primaryKey(),
  mensajeUsuario: text("mensaje_usuario").notNull(),
  intencionCorrecta: varchar("intencion_correcta", { length: 50 }).notNull(),
  respuestaEsperada: text("respuesta_esperada"),
  contexto: text("contexto"),
  activo: boolean("activo").default(true),
  prioridad: integer("prioridad").default(0),
  creadoPor: varchar("creado_por", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
