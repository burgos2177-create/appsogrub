import { h, modal, toast } from '../util/dom.js?v=1';
import { renderShell } from './shell.js?v=1';
import { listUsers, listObras, ROLES, setUserRole, upsertProfile, setObraAsignada, createUser } from '../services/users.js?v=1';

const ROLE_KIND = { admin: 'accent', ingeniero: 'ok', comprador: '', almacenista: 'muted' };

export async function renderUsuarios({ query } = {}) {
  renderShell(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), 'Cargando usuarios…']));
  let users, obras;
  try { [users, obras] = await Promise.all([listUsers(), listObras()]); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e && e.message || e))); }
  users.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));

  renderShell([
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      h('div', {}, [
        h('h1', {}, 'Usuarios'),
        h('p', { class: 'subttl' }, 'Pool único · /legacy/estimaciones/users. El rol es la segunda capa de acceso; sin perfil, "Sin acceso" en todas las apps.')
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', onClick: () => reparar(obras) }, '🔧 Reparar perfil (UID)'),
        h('button', { class: 'btn primary', onClick: () => nuevo(obras) }, '+ Nuevo usuario'),
        h('button', { class: 'btn', onClick: () => renderUsuarios() }, '↻')
      ])
    ]),
    h('div', { class: 'card', style: { fontSize: '12px', color: 'var(--text-1)' } }, [
      h('b', {}, 'Roles: '),
      'admin → todo · ingeniero → estimaciones (solo obras asignadas) · comprador → compras · almacenista → materiales/compras. ',
      h('span', { class: 'muted' }, 'Bitácora y la consola exigen admin.')
    ]),
    users.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Usuario', 'UID', 'Rol', 'Obras asignadas', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, users.map(u => userRow(u, obras)))
    ])) : h('div', { class: 'empty' }, 'No hay usuarios con perfil todavía.')
  ]);

  if (query && query.uid) reparar(obras, query.uid);
}

function userRow(u, obras) {
  const asignadas = u.obrasAsignadas ? Object.keys(u.obrasAsignadas).filter(k => u.obrasAsignadas[k]).length : 0;
  const sel = h('select', {}, [
    !u.role ? h('option', { value: '', selected: true }, '— sin rol —') : null,
    ...ROLES.map(r => h('option', { value: r, selected: r === u.role }, r))
  ]);
  sel.addEventListener('change', async () => {
    const nuevo = sel.value; if (!nuevo || nuevo === u.role) return;
    const ok = await modal({
      title: 'Cambiar rol',
      body: h('div', {}, [
        h('p', {}, [`${u.displayName || u.email || u.uid}: `, h('b', {}, u.role || 'sin rol'), ' → ', h('b', {}, nuevo), '.']),
        nuevo === 'admin' ? h('p', { class: 'muted' }, 'admin abre las 4 apps, incluida esta consola.') : null
      ]),
      confirmLabel: 'Cambiar rol'
    });
    if (!ok) { sel.value = u.role || ''; return; }
    try { await setUserRole(u.uid, nuevo); toast('Rol actualizado.', 'ok'); renderUsuarios(); }
    catch (e) { sel.value = u.role || ''; toast('Error: ' + (e && e.message || e), 'danger'); }
  });

  return h('tr', {}, [
    h('td', {}, [
      h('div', {}, u.displayName || '(sin nombre)'),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, u.email || '—')
    ]),
    h('td', { class: 'mono muted', style: { fontSize: '11px' } }, u.uid),
    h('td', {}, [sel, !u.role ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, 'sin rol') : null]),
    h('td', {}, u.role === 'ingeniero'
      ? (asignadas ? `${asignadas} obra(s)` : h('span', { class: 'tag warn' }, 'ninguna'))
      : h('span', { class: 'muted', title: 'Solo aplica a ingenieros' }, u.role === 'admin' ? 'todas (admin)' : '—')),
    h('td', { class: 'txt-r' }, u.role === 'ingeniero'
      ? h('button', { class: 'btn sm', onClick: () => asignarObras(u, obras) }, 'Asignar obras')
      : null)
  ]);
}

async function asignarObras(u, obras) {
  const current = new Set(Object.keys(u.obrasAsignadas || {}).filter(k => u.obrasAsignadas[k]));
  const boxes = obras.map(o => {
    const cb = h('input', { type: 'checkbox', checked: current.has(o.obraId) });
    cb.addEventListener('change', async () => {
      try { await setObraAsignada(u.uid, o.obraId, cb.checked); toast(cb.checked ? 'Obra asignada.' : 'Obra quitada.', 'ok'); }
      catch (e) { cb.checked = !cb.checked; toast('Error: ' + (e && e.message || e), 'danger'); }
    });
    return h('label', { class: 'field-inline', style: { padding: '4px 0' } }, [cb, o.nombre]);
  });
  await modal({
    title: `Obras de ${u.displayName || u.email}`,
    body: obras.length ? h('div', {}, boxes) : h('p', { class: 'muted' }, 'No hay obras registradas.'),
    confirmLabel: 'Listo', cancelLabel: 'Cerrar'
  });
  renderUsuarios();
}

function roleSelect(selected) {
  return h('select', {}, [h('option', { value: '' }, '— elegir rol —'), ...ROLES.map(r => h('option', { value: r, selected: r === selected }, r))]);
}

async function reparar(obras, uidPrefill) {
  const uid = h('input', { placeholder: 'UID de Firebase Authentication', value: uidPrefill || '' });
  const email = h('input', { type: 'email', placeholder: 'correo@ejemplo.com' });
  const nombre = h('input', { placeholder: 'Nombre visible' });
  const rol = roleSelect('admin');
  const ok = await modal({
    title: 'Reparar / crear perfil por UID',
    body: h('div', {}, [
      h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '0' } }, 'Para un usuario que ya existe en Authentication pero no tiene perfil (no aparece / "Sin acceso"). Copia su UID desde Firebase → Authentication.'),
      h('div', { class: 'field' }, [h('label', {}, 'UID'), uid]),
      h('div', { class: 'field' }, [h('label', {}, 'Correo'), email]),
      h('div', { class: 'field' }, [h('label', {}, 'Nombre'), nombre]),
      h('div', { class: 'field' }, [h('label', {}, 'Rol'), rol])
    ]),
    confirmLabel: 'Guardar perfil'
  });
  if (!ok) return;
  if (!uid.value.trim() || !rol.value) { toast('Faltan UID y rol.', 'warn'); return; }
  try {
    await upsertProfile(uid.value.trim(), { email: email.value.trim(), displayName: nombre.value.trim(), role: rol.value });
    toast('Perfil guardado. El usuario ya puede entrar.', 'ok');
    renderUsuarios();
  } catch (e) { toast('Error: ' + (e && e.message || e), 'danger'); }
}

async function nuevo(obras) {
  const email = h('input', { type: 'email', placeholder: 'correo@ejemplo.com' });
  const pass = h('input', { type: 'password', placeholder: 'contraseña temporal (mín. 6)' });
  const nombre = h('input', { placeholder: 'Nombre visible' });
  const rol = roleSelect('comprador');
  const ok = await modal({
    title: 'Nuevo usuario',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'Correo'), email]),
      h('div', { class: 'field' }, [h('label', {}, 'Contraseña'), pass]),
      h('div', { class: 'field' }, [h('label', {}, 'Nombre'), nombre]),
      h('div', { class: 'field' }, [h('label', {}, 'Rol'), rol])
    ]),
    confirmLabel: 'Crear usuario'
  });
  if (!ok) return;
  if (!email.value.trim() || pass.value.length < 6 || !rol.value) { toast('Correo, contraseña (≥6) y rol son obligatorios.', 'warn'); return; }
  try {
    await createUser({ email: email.value.trim(), password: pass.value, displayName: nombre.value.trim(), role: rol.value });
    toast('Usuario creado.', 'ok');
    renderUsuarios();
  } catch (e) { toast('Error: ' + (e && e.message || e), 'danger'); }
}
