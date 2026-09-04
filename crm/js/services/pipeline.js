// Lógica PURA del pipeline (sin Firebase): etapas, cierres, probabilidad,
// cascada OPUS del presupuesto y métricas del embudo. Testeable con datos
// sintéticos, igual que console/js/services/checks.js.

// El embudo comercial de SOGRUB, tal como pasa en la realidad:
//   lead → contacto → visita/levantamiento → presupuesto (OPUS) →
//   propuesta enviada → negociación → cierre.
// `prob` es la probabilidad default por etapa; se puede sobreescribir por
// oportunidad (`probabilidad`). Con eso sale el "pipeline ponderado".
export const ETAPAS = [
  { id: 'lead',        label: 'Lead',                 short: 'Lead',        prob: 10, desc: 'Nos buscaron o lo detectamos. Aún no hay plática formal.' },
  { id: 'contacto',    label: 'Contacto',             short: 'Contacto',    prob: 20, desc: 'Ya hablamos: quién es, qué quiere, dónde y de qué tamaño.' },
  { id: 'visita',      label: 'Visita / levantamiento', short: 'Visita',    prob: 35, desc: 'Se visitó el sitio o se recibió el proyecto para cuantificar.' },
  { id: 'presupuesto', label: 'Presupuesto',          short: 'Presupuesto', prob: 50, desc: 'Se está armando el presupuesto en OPUS.' },
  { id: 'propuesta',   label: 'Propuesta enviada',    short: 'Propuesta',   prob: 65, desc: 'El cliente ya tiene la propuesta en la mano.' },
  { id: 'negociacion', label: 'Negociación',          short: 'Negociación', prob: 80, desc: 'Ajustes de alcance, precio, anticipo o programa.' }
];
export const ETAPA_IDX = Object.fromEntries(ETAPAS.map((e, i) => [e.id, i]));
export function etapaDef(id) { return ETAPAS.find(e => e.id === id) || ETAPAS[0]; }

// Cierres: `ganada` convierte en obra; `perdida` = el cliente no nos eligió o
// el proyecto no procedió; `declinada` = SOGRUB decidió no participar (fuera
// de alcance, mala paga, sin capacidad); `pospuesta` = se pausó, reabrible.
export const CIERRES = [
  { id: 'ganada',    label: 'Ganada',    kind: 'ok',     desc: 'Contrato firmado o anticipo confirmado. Se convierte en proyecto.' },
  { id: 'perdida',   label: 'Perdida',   kind: 'danger', desc: 'El cliente eligió otra opción o el proyecto no procedió.' },
  { id: 'declinada', label: 'Declinada', kind: 'muted',  desc: 'SOGRUB decidió no participar.' },
  { id: 'pospuesta', label: 'Pospuesta', kind: 'warn',   desc: 'En pausa por el cliente. Se puede reabrir después.' }
];
export function cierreDef(id) { return CIERRES.find(c => c.id === id); }
export const ESTADOS_CERRADOS = CIERRES.map(c => c.id);
export function estaAbierta(op) { return !op?.estado || op.estado === 'abierta'; }

export const PRIORIDADES = [
  { id: 'alta',  label: 'Alta',  kind: 'danger' },
  { id: 'media', label: 'Media', kind: 'warn' },
  { id: 'baja',  label: 'Baja',  kind: 'muted' }
];

export const TIPOS_ACTIVIDAD = [
  { id: 'nota',     label: 'Nota',        ico: '📝' },
  { id: 'llamada',  label: 'Llamada',     ico: '📞' },
  { id: 'whatsapp', label: 'WhatsApp',    ico: '💬' },
  { id: 'correo',   label: 'Correo',      ico: '✉️' },
  { id: 'reunion',  label: 'Reunión',     ico: '🤝' },
  { id: 'visita',   label: 'Visita a obra', ico: '📍' },
  { id: 'tarea',    label: 'Tarea',       ico: '☑️' },
  { id: 'sistema',  label: 'Sistema',     ico: '⚙️' }
];
export function tipoActividadDef(id) { return TIPOS_ACTIVIDAD.find(t => t.id === id) || TIPOS_ACTIVIDAD[0]; }

export const TIPOS_CLIENTE = [
  { id: 'particular',    label: 'Particular' },
  { id: 'constructora',  label: 'Constructora' },
  { id: 'desarrollador', label: 'Desarrollador' },
  { id: 'arquitecto',    label: 'Arquitecto / despacho' },
  { id: 'empresa',       label: 'Empresa' },
  { id: 'gobierno',      label: 'Gobierno' }
];

// Configuración editable desde #/config. Estos son los defaults con los que
// arranca; /shared/crm/config los sobreescribe campo por campo.
export const CONFIG_DEFAULT = {
  fuentes: ['Referido', 'Cliente recurrente', 'Constructora', 'Arquitecto', 'Licitación', 'Redes sociales', 'Sitio web', 'Visita en frío', 'Otro'],
  tiposObra: ['Cimentación', 'Estructura', 'Albañilería', 'Acabados', 'Pérgola / herrería', 'Remodelación', 'Obra completa', 'Urbanización', 'Otro'],
  motivosPerdida: ['Precio', 'Eligió a otro contratista', 'Proyecto cancelado', 'Sin presupuesto del cliente', 'Tiempo de entrega', 'Sin respuesta', 'Otro'],
  motivosDeclinada: ['Fuera de alcance', 'Sin capacidad en el programa', 'Riesgo de cobro', 'Ubicación', 'Margen insuficiente', 'Otro'],
  // Mismos nombres que sogrub_proyectos en bitácora, para que la conversión sea 1:1.
  sobrecostosDefault: { sobrecosto_ind_oficina: 5, sobrecosto_ind_campo: 8, sobrecosto_financiamiento: 0, sobrecosto_utilidad: 10 },
  ivaPct: 16,
  anticipoPctDefault: 30,
  vigenciaDiasDefault: 15,
  diasEstancada: 14        // sin actividad más de N días → "estancada"
};
export function mergeConfig(node) {
  const c = { ...CONFIG_DEFAULT, ...(node || {}) };
  c.sobrecostosDefault = { ...CONFIG_DEFAULT.sobrecostosDefault, ...(node?.sobrecostosDefault || {}) };
  for (const k of ['fuentes', 'tiposObra', 'motivosPerdida', 'motivosDeclinada']) {
    if (!Array.isArray(c[k]) || !c[k].length) c[k] = CONFIG_DEFAULT[k];
  }
  return c;
}

// ---------------------------------------------------------------------------
// Presupuesto: la MISMA cascada que bitácora (calcDesgloseContrato) y OPUS:
//   indirectos oficina y campo son % del costo directo (no en cascada);
//   financiamiento y utilidad cascadean sobre el acumulado; IVA encima.
// Devuelve todo SIN IVA salvo `iva` y `total`.
export function calcCascada(p) {
  const cd  = Number(p?.costo_directo_base) || 0;
  const io  = (Number(p?.sobrecosto_ind_oficina) || 0) / 100;
  const ic  = (Number(p?.sobrecosto_ind_campo) || 0) / 100;
  const fin = (Number(p?.sobrecosto_financiamiento) || 0) / 100;
  const uti = (Number(p?.sobrecosto_utilidad) || 0) / 100;
  const ivaPct = (Number(p?.iva_pct ?? 16) || 0) / 100;

  const indOficina = cd * io;
  const indCampo   = cd * ic;
  let acum = cd + indOficina + indCampo;
  const financiamiento = acum * fin; acum += financiamiento;
  const utilidad = acum * uti;       acum += utilidad;
  const subtotal = acum;
  const iva = subtotal * ivaPct;
  const total = subtotal + iva;

  const antPct = (Number(p?.anticipo_pct) || 0) / 100;
  const anticipo = (p?.anticipo_base === 'total_c_iva' ? total : subtotal) * antPct;

  return { costoDirecto: cd, indOficina, indCampo, financiamiento, utilidad, subtotal, iva, total, anticipo };
}

// Monto "de referencia" de una oportunidad (sin IVA): el presupuesto si ya
// existe, si no la estimación inicial. Es lo que suma el pipeline.
export function montoRef(op) {
  const sub = Number(op?.presupuesto?.subtotal);
  if (sub > 0) return sub;
  return Number(op?.montoEstimado) || 0;
}
export function probabilidadDe(op) {
  if (!estaAbierta(op)) return op.estado === 'ganada' ? 100 : 0;
  const ov = Number(op?.probabilidad);
  if (Number.isFinite(ov) && op?.probabilidad !== '' && op?.probabilidad != null) return Math.max(0, Math.min(100, ov));
  return etapaDef(op?.etapa).prob;
}
export function montoPonderado(op) { return montoRef(op) * probabilidadDe(op) / 100; }

// ---------------------------------------------------------------------------
// Seguimiento
export function diasEnEtapa(op, now = Date.now()) {
  const desde = Number(op?.etapaDesde) || Number(op?.createdAt) || now;
  return Math.max(0, Math.floor((now - desde) / 86400000));
}
export function diasSinActividad(op, now = Date.now()) {
  const t = Number(op?.ultimaActividadAt) || Number(op?.createdAt) || now;
  return Math.max(0, Math.floor((now - t) / 86400000));
}
export function estaEstancada(op, config, now = Date.now()) {
  if (!estaAbierta(op)) return false;
  return diasSinActividad(op, now) > (Number(config?.diasEstancada) || 14);
}
// Estado de la próxima acción: 'vencida' | 'hoy' | 'proxima' | null
export function estadoProximaAccion(op, hoyISO) {
  const f = op?.proximaAccion?.fecha;
  if (!f || !estaAbierta(op)) return null;
  if (f < hoyISO) return 'vencida';
  if (f === hoyISO) return 'hoy';
  return 'proxima';
}

// ---------------------------------------------------------------------------
// Métricas del embudo (para #/reportes y KPIs del tablero)
export function resumenPipeline(ops) {
  const abiertas = ops.filter(estaAbierta);
  const porEtapa = ETAPAS.map(e => {
    const list = abiertas.filter(o => (o.etapa || 'lead') === e.id);
    return {
      etapa: e.id, label: e.label, n: list.length,
      monto: list.reduce((s, o) => s + montoRef(o), 0),
      ponderado: list.reduce((s, o) => s + montoPonderado(o), 0)
    };
  });
  return {
    abiertas: abiertas.length,
    monto: abiertas.reduce((s, o) => s + montoRef(o), 0),
    ponderado: abiertas.reduce((s, o) => s + montoPonderado(o), 0),
    porEtapa
  };
}

// Cierres en una ventana (ms). Tasa de conversión = ganadas / (ganadas + perdidas + declinadas).
// Las pospuestas no cuentan: no son un resultado.
export function resumenCierres(ops, desdeTs = 0) {
  const cerradas = ops.filter(o => !estaAbierta(o) && (Number(o.cierre?.at) || Number(o.updatedAt) || 0) >= desdeTs);
  const by = (tipo) => cerradas.filter(o => o.estado === tipo);
  const g = by('ganada'), p = by('perdida'), d = by('declinada'), s = by('pospuesta');
  const suma = (l) => l.reduce((acc, o) => acc + montoRef(o), 0);
  const decididas = g.length + p.length + d.length;
  return {
    ganadas: { n: g.length, monto: suma(g) },
    perdidas: { n: p.length, monto: suma(p) },
    declinadas: { n: d.length, monto: suma(d) },
    pospuestas: { n: s.length, monto: suma(s) },
    tasaConversion: decididas ? g.length / decididas : null,
    tasaVsCliente: (g.length + p.length) ? g.length / (g.length + p.length) : null,
    ticketPromedioGanada: g.length ? suma(g) / g.length : 0
  };
}

export function agruparPor(ops, keyFn) {
  const m = new Map();
  for (const o of ops) {
    const k = keyFn(o) || '—';
    if (!m.has(k)) m.set(k, { key: k, n: 0, monto: 0, ganadas: 0, perdidas: 0 });
    const g = m.get(k);
    g.n++; g.monto += montoRef(o);
    if (o.estado === 'ganada') g.ganadas++;
    if (o.estado === 'perdida' || o.estado === 'declinada') g.perdidas++;
  }
  return [...m.values()].sort((a, b) => b.monto - a.monto);
}

// Tiempo promedio (días) que las oportunidades pasan en cada etapa, a partir
// del historial de cambios de etapa. Sólo cuenta tramos cerrados.
export function tiempoPromedioPorEtapa(ops) {
  const acc = Object.fromEntries(ETAPAS.map(e => [e.id, { total: 0, n: 0 }]));
  for (const o of ops) {
    const hist = Object.values(o.historial || {})
      .filter(x => x && x.at)
      .sort((a, b) => a.at - b.at);
    let etapaActual = 'lead', desde = Number(o.createdAt) || null;
    for (const ev of hist) {
      if (ev.tipo === 'etapa' || ev.tipo === 'cierre') {
        if (desde && acc[etapaActual]) { acc[etapaActual].total += (ev.at - desde) / 86400000; acc[etapaActual].n++; }
        etapaActual = ev.tipo === 'etapa' ? ev.a : etapaActual;
        desde = ev.at;
        if (ev.tipo === 'cierre') desde = null;
      }
      if (ev.tipo === 'reapertura') { etapaActual = ev.a || etapaActual; desde = ev.at; }
    }
  }
  return ETAPAS.map(e => ({ etapa: e.id, label: e.label, promedio: acc[e.id].n ? acc[e.id].total / acc[e.id].n : null, n: acc[e.id].n }));
}

// Folio legible OP-AAAA-NNN
export function formatoFolio(anio, n) { return `OP-${anio}-${String(n).padStart(3, '0')}`; }

export function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
