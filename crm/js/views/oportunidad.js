import { h, modal, toast } from '../util/dom.js?v=20260904-0310';
import { state, setState } from '../state/store.js?v=20260904-0310';
import { navigate } from '../state/router.js?v=20260904-0310';
import { renderShell, cargando } from './shell.js?v=20260904-0310';
import { esAdmin } from '../services/auth.js?v=20260904-0310';
import {
  loadAll, getOportunidad, watchActividades, moverEtapa, cerrarOportunidad, reabrirOportunidad,
  guardarPresupuesto, registrarActividad, marcarTarea, eliminarActividad, setProximaAccion,
  eliminarOportunidad, convertirEnProyecto, actualizarOportunidad
} from '../services/crm.js?v=20260904-0310';
import {
  ETAPAS, ETAPA_IDX, etapaDef, CIERRES, cierreDef, estaAbierta, calcCascada, montoRef, probabilidadDe,
  diasEnEtapa, diasSinActividad, estadoProximaAccion, TIPOS_ACTIVIDAD, tipoActividadDef
} from '../services/pipeline.js?v=20260904-0310';
import { money, money0, pct, dateMx, dateShort, dateTimeMx, ago, todayISO, addDaysISO, diasHasta } from '../util/format.js?v=20260904-0310';
import { etapaTag, prioridadTag, field, select, input, textarea } from './_ui.js?v=20260904-0310';
import { abrirFormOportunidad } from './_form-oportunidad.js?v=20260904-0310';

let _unwatchActs = null;
let _actividades = [];
let _op = null;

export async function renderOportunidad({ params }) {
  renderShell(cargando('Cargando oportunidad…'));
  try {
    if (!state.data) setState({ data: await loadAll() });
    _op = await getOportunidad(params.id);
  } catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }
  if (!_op) return renderShell(h('div', { class: 'empty' }, ['No existe esa oportunidad. ', h('a', { href: '#/' }, 'Volver al pipeline')]));

  if (_unwatchActs) _unwatchActs();
  _unwatchActs = watchActividades(_op.id, (acts) => {
    if (!location.hash.startsWith('#/oportunidad/' + _op.id)) { _unwatchActs(); _unwatchActs = null; return; }
    _actividades = acts;
    pintar();
  });
}

async function recargar() {
  _op = await getOportunidad(_op.id);
  // El tablero cachea la lista; mantenerla al día para que al volver no se vea viejo.
  if (state.data) {
    const i = state.data.oportunidades.findIndex(o => o.id === _op.id);
    if (i >= 0) state.data.oportunidades[i] = _op; else state.data.oportunidades.unshift(_op);
  }
  pintar();
}

function pintar() {
  const op = _op;
  const abierta = estaAbierta(op);
  const admin = esAdmin(state.user);

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [
      h('div', { class: 'row', style: { gap: '10px' } }, [
        h('a', { href: '#/', class: 'muted', style: { fontSize: '12px' } }, '← Pipeline'),
        h('span', { class: 'mono muted' }, op.folio || '')
      ]),
      h('h1', {}, op.nombre),
      h('div', { class: 'row', style: { marginTop: '6px' } }, [
        etapaTag(op), prioridadTag(op.prioridad),
        h('span', { class: 'tag' }, op.tipoObra || '—'),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `${op.clienteNombre || 'Sin cliente'}${op.municipio ? ' · ' + op.municipio : ''}`)
      ])
    ]),
    h('div', { class: 'toolbar' }, [
      h('button', { class: 'btn', onClick: async () => { if (await abrirFormOportunidad(op)) recargar(); } }, '✎ Editar'),
      admin ? h('button', { class: 'btn danger sm', onClick: () => borrar(op) }, '🗑') : null
    ])
  ]);

  const cierreBanner = !abierta ? bannerCierre(op, admin) : null;

  const stepper = h('div', { class: 'stepper' }, ETAPAS.map((e, i) => {
    const idxAct = ETAPA_IDX[op.etapa || 'lead'];
    const cls = !abierta ? 'closed' : i < idxAct ? 'done' : i === idxAct ? 'current' : '';
    return h('div', { class: `step ${cls}`, title: e.desc, onClick: () => abierta && i !== idxAct && moverA(op, e.id) }, [
      e.label, h('span', { class: 'step-prob' }, `${e.prob}%`)
    ]);
  }));

  const left = h('div', {}, [
    cardDatos(op),
    cardPresupuesto(op, abierta),
    cardPropuestas(op)
  ]);
  const right = h('div', {}, [
    abierta ? cardProximaAccion(op) : null,
    cardActividades(op),
    abierta ? cardCierre(op) : null
  ]);

  renderShell([head, cierreBanner, stepper, h('div', { class: 'detail-grid' }, [left, right])]);
}

// ---------------------------------------------------------------------------
function cardDatos(op) {
  const kv = (k, v) => [h('div', { class: 'k' }, k), h('div', { class: 'v' }, v || '—')];
  const dias = diasEnEtapa(op);
  return h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [h('h3', {}, 'Datos'), h('span', { class: 'muted', style: { fontSize: '11px' } }, `creada ${dateMx(op.createdAt)} · ${op.createdBy?.nombre || ''}`)]),
    h('div', { class: 'kv' }, [
      ...kv('Cliente', op.clienteId ? h('a', { href: '#/clientes?id=' + op.clienteId }, op.clienteNombre) : op.clienteNombre),
      ...kv('Contacto', [op.contacto, op.telefono ? h('span', { class: 'muted' }, ` · ${op.telefono}`) : null]),
      ...kv('Tipo de obra', op.tipoObra),
      ...kv('Ubicación', [op.ubicacion, op.municipio].filter(Boolean).join(', ')),
      ...kv('Fuente', op.fuente),
      ...kv('Responsable', op.responsableNombre),
      ...kv('Monto estimado', op.montoEstimado ? money(op.montoEstimado) + ' sin IVA' : null),
      ...kv('Probabilidad', h('span', {}, [`${probabilidadDe(op)}%`, h('span', { class: 'muted' }, op.probabilidad != null && op.probabilidad !== '' ? ' (ajustada)' : ` (default de ${etapaDef(op.etapa).label})`),
        estaAbierta(op) ? h('button', { class: 'link-btn', style: { marginLeft: '8px', fontSize: '11px' }, onClick: () => ajustarProbabilidad(op) }, 'ajustar') : null])),
      ...kv('Cierre estimado', op.fechaCierreEstimada ? h('span', {}, [dateMx(op.fechaCierreEstimada), (() => { const d = diasHasta(op.fechaCierreEstimada); return estaAbierta(op) && d != null && d < 0 ? h('span', { class: 'danger', style: { marginLeft: '6px' } }, `(${Math.abs(d)} d atrás)`) : null; })()]) : null),
      ...kv('En esta etapa', `${dias} día${dias === 1 ? '' : 's'} · última actividad ${ago(op.ultimaActividadAt)}`),
      ...kv('Descripción', op.descripcion ? h('div', { style: { whiteSpace: 'pre-wrap' } }, op.descripcion) : null)
    ])
  ]);
}

async function ajustarProbabilidad(op) {
  const inp = input({ type: 'number', min: 0, max: 100, value: op.probabilidad ?? '' , placeholder: String(etapaDef(op.etapa).prob) });
  const ok = await modal({
    title: 'Probabilidad de cierre',
    body: h('div', {}, [
      field('Probabilidad (%)', inp, `Vacío = usar el default de la etapa (${etapaDef(op.etapa).prob}%). Úsalo cuando sabes algo que la etapa no dice: cliente recurrente, competencia fuerte, etc.`)
    ]),
    onConfirm: async () => {
      const v = inp.value === '' ? null : Math.max(0, Math.min(100, Number(inp.value) || 0));
      await actualizarOportunidad(op.id, { probabilidad: v });
      return true;
    }
  });
  if (ok) recargar();
}

// ---------------------------------------------------------------------------
function cardPresupuesto(op, abierta) {
  const p = op.presupuesto;
  const c = p ? calcCascada(p) : null;
  const linea = (l, v, cls = '') => h('div', { class: `l ${cls}` }, [h('span', {}, l), h('strong', {}, money(v))]);
  return h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [
      h('h3', {}, 'Presupuesto (cascada OPUS)'),
      abierta ? h('button', { class: 'btn sm', onClick: () => editarPresupuesto(op) }, p ? '✎ Editar / nueva versión' : '+ Capturar') : null
    ]),
    !p ? h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Aún no hay presupuesto. Cuando lo armes en OPUS captura aquí el costo directo y los porcentajes: el precio de venta se calcula igual que en bitácora.') :
    h('div', { class: 'cascada' }, [
      linea('Costo directo', c.costoDirecto),
      c.indOficina ? linea(`+ Indirectos oficina (${p.sobrecosto_ind_oficina}% de CD)`, c.indOficina) : null,
      c.indCampo ? linea(`+ Indirectos campo (${p.sobrecosto_ind_campo}% de CD)`, c.indCampo) : null,
      c.financiamiento ? linea(`+ Financiamiento (${p.sobrecosto_financiamiento}%)`, c.financiamiento) : null,
      c.utilidad ? linea(`+ Utilidad (${p.sobrecosto_utilidad}%)`, c.utilidad) : null,
      linea('Precio de venta (sin IVA)', c.subtotal, 'total'),
      linea(`+ IVA ${p.iva_pct ?? 16}%`, c.iva),
      linea('Monto con IVA', c.total, 'total'),
      Number(p.anticipo_pct) ? linea(`Anticipo ${p.anticipo_pct}% sobre ${p.anticipo_base === 'total_c_iva' ? 'monto con IVA' : 'precio sin IVA'}`, c.anticipo, 'sub') : null,
      h('div', { class: 'l sub', style: { marginTop: '8px' } }, [
        h('span', {}, `Versión ${p.version || 0}${p.fecha ? ' · ' + dateMx(p.fecha) : ''}${p.vigenciaDias ? ' · vigencia ' + p.vigenciaDias + ' d' : ''}`),
        p.archivoUrl ? h('a', { href: p.archivoUrl, target: '_blank', rel: 'noopener' }, 'Abrir propuesta ↗') : null
      ]),
      p.notas ? h('div', { class: 'muted', style: { marginTop: '6px', whiteSpace: 'pre-wrap' } }, p.notas) : null
    ])
  ]);
}

async function editarPresupuesto(op) {
  const cfg = state.data.config;
  const p = op.presupuesto || { ...cfg.sobrecostosDefault, iva_pct: cfg.ivaPct, anticipo_pct: cfg.anticipoPctDefault, anticipo_base: 'subtotal', vigenciaDias: cfg.vigenciaDiasDefault };
  const f = {
    costo_directo_base: input({ type: 'number', min: 0, step: '0.01', value: p.costo_directo_base ?? '' }),
    sobrecosto_ind_oficina: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.sobrecosto_ind_oficina ?? 0 }),
    sobrecosto_ind_campo: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.sobrecosto_ind_campo ?? 0 }),
    sobrecosto_financiamiento: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.sobrecosto_financiamiento ?? 0 }),
    sobrecosto_utilidad: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.sobrecosto_utilidad ?? 0 }),
    iva_pct: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.iva_pct ?? 16 }),
    anticipo_pct: input({ type: 'number', min: 0, max: 100, step: '0.1', value: p.anticipo_pct ?? 0 }),
    anticipo_base: select([{ value: 'subtotal', label: 'Precio sin IVA' }, { value: 'total_c_iva', label: 'Monto con IVA' }], p.anticipo_base || 'subtotal'),
    fecha: input({ type: 'date', value: p.fecha || todayISO() }),
    vigenciaDias: input({ type: 'number', min: 0, value: p.vigenciaDias ?? cfg.vigenciaDiasDefault }),
    archivoUrl: input({ type: 'url', value: p.archivoUrl || '', placeholder: 'Link de Drive al PDF / OPUS' }),
    notas: textarea({ rows: 2, placeholder: 'Qué incluye, qué no, condiciones…' })
  };
  f.notas.value = p.notas || '';
  const comoVersion = h('input', { type: 'checkbox', checked: true });
  const preview = h('div', { class: 'cascada', style: { background: 'var(--bg-2)', padding: '10px 12px', borderRadius: '6px', marginTop: '12px' } });
  const upd = () => {
    const c = calcCascada(leer());
    const linea = (l, v, cls = '') => h('div', { class: `l ${cls}` }, [h('span', {}, l), h('strong', {}, money(v))]);
    preview.replaceChildren(
      linea('Costo directo', c.costoDirecto),
      linea('+ Ind. oficina', c.indOficina), linea('+ Ind. campo', c.indCampo),
      linea('+ Financiamiento', c.financiamiento), linea('+ Utilidad', c.utilidad),
      linea('Precio de venta sin IVA', c.subtotal, 'total'),
      linea('+ IVA', c.iva), linea('Monto con IVA', c.total, 'total'),
      linea('Anticipo', c.anticipo, 'sub')
    );
  };
  const leer = () => ({
    costo_directo_base: Number(f.costo_directo_base.value) || 0,
    sobrecosto_ind_oficina: Number(f.sobrecosto_ind_oficina.value) || 0,
    sobrecosto_ind_campo: Number(f.sobrecosto_ind_campo.value) || 0,
    sobrecosto_financiamiento: Number(f.sobrecosto_financiamiento.value) || 0,
    sobrecosto_utilidad: Number(f.sobrecosto_utilidad.value) || 0,
    iva_pct: Number(f.iva_pct.value) || 0,
    anticipo_pct: Number(f.anticipo_pct.value) || 0,
    anticipo_base: f.anticipo_base.value,
    fecha: f.fecha.value || null,
    vigenciaDias: Number(f.vigenciaDias.value) || null,
    archivoUrl: f.archivoUrl.value.trim() || null,
    notas: f.notas.value.trim() || null
  });
  Object.values(f).forEach(el => el.addEventListener('input', upd));
  upd();

  const body = h('div', {}, [
    field('Costo directo (subtotal OPUS, sin sobrecostos)', f.costo_directo_base),
    h('div', { class: 'field-row', style: { marginTop: '10px' } }, [
      field('Ind. oficina % de CD', f.sobrecosto_ind_oficina),
      field('Ind. campo % de CD', f.sobrecosto_ind_campo),
      field('Financiamiento %', f.sobrecosto_financiamiento),
      field('Utilidad %', f.sobrecosto_utilidad)
    ]),
    h('div', { class: 'field-row', style: { marginTop: '10px' } }, [
      field('IVA %', f.iva_pct),
      field('Anticipo %', f.anticipo_pct),
      field('Base del anticipo', f.anticipo_base)
    ]),
    preview,
    h('div', { class: 'grid-3', style: { marginTop: '12px' } }, [
      field('Fecha de la propuesta', f.fecha),
      field('Vigencia (días)', f.vigenciaDias),
      field('Archivo (link)', f.archivoUrl)
    ]),
    h('div', { style: { marginTop: '10px' } }, field('Notas', f.notas)),
    h('label', { class: 'field-inline', style: { marginTop: '12px', fontSize: '13px' } }, [comoVersion, ' Registrar como versión de propuesta (v' + ((Number(op.presupuesto?.version) || 0) + 1) + ') — lo que se le mandó al cliente']),
    h('div', { class: 'hint' }, 'Los indirectos de oficina y campo van sobre el costo directo; financiamiento y utilidad cascadean. Misma fórmula que "Nuevo proyecto" en bitácora, así que la conversión es exacta.')
  ]);
  const ok = await modal({
    title: 'Presupuesto · cascada OPUS', body, size: 'lg', confirmLabel: 'Guardar',
    onConfirm: async () => {
      const form = leer();
      if (!(form.costo_directo_base > 0)) { toast('El costo directo debe ser mayor a 0', 'danger'); return false; }
      try { await guardarPresupuesto(op, form, { comoVersion: comoVersion.checked, notas: form.notas }); return true; }
      catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'danger'); return false; }
    }
  });
  if (!ok) return;
  toast('Presupuesto guardado', 'ok');
  await recargar();
  // Si registró una propuesta y sigue antes de "Propuesta enviada", ofrecer avanzar.
  if (comoVersion.checked && ETAPA_IDX[_op.etapa || 'lead'] < ETAPA_IDX.propuesta && estaAbierta(_op)) {
    const mover = await modal({ title: 'Mover a "Propuesta enviada"', body: '¿Ya se le mandó al cliente? Muevo la oportunidad a Propuesta enviada.', confirmLabel: 'Sí, mover', cancelLabel: 'Todavía no' });
    if (mover) { await moverEtapa(_op, 'propuesta'); await recargar(); }
  }
}

function cardPropuestas(op) {
  const list = Object.entries(op.propuestas || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.version || 0) - (a.version || 0));
  if (!list.length) return null;
  return h('div', { class: 'card' }, [
    h('h3', {}, `Versiones de propuesta (${list.length})`),
    h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['v', 'Fecha', 'Sin IVA', 'Con IVA', 'Vigencia', 'Notas', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, list.map(v => h('tr', {}, [
        h('td', { class: 'mono' }, `v${v.version}`),
        h('td', {}, dateShort(v.fecha || v.at)),
        h('td', { class: 'num' }, money0(v.subtotal)),
        h('td', { class: 'num' }, money0(v.total)),
        h('td', { class: 'muted' }, v.vigenciaDias ? `${v.vigenciaDias} d` : '—'),
        h('td', { class: 'muted' }, v.notas || ''),
        h('td', {}, v.archivoUrl ? h('a', { href: v.archivoUrl, target: '_blank', rel: 'noopener' }, '↗') : '')
      ])))
    ])
  ]);
}

// ---------------------------------------------------------------------------
function cardProximaAccion(op) {
  const hoy = todayISO();
  const st = estadoProximaAccion(op, hoy);
  const pa = op.proximaAccion;
  const fInp = input({ type: 'date', value: pa?.fecha || addDaysISO(hoy, 2), style: { width: '150px' } });
  const tInp = input({ type: 'text', value: pa?.texto || '', placeholder: '¿Qué sigue? Ej. mandar propuesta, llamar, visitar', style: { flex: '1' } });
  const guardar = async () => {
    await setProximaAccion(op.id, { fecha: fInp.value, texto: tInp.value.trim() });
    toast('Próxima acción guardada', 'ok'); recargar();
  };
  return h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [
      h('h3', {}, 'Próxima acción'),
      st === 'vencida' ? h('span', { class: 'tag danger' }, `vencida hace ${Math.abs(diasHasta(pa.fecha))} d`) : st === 'hoy' ? h('span', { class: 'tag warn' }, 'hoy') : st === 'proxima' ? h('span', { class: 'tag muted' }, `en ${diasHasta(pa.fecha)} d`) : h('span', { class: 'tag warn' }, 'sin definir')
    ]),
    h('div', { class: `prox ${st || ''}` }, [
      fInp, tInp,
      h('button', { class: 'btn sm primary', onClick: guardar }, 'Guardar'),
      pa ? h('button', { class: 'btn sm ghost', title: 'Marcar como hecha (queda en la bitácora)', onClick: async () => {
        await registrarActividad(op.id, { tipo: 'tarea', texto: pa.texto || 'Próxima acción', fecha: pa.fecha, hecha: true });
        await setProximaAccion(op.id, { fecha: null });
        toast('Hecha. Define la siguiente.', 'ok'); recargar();
      } }, '✓ Hecha') : null
    ]),
    h('div', { class: 'hint' }, 'Toda oportunidad abierta debe tener una próxima acción con fecha. Es lo que alimenta la Agenda.')
  ]);
}

function cardActividades(op) {
  const abierta = estaAbierta(op);
  const tipo = select(TIPOS_ACTIVIDAD.filter(t => t.id !== 'sistema').map(t => ({ value: t.id, label: `${t.ico} ${t.label}` })), 'nota');
  const txt = textarea({ placeholder: 'Qué se habló, qué quedó, qué pidió el cliente…' });
  const fecha = input({ type: 'date', value: todayISO() });
  const vence = input({ type: 'date', value: addDaysISO(todayISO(), 3) });
  const extraTarea = h('span', { style: { display: 'none' } }, [h('label', {}, 'Vence'), vence]);
  tipo.addEventListener('change', () => { extraTarea.style.display = tipo.value === 'tarea' ? 'contents' : 'none'; });
  const btn = h('button', { class: 'btn sm primary', onClick: async () => {
    if (!txt.value.trim()) { toast('Escribe algo', 'danger'); return; }
    btn.disabled = true;
    try {
      await registrarActividad(op.id, { tipo: tipo.value, texto: txt.value, fecha: fecha.value, vence: tipo.value === 'tarea' ? vence.value : null, hecha: false });
      txt.value = ''; toast('Registrado', 'ok'); recargar();
    } catch (e) { toast('No se pudo registrar: ' + (e.message || e), 'danger'); }
    btn.disabled = false;
  } }, 'Registrar');

  const form = abierta ? h('div', { class: 'act-form' }, [
    tipo, h('div', {}), txt,
    h('div', { class: 'act-extra' }, [h('label', {}, 'Fecha'), fecha, extraTarea, h('span', { class: 'spacer', style: { flex: 1 } }), btn])
  ]) : null;

  const items = _actividades.map(a => {
    const d = tipoActividadDef(a.tipo);
    const esTarea = a.tipo === 'tarea';
    const vencida = esTarea && !a.hecha && a.vence && a.vence < todayISO();
    return h('div', { class: `tl-item ${a.tipo} ${a.hecha ? 'hecha' : ''}` }, [
      h('div', { class: 'tl-ico' }, d.ico),
      h('div', {}, [
        h('div', { class: 'tl-meta' }, [
          h('span', {}, d.label),
          a.fecha && a.tipo !== 'sistema' ? h('span', {}, dateShort(a.fecha)) : h('span', {}, dateTimeMx(a.at)),
          h('span', {}, a.por?.nombre || ''),
          esTarea ? h('span', { class: vencida ? 'danger' : '' }, a.hecha ? `hecha ${dateShort(a.hechaAt)}` : `vence ${dateShort(a.vence)}${vencida ? ' ⚠' : ''}`) : null,
          h('span', { class: 'tl-actions' }, [
            esTarea ? h('button', { title: a.hecha ? 'Reabrir' : 'Marcar hecha', onClick: () => marcarTarea(op.id, a.id, !a.hecha) }, a.hecha ? '↺' : '✓') : null,
            a.tipo !== 'sistema' ? h('button', { title: 'Eliminar', onClick: async () => { if (await modal({ title: 'Eliminar actividad', body: '¿Quitar este registro de la bitácora?', confirmLabel: 'Eliminar', danger: true })) eliminarActividad(op.id, a.id); } }, '✕') : null
          ])
        ]),
        h('div', { class: 'tl-txt' }, a.texto)
      ])
    ]);
  });

  return h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [h('h3', {}, `Seguimiento (${_actividades.length})`), h('span', { class: 'muted', style: { fontSize: '11px' } }, `${diasSinActividad(op)} d sin actividad`)]),
    form,
    items.length ? h('div', { class: 'tl' }, items) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sin actividades todavía.')
  ]);
}

// ---------------------------------------------------------------------------
function cardCierre(op) {
  return h('div', { class: 'card' }, [
    h('h3', {}, 'Cerrar oportunidad'),
    h('div', { class: 'row' }, CIERRES.map(c => h('button', { class: `btn sm ${c.id === 'ganada' ? 'primary' : c.id === 'perdida' ? 'danger' : ''}`, title: c.desc, onClick: () => cerrar(op, c.id) }, c.label))),
    h('div', { class: 'hint' }, 'Ganada = contrato firmado o anticipo confirmado. Perdida = el cliente no nos eligió. Declinada = nosotros dijimos que no. Pospuesta = en pausa, se puede reabrir.')
  ]);
}

async function moverA(op, etapaId) {
  const e = etapaDef(etapaId);
  const nota = textarea({ rows: 2, placeholder: 'Opcional: qué pasó para moverla' });
  const ok = await modal({
    title: `Mover a "${e.label}"`,
    body: h('div', {}, [h('p', { class: 'muted', style: { margin: '0 0 10px' } }, e.desc), field('Nota', nota)]),
    confirmLabel: 'Mover',
    onConfirm: async () => { await moverEtapa(op, etapaId, nota.value.trim()); return true; }
  });
  if (ok) { toast(`Ahora en ${e.label}`, 'ok'); recargar(); }
}

async function cerrar(op, tipoInicial) {
  const cfg = state.data.config;
  const tipo = select(CIERRES.map(c => ({ value: c.id, label: c.label })), tipoInicial);
  const motivo = select([], '');
  const detalle = textarea({ rows: 2, placeholder: 'Contexto para aprender de este cierre' });
  const competidor = input({ type: 'text', placeholder: 'Quién se la llevó (si se sabe)' });
  const fecha = input({ type: 'date', value: todayISO() });
  const fechaInicio = input({ type: 'date', value: todayISO() });
  const crearProy = h('input', { type: 'checkbox', checked: !!op.presupuesto && esAdmin(state.user) });
  const wrapMotivo = field('Motivo', motivo);
  const wrapComp = field('Competidor', competidor);
  const wrapGanada = h('div', { class: 'card', style: { marginTop: '10px', padding: '12px' } }, [
    field('Fecha de inicio de obra', fechaInicio),
    esAdmin(state.user) ? h('label', { class: 'field-inline', style: { marginTop: '10px', fontSize: '13px' } }, [crearProy, ' Crear el proyecto en bitácora ahora (con la cascada del presupuesto)'])
      : h('div', { class: 'hint' }, 'Un admin creará el proyecto en bitácora desde esta ficha.'),
    !op.presupuesto ? h('div', { class: 'hint', style: { color: 'var(--warn)' } }, 'No hay presupuesto capturado: el proyecto se crearía con contrato $0. Mejor captúralo primero.') : null
  ]);
  const upd = () => {
    const t = tipo.value;
    const lista = t === 'perdida' ? cfg.motivosPerdida : t === 'declinada' ? cfg.motivosDeclinada : t === 'pospuesta' ? ['Cliente pospuso', 'Sin presupuesto por ahora', 'Espera de permisos / terreno', 'Otro'] : [];
    motivo.replaceChildren(...lista.map(m => h('option', { value: m }, m)));
    wrapMotivo.classList.toggle('hidden', !lista.length);
    wrapComp.classList.toggle('hidden', t !== 'perdida');
    wrapGanada.classList.toggle('hidden', t !== 'ganada');
  };
  tipo.addEventListener('change', upd); upd();
  const c0 = cierreDef(tipoInicial);
  const ok = await modal({
    title: `Cerrar ${op.folio || ''} como ${c0.label}`,
    body: h('div', {}, [
      field('Resultado', tipo),
      h('div', { style: { marginTop: '10px' } }, wrapMotivo),
      h('div', { style: { marginTop: '10px' } }, wrapComp),
      h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [field('Fecha', fecha)]),
      h('div', { style: { marginTop: '10px' } }, field('Detalle', detalle)),
      wrapGanada
    ]),
    confirmLabel: 'Cerrar', danger: tipo.value === 'perdida',
    onConfirm: async () => {
      try {
        await cerrarOportunidad(op, { tipo: tipo.value, motivo: motivo.value || null, detalle: detalle.value.trim(), competidor: tipo.value === 'perdida' ? competidor.value.trim() : null, fecha: fecha.value });
        if (tipo.value === 'ganada' && crearProy.checked && esAdmin(state.user)) {
          const fresh = await getOportunidad(op.id);
          await convertirEnProyecto(fresh, { fecha_inicio: fechaInicio.value });
        }
        return true;
      } catch (e) { console.error(e); toast('No se pudo cerrar: ' + (e.message || e), 'danger'); return false; }
    }
  });
  if (ok) { toast('Oportunidad cerrada', 'ok'); recargar(); }
}

function bannerCierre(op, admin) {
  const c = cierreDef(op.estado);
  const ci = op.cierre || {};
  return h('div', { class: `cierre-banner ${c?.kind || ''}` }, [
    h('strong', {}, c?.label || op.estado),
    h('span', { class: 'muted' }, `${dateMx(ci.fecha || ci.at)} · ${ci.por?.nombre || ''}`),
    ci.motivo ? h('span', {}, ci.motivo) : null,
    ci.competidor ? h('span', { class: 'muted' }, `competidor: ${ci.competidor}`) : null,
    ci.detalle ? h('span', { class: 'muted' }, ci.detalle) : null,
    h('span', { class: 'spacer' }),
    op.estado === 'ganada' ? (op.proyectoId
      ? h('a', { class: 'btn sm', href: '../#', target: '_blank', rel: 'noopener', title: `proyectoId ${op.proyectoId}` }, '📒 Proyecto en bitácora ↗')
      : admin ? h('button', { class: 'btn sm primary', onClick: () => convertir(op) }, '📒 Crear proyecto en bitácora') : h('span', { class: 'muted' }, 'Pendiente crear proyecto (admin)')) : null,
    op.estado === 'ganada' && op.proyectoId ? h('span', { class: 'hint' }, 'Vincula la obra de estimaciones en la consola → obraLinks') : null,
    h('button', { class: 'btn sm ghost', onClick: () => reabrir(op) }, '↺ Reabrir')
  ]);
}

async function convertir(op) {
  const c = calcCascada(op.presupuesto || {});
  const fechaInicio = input({ type: 'date', value: todayISO() });
  const nombre = input({ type: 'text', value: op.nombre });
  const ok = await modal({
    title: 'Crear proyecto en bitácora',
    body: h('div', {}, [
      field('Nombre del proyecto', nombre),
      h('div', { style: { marginTop: '10px' } }, field('Fecha de inicio', fechaInicio)),
      h('div', { class: 'cascada', style: { marginTop: '12px' } }, [
        h('div', { class: 'l' }, [h('span', {}, 'Costo directo'), h('strong', {}, money(c.costoDirecto))]),
        h('div', { class: 'l total' }, [h('span', {}, 'Contrato sin IVA'), h('strong', {}, money(c.subtotal))])
      ]),
      h('div', { class: 'hint' }, 'Se agrega a sogrub_proyectos con cliente, costo directo y los % de sobrecosto. El contador lo verá en Proyectos de inmediato.')
    ]),
    confirmLabel: 'Crear proyecto',
    onConfirm: async () => {
      try { await convertirEnProyecto(op, { fecha_inicio: fechaInicio.value, nombre: nombre.value.trim() || op.nombre }); return true; }
      catch (e) { console.error(e); toast('No se pudo crear: ' + (e.message || e), 'danger'); return false; }
    }
  });
  if (ok) { toast('Proyecto creado en bitácora', 'ok'); recargar(); }
}

async function reabrir(op) {
  const etapa = select(ETAPAS.map(e => ({ value: e.id, label: e.label })), op.etapa || 'lead');
  const ok = await modal({ title: 'Reabrir oportunidad', body: field('Regresar a la etapa', etapa), confirmLabel: 'Reabrir',
    onConfirm: async () => { await reabrirOportunidad(op, etapa.value); return true; } });
  if (ok) { toast('Reabierta', 'ok'); recargar(); }
}

async function borrar(op) {
  const ok = await modal({ title: `Eliminar ${op.folio || ''}`, body: 'Se borra la oportunidad y toda su bitácora de seguimiento. Si sólo se cayó, mejor ciérrala como Perdida o Declinada para que cuente en los reportes.', confirmLabel: 'Eliminar', danger: true });
  if (!ok) return;
  await eliminarOportunidad(op.id);
  if (state.data) state.data.oportunidades = state.data.oportunidades.filter(o => o.id !== op.id);
  toast('Eliminada', 'ok'); navigate('/');
}
