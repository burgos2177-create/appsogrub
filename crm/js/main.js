import { onAuth, getUserProfile, logout, tieneAccesoCRM } from './services/auth.js?v=20260904-0310';
import { setState } from './state/store.js?v=20260904-0310';
import { route, startRouter, navigate } from './state/router.js?v=20260904-0310';
import { renderLogin } from './views/login.js?v=20260904-0310';
import { renderPipeline } from './views/pipeline.js?v=20260904-0310';
import { renderOportunidad } from './views/oportunidad.js?v=20260904-0310';
import { renderAgenda } from './views/agenda.js?v=20260904-0310';
import { renderClientes } from './views/clientes.js?v=20260904-0310';
import { renderReportes } from './views/reportes.js?v=20260904-0310';
import { renderConfig } from './views/config.js?v=20260904-0310';
import { h, mount } from './util/dom.js?v=20260904-0310';

route('/',                  (ctx) => renderPipeline(ctx));
route('/oportunidad/:id',   (ctx) => renderOportunidad(ctx));
route('/agenda',            () => renderAgenda());
route('/clientes',          (ctx) => renderClientes(ctx));
route('/reportes',          () => renderReportes());
route('/config',            () => renderConfig());

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

  if (!tieneAccesoCRM(profile)) {
    setState({ user: null });
    mount('#app', h('div', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
      h('h1', {}, 'Sin acceso'),
      h('p', { class: 'sub' }, profile
        ? 'El CRM es para dirección (admin) e ingenieros. Un admin puede darte acceso marcando "crm" en tu perfil desde la consola.'
        : 'Tu cuenta no tiene un perfil registrado en sogrub-suite.'),
      h('button', { class: 'btn', style: { marginTop: '16px' }, onClick: () => logout() }, 'Salir')
    ])));
    return;
  }

  setState({ user: { uid: fbUser.uid, email: fbUser.email, ...profile } });
  if (!started) { startRouter(); started = true; }
  else { navigate('/'); }
});
