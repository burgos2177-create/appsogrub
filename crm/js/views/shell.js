import { h, mount } from '../util/dom.js?v=20260904-0325';
import { state } from '../state/store.js?v=20260904-0325';
import { logout, esAdmin } from '../services/auth.js?v=20260904-0325';
import { navigate, currentPath } from '../state/router.js?v=20260904-0325';
import { APP_VERSION } from '../config/firebase-config.js?v=20260904-0325';

const NAV = [
  { to: '/',         label: 'Pipeline' },
  { to: '/agenda',   label: 'Agenda' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/config',   label: 'Config', admin: true }
];

// `badges` opcional: { '/agenda': { n: 3, kind: 'danger' } }
export function renderShell(body, { wide = false, badges = {} } = {}) {
  const path = currentPath().split('?')[0];
  const isActive = (to) => to === '/' ? (path === '/' || path.startsWith('/oportunidad')) : path.startsWith(to);
  const top = h('header', { class: 'topbar' }, [
    h('div', { class: 'logo', onClick: () => navigate('/'), style: { cursor: 'pointer' } }, 'SOGRUB · CRM'),
    h('nav', { class: 'nav' }, NAV.filter(n => !n.admin || esAdmin(state.user)).map(n => {
      const b = badges[n.to];
      return h('a', { href: '#' + n.to, class: isActive(n.to) ? 'active' : '' }, [
        n.label,
        b && b.n ? h('span', { class: `badge ${b.kind || ''}` }, String(b.n)) : null
      ]);
    })),
    h('div', { class: 'spacer' }),
    h('span', { class: 'ver', title: 'Versión desplegada' }, `v${APP_VERSION}`),
    h('div', { class: 'userchip' }, [
      h('span', {}, state.user?.displayName || state.user?.email || ''),
      h('span', { class: 'role' }, state.user?.role || ''),
      h('button', { class: 'btn ghost sm', onClick: () => logout() }, 'Salir')
    ])
  ]);
  const main = h('main', { class: 'page' + (wide ? ' wide' : '') }, body);
  mount('#app', h('div', { class: 'app-layout' }, [top, main]));
}

export function cargando(msg = 'Cargando…') {
  return h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), msg]);
}
