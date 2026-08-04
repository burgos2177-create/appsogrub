import { h, modal, toast } from '../util/dom.js?v=2';
import { setState } from '../state/store.js?v=1';
import { navigate } from '../state/router.js?v=1';
import { renderShell } from './shell.js?v=1';
import { loadEcosystem } from '../services/data.js?v=1';
import { runChecks, countBySeverity } from '../services/checks.js?v=2';
import { marcarHuerfano, normalizarHuerfano } from '../services/fixes.js?v=1';

const SEV_LABEL = { error: 'Errores', warn: 'Advertencias', info: 'Informativos' };
const SEV_ORDER = ['error', 'warn', 'info'];

export async function renderSalud() {
  renderShell(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), 'Ejecutando diagnóstico…']));
  let ctx, findings;
  try {
    ctx = await loadEcosystem(); setState({ ctx });
    findings = runChecks(ctx);
  } catch (e) {
    return renderShell(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⚠️'), String(e && e.message || e)]));
  }
  const sev = countBySeverity(findings);

  const body = [
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      h('div', {}, [
        h('h1', {}, 'Diagnóstico de salud'),
        h('p', { class: 'subttl' }, '11 invariantes de interconexión cross-app')
      ]),
      h('button', { class: 'btn', onClick: () => renderSalud() }, '↻ Re-verificar')
    ]),
    h('div', { class: 'stat-row', style: { marginBottom: '18px' } }, [
      tile(sev.error, 'Errores', 'err'), tile(sev.warn, 'Advertencias', 'warn'), tile(sev.info, 'Informativos', 'info')
    ])
  ];

  if (!findings.length) {
    body.push(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '✓'), 'Ecosistema sano. Ninguna invariante rota.']));
    return renderShell(body);
  }

  for (const s of SEV_ORDER) {
    const group = findings.filter(f => f.severity === s);
    if (!group.length) continue;
    body.push(h('h2', {}, `${SEV_LABEL[s]} (${group.length})`));
    group.forEach(f => body.push(findingRow(f)));
  }
  renderShell(body);
}

function tile(n, label, kind) {
  return h('div', { class: `stat ${kind}` }, [h('div', { class: 'stat-n' }, String(n)), h('div', { class: 'stat-l' }, label)]);
}

function findingRow(f) {
  return h('div', { class: `finding ${f.severity}` }, [
    h('div', { class: 'f-body' }, [
      h('div', { class: 'f-title' }, f.title),
      h('div', { class: 'f-detail' }, f.detail)
    ]),
    f.fix ? h('div', { class: 'f-actions' }, fixButton(f)) : null
  ]);
}

function fixButton(f) {
  const { action, label, params } = f.fix;
  return h('button', { class: 'btn sm primary', onClick: () => runFix(action, label, params) }, label);
}

async function runFix(action, label, params) {
  // Vincular obra → llevar al editor de obraLinks con la obra precargada.
  if (action === 'linkObra' || action === 'crearObraLink') {
    navigate('/obralinks?obraId=' + encodeURIComponent(params.obraId));
    return;
  }
  // Escrituras puntuales al buzón: confirmar antes.
  const fn = action === 'marcarHuerfano' ? marcarHuerfano
    : action === 'normalizarHuerfano' ? normalizarHuerfano : null;
  if (!fn) return;
  const ok = await modal({
    title: label,
    body: h('div', {}, [
      h('p', {}, action === 'marcarHuerfano'
        ? 'Se marcará el item del buzón como huérfano y se limpiará su movId.'
        : 'Se normalizará el item huérfano (movId=null, se asegura huerfanoAt).'),
      h('p', { class: 'muted mono', style: { fontSize: '12px' } }, `/shared/buzon/${params.itemId}`)
    ]),
    confirmLabel: 'Aplicar', danger: action === 'marcarHuerfano'
  });
  if (!ok) return;
  try {
    await fn(params.itemId);
    toast('Arreglo aplicado.', 'ok');
    renderSalud();
  } catch (e) {
    toast('Error: ' + (e && e.message || e), 'danger');
  }
}
