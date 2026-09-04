const fmtMxn  = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMxn0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const fmtNum0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export const money  = (n) => fmtMxn.format(Number(n) || 0);
export const money0 = (n) => fmtMxn0.format(Number(n) || 0);
export const num0   = (n) => fmtNum0.format(Number(n) || 0);
export const pct    = (n) => `${Math.round(Number(n) || 0)}%`;

// Montos compactos para tarjetas: $1.2M, $850k
export function moneyCompact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return money0(v);
}

export function dateMx(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00' : d);
  if (isNaN(x)) return '';
  return x.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function dateShort(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00' : d);
  if (isNaN(x)) return '';
  return x.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}
export function dateTimeMx(ts) {
  if (!ts) return '';
  const x = new Date(ts);
  if (isNaN(x)) return '';
  return x.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDaysISO(iso, days) {
  const d = new Date((iso || todayISO()) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Días entre una fecha ISO (AAAA-MM-DD) y hoy. Negativo = ya pasó.
export function diasHasta(iso) {
  if (!iso) return null;
  const a = new Date(todayISO() + 'T12:00:00');
  const b = new Date(iso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}
export function diasDesde(ts) {
  if (!ts) return null;
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export function ago(ts) {
  if (!ts) return '—';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
  const hh = Math.floor(m / 60); if (hh < 24) return `hace ${hh} h`;
  const dd = Math.floor(hh / 24); if (dd < 30) return `hace ${dd} d`;
  const mo = Math.floor(dd / 30); if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
  return `hace ${Math.floor(mo / 12)} año(s)`;
}
