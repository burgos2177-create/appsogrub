import { onAuth, getUserProfile, logout } from './services/auth.js?v=1';
import { setState } from './state/store.js?v=1';
import { route, startRouter, navigate } from './state/router.js?v=1';
import { renderLogin } from './views/login.js?v=1';
import { renderMapa } from './views/mapa.js?v=3';
import { renderSalud } from './views/salud.js?v=1';
import { renderObraLinks } from './views/obralinks.js?v=1';
import { renderObras } from './views/obras.js?v=1';
import { renderUsuarios } from './views/usuarios.js?v=1';
import { h, mount } from './util/dom.js?v=2';

route('/',          () => renderMapa());
route('/salud',     () => renderSalud());
route('/obralinks', (ctx) => renderObraLinks(ctx));
route('/obras',     () => renderObras());
route('/usuarios',  (ctx) => renderUsuarios(ctx));

let started = false;

onAuth(async (fbUser) => {
  if (!fbUser) {
    setState({ user: null });
    renderLogin();
    return;
  }
  let profile = null;
  try { profile = await getUserProfile(fbUser.uid); }
  catch (err) { console.error('No se pudo leer /legacy/estimaciones/users/{uid}', err); }

  // Gate DURO: la consola es de administración. Sin perfil o rol distinto de
  // admin → sin acceso.
  if (!profile || profile.role !== 'admin') {
    setState({ user: null });
    mount('#app', h('div', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
      h('h1', {}, 'Sin acceso'),
      h('p', { class: 'sub' }, profile
        ? 'La consola central es sólo para administradores de la suite.'
        : 'Tu cuenta no tiene un perfil registrado en sogrub-suite.'),
      h('button', { class: 'btn', style: { marginTop: '16px' }, onClick: () => logout() }, 'Salir')
    ])));
    return;
  }

  setState({ user: { uid: fbUser.uid, email: fbUser.email, ...profile } });
  if (!started) { startRouter(); started = true; }
  else { navigate('/'); }
});
