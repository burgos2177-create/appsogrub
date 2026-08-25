/* =====================================================
   SOGRUB Bitácora — Conciliación bancaria Mifel

   Sube el CSV que exporta Mifel Empresas y lo empareja
   contra el ledger de la app (los mismos movimientos que
   suma calcSaldoMifel). Devuelve tres listas:

     · Solo en el banco  → falta registrarlo
     · Solo en la app    → registrado pero nunca salió del banco
     · Importe distinto  → mismo folio, monto que no coincide

   Lo que quede sin explicar arrastra de antes del periodo
   del estado de cuenta.
   ===================================================== */
'use strict';

const _CONC_TOL  = 0.02;   // tolerancia de importe (centavos por redondeo de IVA)
const _CONC_DIAS = 8;      // ventana de fechas para dar por buena una pareja

// =====================================================
// DINERO DE TERCEROS
// Por la cuenta pasa dinero que no es de SOGRUB (de un socio, de un cliente
// que la usa de puente). Esos cargos jamás van a estar en la bitácora, así
// que marcarlos evita perseguirlos cada mes. Un cargo puede ser MIXTO: parte
// gasto de SOGRUB y parte ajeno — se guarda solo el monto ajeno y el resto
// sigue entrando al emparejado normal.
//
// Vive en localStorage (preferencia local de conciliación, no dato contable).
// La llave es el folio del banco, que es único por movimiento.
// =====================================================
const _LS_CONC_AJENOS = 'sogrub_conc_ajenos';

function _concKeyBanco(m) {
  return m.folioBanco ? `f:${m.folioBanco}` : `d:${m.fecha}|${m.monto}`;
}

function _concLeerAjenos() {
  try { return JSON.parse(localStorage.getItem(_LS_CONC_AJENOS) || '{}') || {}; }
  catch { return {}; }
}

function _concGuardarAjenos(mapa) {
  try { localStorage.setItem(_LS_CONC_AJENOS, JSON.stringify(mapa)); }
  catch { /* modo privado: se pierde al recargar, no es crítico */ }
}

// Separa cada movimiento del banco en su parte de SOGRUB y su parte ajena.
// Devuelve { paraEmparejar, terceros } — `terceros` guarda el movimiento
// original con el monto ajeno, para poder listarlo y sumarlo aparte.
function _concAplicarAjenos(banco) {
  const mapa = _concLeerAjenos();
  const paraEmparejar = [], terceros = [];
  for (const m of banco) {
    const ajeno = Number(mapa[_concKeyBanco(m)]) || 0;
    if (!ajeno) { paraEmparejar.push(m); continue; }
    const signo = Math.sign(m.monto) || 1;
    const montoAjeno = signo * Math.min(Math.abs(ajeno), Math.abs(m.monto));
    terceros.push({ ...m, monto: montoAjeno, montoOriginal: m.monto });
    const resto = m.monto - montoAjeno;
    if (Math.abs(resto) > _CONC_TOL) paraEmparejar.push({ ...m, monto: resto, _parcial: true });
  }
  return { paraEmparejar, terceros };
}

// =====================================================
// PARSEO DEL CSV DE MIFEL
// =====================================================

// Split de una línea CSV respetando comillas.
function _concSplitCSV(linea) {
  const out = [];
  let cur = '', dentroDeComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentroDeComillas && linea[i + 1] === '"') { cur += '"'; i++; }
      else dentroDeComillas = !dentroDeComillas;
    } else if (c === ',' && !dentroDeComillas) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// '$ 1,234.56' → 1234.56 · '' → null
function _concMonto(s) {
  if (s == null) return null;
  const t = String(s).replace(/[$\s,]/g, '');
  if (!t) return null;
  const v = parseFloat(t);
  return isNaN(v) ? null : v;
}

function parseEstadoCuentaMifel(texto) {
  const lineas = texto.split(/\r?\n/);
  let saldoBanco = null, idxHeader = -1;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (saldoBanco == null && /saldo\s+total/i.test(l)) {
      const v = _concMonto(_concSplitCSV(l)[1]);
      if (v != null) saldoBanco = v;
    }
    if (idxHeader < 0 && /^\s*fecha\s*,/i.test(l) && /cargo/i.test(l)) idxHeader = i;
  }
  if (idxHeader < 0) {
    throw new Error('No encontré la fila de encabezados (Fecha, Descripción, Cargo…). ¿Es el CSV que exporta Mifel Empresas?');
  }

  const cols   = _concSplitCSV(lineas[idxHeader]).map(c => c.trim().toLowerCase());
  const col    = (pref) => cols.findIndex(c => c.startsWith(pref));
  const iFecha = col('fecha'), iDesc = col('descrip'), iFolio = col('folio');
  const iCargo = col('cargo'), iAbono = col('abono');

  const movs = [];
  for (let i = idxHeader + 1; i < lineas.length; i++) {
    if (!lineas[i] || !lineas[i].trim()) continue;
    const p = _concSplitCSV(lineas[i]);
    const f = (p[iFecha] || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!f) continue;                       // pie de página u otra fila suelta
    const monto = (_concMonto(p[iAbono]) || 0) - (_concMonto(p[iCargo]) || 0);
    if (!monto) continue;
    movs.push({
      fecha:      `${f[3]}-${f[2]}-${f[1]}`,
      concepto:   (p[iDesc]  || '').trim(),
      folioBanco: (p[iFolio] || '').trim(),
      monto,
    });
  }
  if (!movs.length) throw new Error('El archivo no trae movimientos con importe.');
  movs.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { saldoBanco, movs };
}

// =====================================================
// LEDGER DE LA APP — mismos movimientos que suma calcSaldoMifel
// =====================================================
function _concLedgerApp() {
  const out = [];
  const add = (m, de, tipo) => out.push({
    id: m.id, fecha: m.fecha, de, tipo,
    concepto: m.concepto || '', monto: Number(m.monto) || 0,
  });

  for (const m of (getCollection(KEYS.MOVIMIENTOS) ?? []))
    if (m.status === 'Pagado' && m.metodo_pago !== 'efectivo') add(m, 'SOGRUB', m.tipo);

  for (const m of (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])) {
    const metodo = m.metodo_pago ?? 'transferencia';
    if (m.tipo === 'abono_cliente' && metodo !== 'efectivo') { add(m, 'Obra', 'abono_cliente'); continue; }
    if (m.tipo !== 'gasto' || m.paga_de_caja_chica || m.no_afecta_mifel) continue;
    // Una línea por EXHIBICIÓN, no por movimiento: al banco llegan pagos
    // sueltos (anticipo, liquidación), y emparejar contra el total del gasto
    // nunca encontraría ninguno de los dos.
    for (const p of aplicacionesPago(m)) {
      if (p.metodo_pago === 'efectivo') continue;
      const parcial = !p.implicita && aplicacionesPago(m).length > 1;
      out.push({
        id: p.id, fecha: p.fecha, de: 'Obra', tipo: 'gasto',
        concepto: (m.concepto || '') + (parcial ? ` · pago ${p.nota || p.referencia || 'parcial'}` : ''),
        monto: -Math.abs(p.monto),
      });
    }
  }

  return out.filter(m => m.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Corre `dias` días a una fecha ISO (para ensanchar la ventana de emparejado).
function _concCorrerFecha(iso, dias) {
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// =====================================================
// EMPAREJADO
// =====================================================

// 'Cp-2026-056 madera' / '[CP-2026-056] OC Construlandia' → 'CP-2026-056'
function _concFolio(texto) {
  const m = String(texto || '').match(/\b(C[PC])\s?-\s?(20\d{2})\s?-\s?(\d{3})\b/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}-${m[3]}` : null;
}

const _concDias = (a, b) =>
  Math.abs((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 86400000);

// Palabras comparables de una descripción: sin acentos, en minúsculas y
// recortadas a 5 letras, para que 'Servicios contables' y 'Contabilidad' se
// reconozcan (conta == conta) sin exigir que digan lo mismo. El banco y la
// bitácora casi nunca escriben igual el concepto.
function _concTokens(texto) {
  return new Set(String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 5)
    .map(t => t.slice(0, 5)));
}

function _concAfinidad(textoA, textoB) {
  const a = _concTokens(textoA), b = _concTokens(textoB);
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

// Subconjunto de 2 a 4 elementos que sume `objetivo`. Cubre dos casos reales:
// una compra que un lado registró partida y el otro en un solo cargo, y los
// reembolsos agrupados (una transferencia que paga varias cosas de golpe).
// El tamaño 4 solo se intenta con pocos candidatos: con muchos, la
// probabilidad de que cuatro importes sumen el objetivo por casualidad deja de
// ser despreciable y saldrían parejas falsas.
function _concCombo(items, objetivo) {
  const n = items.length;
  if (n < 2 || n > 28) return null;
  const max = n <= 18 ? 4 : 3;
  const acc = [];
  const buscar = (desde, suma) => {
    if (acc.length >= 2 && Math.abs(suma - objetivo) <= _CONC_TOL) return true;
    if (acc.length >= max || desde >= n) return false;
    for (let i = desde; i < n; i++) {
      acc.push(items[i]);
      if (buscar(i + 1, suma + items[i].monto)) return true;
      acc.pop();
    }
    return false;
  };
  return buscar(0, 0) ? [...acc] : null;
}

function conciliarMifel(bancoMovs, appMovs) {
  const banco = bancoMovs.map(m => ({ ...m, _usado: false }));
  const app   = appMovs.map(m => ({ ...m, _usado: false }));
  const pares = [], difImporte = [];

  // Fase 0 — por folio CP/CC. Es la única que detecta importes distintos.
  const porFolio = new Map();
  for (const a of app) {
    const f = _concFolio(a.concepto);
    if (f && !porFolio.has(f)) porFolio.set(f, a);
  }
  for (const b of banco) {
    const f = _concFolio(b.concepto);
    const a = f && porFolio.get(f);
    if (!a || a._usado) continue;
    b._usado = a._usado = true;
    const dif = Math.abs(b.monto) - Math.abs(a.monto);
    if (Math.abs(dif) > _CONC_TOL) difImporte.push({ folio: f, banco: b, app: a, dif });
    else pares.push({ banco: [b], app: [a], via: 'folio' });
  }

  // Fase 1 — 1:1 por importe exacto. Cuando varios candidatos empatan en
  // importe (dos cargos de $2,000 la misma semana), gana el que comparte
  // palabras con la descripción del banco; sin eso, el más cercano en fecha.
  //
  // Nota: el 1:1 va antes que las sumas a propósito. Se probó posponer los
  // empates sin afinidad para que las sumas tuvieran primera opción, y salió
  // peor: los combos se llevaron movimientos que ya tenían una pareja exacta
  // buena. Un importe idéntico dentro de la ventana es mejor evidencia que
  // una suma, aunque los conceptos no se parezcan.
  for (const b of banco) {
    if (b._usado) continue;
    let mejor = null;
    for (const a of app) {
      if (a._usado || Math.abs(a.monto - b.monto) > _CONC_TOL) continue;
      const d = _concDias(a.fecha, b.fecha);
      if (d > _CONC_DIAS) continue;
      const af = _concAfinidad(a.concepto, b.concepto);
      if (!mejor || af > mejor.af || (af === mejor.af && d < mejor.d)) mejor = { a, d, af };
    }
    if (mejor) {
      b._usado = mejor.a._usado = true;
      pares.push({ banco: [b], app: [mejor.a], via: 'importe' });
    }
  }

  // Fase 2 — un cargo del banco contra varios registros de la app.
  for (const b of banco) {
    if (b._usado) continue;
    const cand = app.filter(a => !a._usado && Math.sign(a.monto) === Math.sign(b.monto)
                              && _concDias(a.fecha, b.fecha) <= _CONC_DIAS);
    const combo = _concCombo(cand, b.monto);
    if (combo) {
      b._usado = true; combo.forEach(a => { a._usado = true; });
      pares.push({ banco: [b], app: combo, via: 'suma' });
    }
  }

  // Fase 3 — un registro de la app contra varios cargos del banco. Aquí sí se
  // permiten signos mezclados: el banco a veces cobra de más y devuelve la
  // diferencia (cargo + abono = el importe real que la app registró de una vez).
  for (const a of app) {
    if (a._usado) continue;
    const cand = banco.filter(b => !b._usado && _concDias(a.fecha, b.fecha) <= _CONC_DIAS);
    const combo = _concCombo(cand, a.monto);
    if (combo) {
      a._usado = true; combo.forEach(b => { b._usado = true; });
      pares.push({ banco: combo, app: [a], via: 'suma' });
    }
  }

  let soloBanco = banco.filter(b => !b._usado);
  let soloApp   = app.filter(a => !a._usado);

  // Grupos que se cancelan solos dentro de un mismo lado (un cargo y su
  // devolución, o un pago por cuenta de alguien más que luego reembolsan).
  // No son error de nadie: suman cero y solo estorban en la lista.
  const neutros = [];
  const extraerNeutros = (lista, origen) => {
    let quedan = lista;
    for (;;) {
      const g = _concGrupoCero(quedan);
      if (!g) return quedan;
      neutros.push({ origen, movs: g });
      quedan = quedan.filter(m => !g.includes(m));
    }
  };
  soloBanco = extraerNeutros(soloBanco, 'banco');
  soloApp   = extraerNeutros(soloApp, 'app');

  // Mismo importe en ambos lados pero fuera de la ventana de fechas: no es que
  // falte o sobre, es que está registrado con otra fecha.
  const desfases = [];
  for (const b of [...soloBanco]) {
    // Se limita a un mes: más allá, dos importes iguales son casualidad y
    // acabaríamos emparejando movimientos que no tienen relación.
    const a = soloApp.find(x => Math.abs(x.monto - b.monto) <= _CONC_TOL
                             && _concDias(x.fecha, b.fecha) <= 30);
    if (!a) continue;
    desfases.push({ banco: b, app: a, dias: Math.round(_concDias(a.fecha, b.fecha)) });
    soloBanco = soloBanco.filter(x => x !== b);
    soloApp   = soloApp.filter(x => x !== a);
  }

  return { pares, difImporte, neutros, desfases, soloBanco, soloApp };
}

// Busca un subconjunto de 2 o 3 movimientos que sume cero (cargo + devolución).
// Solo dentro de una ventana corta: una devolución llega en días, no en meses,
// y sin ese límite tres importes cualesquiera acaban sumando cero por
// casualidad y se agrupan movimientos que no tienen nada que ver.
const _CONC_DIAS_CERO = 15;

function _concGrupoCero(items) {
  const n = items.length;
  const cerca = (...g) => g.every(x => _concDias(x.fecha, g[0].fecha) <= _CONC_DIAS_CERO);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(items[i].monto + items[j].monto) <= _CONC_TOL && cerca(items[i], items[j]))
        return [items[i], items[j]];
      for (let k = j + 1; k < n; k++)
        if (Math.abs(items[i].monto + items[j].monto + items[k].monto) <= _CONC_TOL
            && cerca(items[i], items[j], items[k]))
          return [items[i], items[j], items[k]];
    }
  return null;
}

// =====================================================
// VISTA
// =====================================================

// Último CSV cargado, para poder re-pintar al marcar dinero de terceros
// sin pedirte que lo vuelvas a subir.
let _concUltimoCSV = '';

function renderConciliacionCard() {
  const card = document.createElement('div');
  card.className = 'card mt-24';
  card.id = 'conciliacion-card';
  card.innerHTML = `
    <button class="collapsible-trigger" id="conc-trigger">
      🏦 Conciliar con el estado de cuenta <span class="caret">▼</span>
    </button>
    <div id="conc-content" style="display:none">
      <div style="padding-top:16px">
        <p class="text-muted text-sm" style="line-height:1.55;margin:0 0 12px">
          Descarga de Mifel Empresas el reporte de movimientos en <b>CSV</b> y súbelo aquí.
          Se empareja contra los movimientos de la app que afectan Mifel y te dice qué falta
          registrar, qué está registrado de más y qué tiene el importe cambiado.
        </p>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input type="file" id="conc-file" class="form-input" accept=".csv,text/csv"
            style="padding:6px 10px;max-width:340px">
          <button class="btn btn-secondary btn-sm" id="conc-limpiar" style="display:none">✕ Limpiar</button>
        </div>
        <div id="conc-resultado" style="margin-top:18px"></div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const trigger = card.querySelector('#conc-trigger');
    const content = card.querySelector('#conc-content');
    // Desplegable propio (no .collapsible-content: topa en 600px y cortaría
    // las tablas de resultados, que pueden ser largas).
    trigger?.addEventListener('click', () => {
      const abierto = content.style.display !== 'none';
      content.style.display = abierto ? 'none' : 'block';
      trigger.classList.toggle('open', !abierto);
    });

    const input   = card.querySelector('#conc-file');
    const limpiar = card.querySelector('#conc-limpiar');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          _concPintarResultado(String(reader.result));
          limpiar.style.display = '';
        } catch (err) {
          console.error('[Conciliación]', err);
          card.querySelector('#conc-resultado').innerHTML =
            `<div class="text-danger text-sm">⚠ ${err.message}</div>`;
        }
      };
      reader.onerror = () => showToast('No pude leer el archivo', 'error');
      // Mifel exporta en Latin-1; con UTF-8 se rompen los acentos.
      reader.readAsText(file, 'ISO-8859-1');
    });
    limpiar?.addEventListener('click', () => {
      input.value = '';
      limpiar.style.display = 'none';
      card.querySelector('#conc-resultado').innerHTML = '';
    });
  }, 0);

  return card;
}

function _concPintarResultado(texto) {
  const cont = document.getElementById('conc-resultado');
  if (!cont) return;

  _concUltimoCSV = texto;

  const { saldoBanco, movs: banco } = parseEstadoCuentaMifel(texto);
  const desde = banco[0].fecha, hasta = banco[banco.length - 1].fecha;
  const todo  = _concLedgerApp();

  // Se aparta lo que ya marcaste como dinero de terceros antes de emparejar.
  const { paraEmparejar, terceros } = _concAplicarAjenos(banco);

  // Para emparejar se ensancha la ventana: un movimiento capturado un par de
  // días antes del corte puede ser el que el banco cobró ya dentro del periodo.
  const app = todo.filter(m => m.fecha >= _concCorrerFecha(desde, -_CONC_DIAS)
                            && m.fecha <= _concCorrerFecha(hasta,  _CONC_DIAS));
  const r   = conciliarMifel(paraEmparejar, app);

  const sum = arr => arr.reduce((a, m) => a + m.monto, 0);

  // El arrastre se calcula con sumas, no con el emparejado: así el número es
  // exacto aunque alguna pareja se nos escape.
  //   saldo de la app al corte = saldo de hoy − lo posterior al corte
  //   arrastre = (banco − app) al corte − Σ banco del periodo + Σ app del periodo
  const saldoAppHoy   = calcSaldoMifel();
  const posteriores   = todo.filter(m => m.fecha > hasta);
  const saldoAppCorte = saldoAppHoy - sum(posteriores);
  const sumaBancoPer  = sum(banco);
  const sumaAppPer    = sum(todo.filter(m => m.fecha >= desde && m.fecha <= hasta));

  const diferencia    = (saldoBanco ?? 0) - saldoAppCorte;
  const arrastre      = diferencia - sumaBancoPer + sumaAppPer;
  const soloBancoNeto = sum(r.soloBanco);
  const soloAppNeto   = sum(r.soloApp);
  const difFolios     = r.difImporte.reduce((a, d) => a - d.dif, 0);   // banco cobró de más → resta

  // El dinero de terceros salió del banco durante el periodo, así que estaba
  // en el saldo al inicio: se resta del arrastre para dejar el error real.
  const tercerosNeto = sum(terceros);
  const errorReal    = arrastre + tercerosNeto;

  const fila = (etiqueta, valor, tip, resaltar) => `
    <div style="display:flex;justify-content:space-between;gap:16px${resaltar ? ';border-top:1px solid var(--border);margin-top:6px;padding-top:6px' : ''}"
         ${tip ? `title="${tip}"` : ''}>
      <span class="${resaltar ? '' : 'text-muted'}">${etiqueta}</span>
      <strong style="font-variant-numeric:tabular-nums${valor < 0 ? ';color:var(--danger)' : ''}">${formatMXN(valor)}</strong>
    </div>`;

  const tabla = (filas, vacio, conAcciones) => !filas
    ? `<div class="text-sm text-muted" style="padding:10px 0">${vacio || ''}</div>`
    : `<div class="table-wrapper" style="margin-top:8px">
         <table class="data-table">
           <thead><tr><th>Fecha</th><th>Concepto</th><th>Origen</th><th>Monto</th>${conAcciones ? '<th></th>' : ''}</tr></thead>
           <tbody>${filas}</tbody>
         </table>
       </div>`;

  const filasBanco = r.soloBanco.map(m => `
    <tr>
      <td class="text-muted">${formatDate(m.fecha)}</td>
      <td>${m.concepto || '—'}${m._parcial ? ' <span class="badge badge-muted badge-no-dot" style="font-size:10px">resto tras apartar lo ajeno</span>' : ''}</td>
      <td class="text-muted text-sm">${m.folioBanco || '—'}</td>
      <td class="${m.monto >= 0 ? 'amount-positive' : 'amount-negative'} font-mono">${formatMXN(m.monto)}</td>
      <td><button class="btn btn-ghost btn-sm conc-ajeno" data-key="${_concKeyBanco(m)}" data-monto="${Math.abs(m.monto)}"
            title="Marcar total o parcialmente como dinero que no es de SOGRUB">🚫 Ajeno</button></td>
    </tr>`).join('');

  const filasApp = r.soloApp.map(m => `
    <tr>
      <td class="text-muted">${formatDate(m.fecha)}</td>
      <td>${m.concepto || '—'}</td>
      <td class="text-muted text-sm">${m.de}</td>
      <td class="${m.monto >= 0 ? 'amount-positive' : 'amount-negative'} font-mono">${formatMXN(m.monto)}</td>
    </tr>`).join('');

  const filasDif = r.difImporte.map(d => `
    <tr>
      <td class="text-muted">${formatDate(d.banco.fecha)}</td>
      <td>${d.folio} · ${d.app.concepto.slice(0, 45)}</td>
      <td class="font-mono text-sm">app ${formatMXN(Math.abs(d.app.monto))} · banco ${formatMXN(Math.abs(d.banco.monto))}</td>
      <td class="amount-negative font-mono">${formatMXN(d.dif)}</td>
    </tr>`).join('');

  const filasDesfase = r.desfases.map(d => `
    <tr>
      <td class="text-muted">app ${formatDate(d.app.fecha)} · banco ${formatDate(d.banco.fecha)}</td>
      <td>${(d.app.concepto || '—').slice(0, 50)}</td>
      <td class="text-muted text-sm">${d.dias} días de diferencia</td>
      <td class="font-mono">${formatMXN(d.app.monto)}</td>
    </tr>`).join('');

  const filasTerceros = terceros.map(m => `
    <tr>
      <td class="text-muted">${formatDate(m.fecha)}</td>
      <td>${m.concepto || '—'}${Math.abs(m.montoOriginal) - Math.abs(m.monto) > _CONC_TOL
            ? ` <span class="text-dim" style="font-size:11px">(de ${formatMXN(Math.abs(m.montoOriginal))} en el banco)</span>` : ''}</td>
      <td class="text-muted text-sm">${m.folioBanco || '—'}</td>
      <td class="font-mono text-muted">${formatMXN(m.monto)}</td>
      <td><button class="btn btn-ghost btn-sm conc-desajeno" data-key="${_concKeyBanco(m)}" title="Ya no es dinero de terceros">↺</button></td>
    </tr>`).join('');

  const filasNeutros = r.neutros.map(g => `
    <tr>
      <td class="text-muted">${formatDate(g.movs[0].fecha)}</td>
      <td>${g.movs.map(m => `${m.concepto || '—'} <span class="font-mono text-sm">(${formatMXN(m.monto)})</span>`).join(' + ')}</td>
      <td class="text-muted text-sm">${g.origen === 'banco' ? 'banco' : 'app'}</td>
      <td class="font-mono text-muted">${formatMXN(0)}</td>
    </tr>`).join('');

  cont.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:18px">
      <div class="card" style="margin:0;padding:16px">
        <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Saldos</div>
        <div style="display:flex;flex-direction:column;gap:4px;font-size:13px">
          ${fila('Estado de cuenta', saldoBanco ?? 0)}
          ${fila(`Saldo Mifel en la app${posteriores.length ? ` <span class="text-dim" style="font-size:11px">al ${formatDate(hasta)}</span>` : ''}`,
            saldoAppCorte,
            posteriores.length ? `Hoy va en ${formatMXN(saldoAppHoy)}` : '')}
          ${fila('Diferencia', diferencia, 'Positiva = el banco tiene más que la app', true)}
          ${posteriores.length ? `
            <div style="margin-top:8px;padding:8px 10px;background:var(--surface2);border-left:3px solid var(--warning);border-radius:var(--radius);font-size:11px;line-height:1.5;color:var(--text-muted)">
              ⚠ Hay <b>${posteriores.length}</b> movimiento(s) en la app con fecha posterior al corte
              del estado de cuenta (${formatDate(hasta)}), por ${formatMXN(sum(posteriores))}. Se
              descuentan para comparar contra el mismo día. Si en realidad el banco ya los cobró
              dentro del periodo, corrígeles la fecha:
              <div style="margin-top:5px">
                ${posteriores.slice(0, 5).map(m =>
                  `· ${formatDate(m.fecha)} — ${(m.concepto || '—').slice(0, 45)} <b>${formatMXN(m.monto)}</b>`).join('<br>')}
                ${posteriores.length > 5 ? `<br>· y ${posteriores.length - 5} más` : ''}
              </div>
            </div>` : ''}
        </div>
      </div>
      <div class="card" style="margin:0;padding:16px">
        <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">De dónde sale</div>
        <div style="display:flex;flex-direction:column;gap:4px;font-size:13px">
          ${fila(`Solo en el banco (${r.soloBanco.length})`, soloBancoNeto, 'Movimientos del banco que la app no tiene')}
          ${fila(`Solo en la app (${r.soloApp.length})`, soloAppNeto, 'Registrados en la app que el banco nunca cobró')}
          ${r.difImporte.length ? fila(`Importes distintos (${r.difImporte.length})`, difFolios, 'Mismo folio, monto que no coincide') : ''}
          ${terceros.length ? fila(`Dinero de terceros (${terceros.length})`, tercerosNeto, 'Marcado a mano: no es de SOGRUB y nunca va a estar en la bitácora') : ''}
          ${fila('Arrastre anterior al periodo', arrastre, 'Diferencia que ya venía antes del primer movimiento del estado de cuenta', true)}
          ${terceros.length ? fila('Error real por explicar', errorReal, 'Arrastre menos el dinero de terceros que salió en el periodo') : ''}
        </div>
      </div>
    </div>
    <div class="text-sm text-muted" style="margin-bottom:14px">
      Periodo del estado de cuenta: <b>${formatDate(desde)} → ${formatDate(hasta)}</b> ·
      ${banco.length} movimientos en el banco · ${app.length} en la app ·
      <b style="color:var(--success)">${r.pares.length} emparejados</b>
    </div>

    ${r.difImporte.length ? `
      <h4 style="margin:18px 0 0">⚠ Mismo folio, importe distinto — corrige el monto</h4>
      ${tabla(filasDif)}` : ''}

    <h4 style="margin:18px 0 0">📥 Solo en el banco — falta registrarlos</h4>
    ${tabla(filasBanco, '✓ Nada pendiente: todo lo que cobró el banco está en la app.', true)}

    <h4 style="margin:18px 0 0">📤 Solo en la app — el banco nunca los cobró</h4>
    ${tabla(filasApp, '✓ Nada de más: todo lo registrado salió del banco.')}

    ${r.desfases.length ? `
      <h4 style="margin:18px 0 0">📅 Posible desfase de fecha — mismo importe, otro día (revisa antes de dar por buena la pareja)</h4>
      ${tabla(filasDesfase)}` : ''}

    ${terceros.length ? `
      <h4 style="margin:18px 0 0">🚫 Dinero de terceros — no es de SOGRUB</h4>
      ${tabla(filasTerceros, '', true)}` : ''}

    ${r.neutros.length ? `
      <h4 style="margin:18px 0 0">🔁 Se cancelan entre sí — no requieren acción</h4>
      ${tabla(filasNeutros)}` : ''}

    <p class="text-muted text-sm" style="margin-top:16px;line-height:1.55">
      El emparejado usa el folio CP/CC cuando viene en la descripción del banco, y si no,
      el importe exacto dentro de ±${_CONC_DIAS} días — incluyendo sumas de 2 o 3 movimientos
      cuando un lado lo registró partido. Con <b>🚫 Ajeno</b> apartas lo que no es de SOGRUB
      (total o una parte, si el cargo viene mezclado); queda guardado y ya no vuelve a
      aparecer en las siguientes conciliaciones. Si el <b>arrastre</b> no es cero, la
      diferencia nació antes de este estado de cuenta: baja un periodo más largo para ubicarla.
    </p>
  `;

  // ---- Marcar / desmarcar dinero de terceros ----
  cont.querySelectorAll('.conc-ajeno').forEach(btn =>
    btn.addEventListener('click', () => {
      const total = Number(btn.dataset.monto) || 0;
      const txt = prompt(
        `¿Cuánto de este movimiento NO es de SOGRUB?\n\n` +
        `Importe en el banco: ${formatMXN(total)}\n` +
        `Déjalo así si todo es ajeno, o escribe solo la parte ajena.`,
        total.toFixed(2)
      );
      if (txt === null) return;
      const monto = parseFloat(String(txt).replace(/[$,\s]/g, ''));
      if (isNaN(monto) || monto <= 0) { showToast('Monto inválido', 'warning'); return; }
      const mapa = _concLeerAjenos();
      mapa[btn.dataset.key] = Math.min(monto, total);
      _concGuardarAjenos(mapa);
      _concPintarResultado(_concUltimoCSV);
    })
  );

  cont.querySelectorAll('.conc-desajeno').forEach(btn =>
    btn.addEventListener('click', () => {
      const mapa = _concLeerAjenos();
      delete mapa[btn.dataset.key];
      _concGuardarAjenos(mapa);
      _concPintarResultado(_concUltimoCSV);
    })
  );
}
