import { h, mount } from '../util/dom.js?v=1';
import { state } from '../state/store.js?v=1';
import { logout } from '../services/auth.js?v=1';
import { navigate, currentPath } from '../state/router.js?v=1';

const NAV = [
  { to: '/',          label: 'Mapa' },
  { to: '/salud',     label: 'Salud' },
  { to: '/obralinks', label: 'obraLinks' },
  { to: '/obras',     label: 'Obras' }
];

export function renderShell(body) {
  const path = currentPath().split('?')[0];
  const top = h('header', { class: 'topbar' }, [
    h('div', { class: 'logo', onClick: () => navigate('/'), style: { cursor: 'pointer' } }, 'SOGRUB · Consola'),
    h('nav', { class: 'nav' }, NAV.map(n =>
      h('a', { href: '#' + n.to, class: path === n.to ? 'active' : '' }, n.label)
    )),
    h('div', { class: 'spacer' }),
    h('div', { class: 'userchip' }, [
      h('span', {}, state.user?.displayName || state.user?.email || ''),
      h('span', { class: 'role' }, state.user?.role || ''),
      h('button', { class: 'btn ghost sm', onClick: () => logout() }, 'Salir')
    ])
  ]);
  const main = h('main', { class: 'page' }, body);
  mount('#app', h('div', { class: 'app-layout' }, [top, main]));
}
