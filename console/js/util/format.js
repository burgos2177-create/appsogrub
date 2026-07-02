const fmtMxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export const money = (n) => fmtMxn.format(Number(n) || 0);
export const num0 = (n) => fmtNum0.format(Number(n) || 0);

export function dateMx(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return '';
  return x.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Tiempo relativo compacto ("hace 3 h", "hace 2 d"). Acepta epoch ms o ISO.
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
