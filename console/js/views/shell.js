import { h, mount } from '../util/dom.js?v=2';
import { state } from '../state/store.js?v=1';
import { logout } from '../services/auth.js?v=1';
import { navigate, currentPath } from '../state/router.js?v=1';

const NAV = [
  { to: '/',          label: 'Mapa' },
  { to: '/salud',     label: 'Salud' },
  { to: '/obralinks', label: 'obraLinks' },
  { to: '/obras',     label: 'Obras' },
  { to: '/usuarios',  label: 'Usuarios' }
];

// Apps hermanas servidas como rutas vecinas de GitHub Pages (…/appsogrub/crm/,
// …/appsogrub/). El href es relativo a esta página, así que funciona igual en
// producción y al servir el repo completo desde su raíz. Si se sirve `console/`
// sola en un puerto (python -m http.server dentro de console/), el vecino no
// existe y el link no resuelve — es sólo del entorno de desarrollo.
const APPS = [
  { href: '../crm/', label: '🤝 CRM', title: 'Pipeline comercial — leads, propuestas y cierres' }
];

export function renderShell(body) {
  const path = currentPath().split('?')[0];
  const top = h('header', { class: 'topbar' }, [
    h('div', { class: 'logo', onClick: () => navigate('/'), style: { cursor: 'pointer' } }, 'SOGRUB · Consola'),
    h('nav', { class: 'nav' }, NAV.map(n =>
      h('a', { href: '#' + n.to, class: path === n.to ? 'active' : '' }, n.label)
    )),
    h('div', { class: 'spacer' }),
    h('nav', { class: 'nav apps' }, APPS.map(a =>
      h('a', { href: a.href, class: 'ext', title: a.title }, [a.label, h('span', { class: 'ext-ico' }, '↗')])
    )),
    h('div', { class: 'userchip' }, [
      h('span', {}, state.user?.displayName || state.user?.email || ''),
      h('span', { class: 'role' }, state.user?.role || ''),
      h('button', { class: 'btn ghost sm', onClick: () => logout() }, 'Salir')
    ])
  ]);
  const main = h('main', { class: 'page' }, body);
  mount('#app', h('div', { class: 'app-layout' }, [top, main]));
}
