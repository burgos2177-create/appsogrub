/* =====================================================
   SOGRUB Bitácora — Parser CFDI XML para módulo fiscal
   Extrae datos completos del CFDI y valida vs capturado
   ===================================================== */
'use strict';

// =====================================================
// PARSER CFDI XML COMPLETO (3.3 y 4.0)
// =====================================================
function parseCFDICompleto(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Buscar nodo Comprobante (CFDI 4.0 o 3.3)
  const comp =
    doc.querySelector('Comprobante') ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Comprobante')[0] ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Comprobante')[0];

  if (!comp) return null;

  // Emisor
  const emisor =
    comp.querySelector('Emisor') ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Emisor')[0] ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Emisor')[0];

  // Receptor
  const receptor =
    comp.querySelector('Receptor') ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Receptor')[0] ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Receptor')[0];

  // Timbre Fiscal Digital
  const tfd =
    doc.querySelector('TimbreFiscalDigital') ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/TimbreFiscalDigital', 'TimbreFiscalDigital')[0];

  // Impuestos
  const impuestos =
    comp.querySelector('Impuestos') ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Impuestos')[0] ??
    doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/3', 'Impuestos')[0];

  // IVA trasladado — buscar en nodos Traslado
  let ivaTrasladado = 0;
  const traslados = impuestos?.querySelectorAll('Traslado') ?? [];
  traslados.forEach(t => {
    if (t.getAttribute('Impuesto') === '002') { // 002 = IVA
      ivaTrasladado += parseFloat(t.getAttribute('Importe') || '0');
    }
  });
  // Fallback al atributo global
  if (ivaTrasladado === 0 && impuestos) {
    ivaTrasladado = parseFloat(impuestos.getAttribute('TotalImpuestosTrasladados') || '0');
  }

  return {
    rfc_emisor:     emisor?.getAttribute('Rfc') ?? '',
    nombre_emisor:  emisor?.getAttribute('Nombre') ?? '',
    regimen_emisor: emisor?.getAttribute('RegimenFiscal') ?? '',
    rfc_receptor:   receptor?.getAttribute('Rfc') ?? '',
    nombre_receptor: receptor?.getAttribute('Nombre') ?? '',
    uso_cfdi:       receptor?.getAttribute('UsoCFDI') ?? '',
    subtotal:       parseFloat(comp.getAttribute('SubTotal') || '0'),
    total:          parseFloat(comp.getAttribute('Total') || '0'),
    iva:            ivaTrasladado,
    uuid:           tfd?.getAttribute('UUID') ?? '',
    forma_pago:     comp.getAttribute('FormaPago') ?? '',
    metodo_pago:    comp.getAttribute('MetodoPago') ?? '',
    moneda:         comp.getAttribute('Moneda') ?? 'MXN',
    fecha:          comp.getAttribute('Fecha') ?? '',
    fecha_timbrado: tfd?.getAttribute('FechaTimbrado') ?? '',
    tipo_comprobante: comp.getAttribute('TipoDeComprobante') ?? '',
  };
}

// =====================================================
// VALIDAR CFDI vs MOVIMIENTO CAPTURADO
// =====================================================
function validarCFDIvsMovimiento(cfdiData, mov) {
  const alertas = [];
  const montoAbs = Math.abs(mov.monto || 0);

  // 1. Comparar monto total
  if (cfdiData.total > 0 && Math.abs(cfdiData.total - montoAbs) > 0.50) {
    alertas.push({
      tipo: 'error',
      mensaje: `Monto capturado (${formatMXN(montoAbs)}) ≠ XML total (${formatMXN(cfdiData.total)})`,
    });
  }

  // 2. Comparar IVA
  if (mov.incluye_iva) {
    const d = calcDesgloseFiscal(mov.monto, true);
    if (cfdiData.iva > 0 && Math.abs(cfdiData.iva - d.iva) > 0.50) {
      alertas.push({
        tipo: 'warning',
        mensaje: `IVA calculado (${formatMXN(d.iva)}) ≠ XML IVA (${formatMXN(cfdiData.iva)})`,
      });
    }
    if (cfdiData.iva === 0) {
      alertas.push({
        tipo: 'warning',
        mensaje: 'El XML no contiene IVA, pero el movimiento fue marcado con IVA',
      });
    }
  }

  // 3. Comparar proveedor vs emisor
  if (mov.subcontratista && cfdiData.nombre_emisor) {
    const provNorm = mov.subcontratista.toLowerCase().trim();
    const emisorNorm = cfdiData.nombre_emisor.toLowerCase().trim();
    if (!emisorNorm.includes(provNorm) && !provNorm.includes(emisorNorm)) {
      // Solo alertar si realmente son distintos (no substring)
      const words = provNorm.split(/\s+/);
      const match = words.some(w => w.length > 3 && emisorNorm.includes(w));
      if (!match) {
        alertas.push({
          tipo: 'info',
          mensaje: `Proveedor "${mov.subcontratista}" ≠ emisor CFDI "${cfdiData.nombre_emisor}"`,
        });
      }
    }
  }

  return {
    valido: alertas.filter(a => a.tipo === 'error').length === 0,
    alertas,
  };
}

// =====================================================
// LEER XML DESDE GOOGLE DRIVE (para validación fiscal)
// Usa la API de Drive para descargar el contenido
// =====================================================
async function leerXMLDesdeDrive(fileId) {
  try {
    const token = await driveGetToken();
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// =====================================================
// VALIDAR UN MOVIMIENTO COMPLETO (descarga XML si hay)
// =====================================================
async function validarMovimientoFiscal(mov) {
  if (!mov.factura_xml_id) {
    return { cfdi: null, validacion: null };
  }

  const xmlText = await leerXMLDesdeDrive(mov.factura_xml_id);
  if (!xmlText) {
    return { cfdi: null, validacion: { valido: false, alertas: [{ tipo: 'warning', mensaje: 'No se pudo descargar el XML desde Drive' }] } };
  }

  const cfdi = parseCFDICompleto(xmlText);
  if (!cfdi) {
    return { cfdi: null, validacion: { valido: false, alertas: [{ tipo: 'error', mensaje: 'XML no es un CFDI válido' }] } };
  }

  const validacion = validarCFDIvsMovimiento(cfdi, mov);
  return { cfdi, validacion };
}
