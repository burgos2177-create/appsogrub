/* =====================================================
   SOGRUB Bitácora — OCR de facturas PDF (client-side)
   Usa PDF.js para extraer texto y detectar el monto total
   ===================================================== */
'use strict';

// Configura el worker de PDF.js desde CDN
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// =====================================================
// Extrae todo el texto de un PDF (todas las páginas)
// =====================================================
async function extraerTextoPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// =====================================================
// Parsea un string de monto MXN → number
// Acepta: "$ 108.00" | "$108.00" | "108.00" | "1,234.56"
// =====================================================
function _parseMonto(s) {
  if (!s) return null;
  // Quitar signo de pesos, espacios internos, comas de miles, signo negativo inicial
  const limpio = s.replace(/\$/g, '').replace(/\s/g, '').replace(/,/g, '').replace(/^-/, '');
  const num = parseFloat(limpio);
  return (!isNaN(num) && num > 0) ? num : null;
}

// Regex base para un monto con decimales obligatorios (formato factura)
// Requiere exactamente 2 decimales para no confundir códigos con montos
const _RX_MONTO_STR = /\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d{4,}\.\d{2}|\d{1,3}\.\d{2})/;

// =====================================================
// DETECCIÓN PRINCIPAL
//
// Estrategias en orden de confianza:
//   1. "XXX Pesos 00/100" — texto en palabras del CFDI (más confiable)
//   2. "Total:" en tabla de resumen CFDI (SubTotal / IVA / Total)
//   3. Keyword "Total" con variantes (importe total, total a pagar…)
//   4. Última aparición de monto en la mitad inferior del doc
// =====================================================
function detectarMontoTotal(texto) {
  // Normalizar
  const norm = texto.replace(/[ \t]+/g, ' ').replace(/\r/g, '');

  // ── Estrategia 1: "Ciento ocho Pesos 00/100" ──────────────────────
  // Los CFDIs siempre incluyen el monto en palabras antes del pie.
  // La fracción "/100" nos da los centavos; el número entero lo buscamos
  // en el fragmento inmediatamente anterior a "Pesos".
  const pesosRx = /([A-ZÁÉÍÓÚ][a-záéíóúA-ZÁÉÍÓÚ\s]+)\s+[Pp]esos?\s+(\d{2})\/100/;
  const pesosMatch = norm.match(pesosRx);
  if (pesosMatch) {
    // Buscar un número decimal cerca de "Pesos XX/100" en un radio de ±150 chars
    const idx    = pesosMatch.index;
    const radio  = norm.substring(Math.max(0, idx - 150), idx + 60);
    // Buscar el monto con decimales más cercano al inicio de esa ventana
    const montoRx = /\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})/g;
    let m2;
    const candidatos = [];
    while ((m2 = montoRx.exec(radio)) !== null) {
      const n = _parseMonto(m2[1]);
      if (n) candidatos.push(n);
    }
    if (candidatos.length > 0) {
      // El total en el texto en palabras es el mayor dentro de ese radio
      return Math.max(...candidatos);
    }
    // Si no hay número cercano, intentar parsear los centavos como indicador
    const centavos = parseInt(pesosMatch[2], 10);
    // Buscar en todo el doc un número cuya parte decimal coincida
    const decRx = new RegExp(`\\b(\\d+)\\.${String(centavos).padStart(2,'0')}\\b`, 'g');
    const hits = [];
    let dm;
    while ((dm = decRx.exec(norm)) !== null) {
      const n = _parseMonto(dm[0]);
      if (n && n >= 10) hits.push(n);
    }
    if (hits.length > 0) return Math.max(...hits);
  }

  // ── Estrategia 2: "Total:" en tabla CFDI ──────────────────────────
  // Busca el patrón exacto "Total:" (o "TOTAL:") seguido del importe,
  // excluyendo líneas que empiezan con "Sub" (SubTotal) o "Descuento".
  //
  // El texto PDF suele quedar como:
  //   "SubTotal: $ 93.10 Descuento: -$ 0.00 I.V.A.: $ 14.90 Total: $ 108.00"
  // o en líneas separadas.

  const lines = norm.split('\n');
  const totalMatches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Línea que contiene "Total:" pero NO "SubTotal" ni "Descuento" ni "IVA"
    if (/total\s*:/i.test(line) && !/sub\s*total|descuento/i.test(line)) {
      const m = line.match(/total\s*:\s*-?\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i);
      if (m) {
        const n = _parseMonto(m[1]);
        if (n) totalMatches.push(n);
        continue;
      }
      // El número puede estar en el token siguiente de la misma línea
      const rest = line.replace(/.*total\s*:/i, '').trim();
      const m2 = rest.match(/^\s*-?\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i);
      if (m2) {
        const n = _parseMonto(m2[1]);
        if (n) totalMatches.push(n);
        continue;
      }
      // O en la línea siguiente
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const m3 = next.match(/^-?\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/);
        if (m3) {
          const n = _parseMonto(m3[1]);
          if (n) totalMatches.push(n);
        }
      }
    }
  }

  // También buscar el patrón compacto en una sola línea normalizada
  // "SubTotal $ 93.10 ... Total $ 108.00"
  const inlineRx = /\btotal\s*:?\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/gi;
  let im;
  while ((im = inlineRx.exec(norm)) !== null) {
    const before = norm.substring(Math.max(0, im.index - 3), im.index);
    if (/sub/i.test(before)) continue; // saltar "SubTotal"
    const n = _parseMonto(im[1]);
    if (n) totalMatches.push(n);
  }

  if (totalMatches.length > 0) {
    // De todos los "Total:" encontrados, tomar el ÚLTIMO (aparece al fondo de la tabla)
    return totalMatches[totalMatches.length - 1];
  }

  // ── Estrategia 3: Keywords ampliados ──────────────────────────────
  const keywordsRx = /(?:importe\s+total|monto\s+total|gran\s+total|total\s+a\s+pagar|total\s+general|total\s+del\s+comprobante|total\s+mxn|amount\s+due|total\s+due)\s*[:\$]?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/gi;
  let km;
  while ((km = keywordsRx.exec(norm)) !== null) {
    const n = _parseMonto(km[1]);
    if (n) return n;
  }

  // ── Estrategia 4: Fallback — último monto ≥ 10 en la mitad inferior ──
  // Usamos ÚLTIMO (no máximo) para evitar códigos SAT grandes como 31162000
  const halfDoc   = norm.slice(Math.floor(norm.length * 0.45));
  const allMontos = [];
  const fallbackRx = /\$\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/g;
  let fm;
  while ((fm = fallbackRx.exec(halfDoc)) !== null) {
    const n = _parseMonto(fm[1]);
    // Ignorar montos negativos/descuentos y menores a 1
    if (n && n >= 1) allMontos.push(n);
  }

  if (allMontos.length > 0) {
    // El último monto con "$" en la parte inferior suele ser el total
    return allMontos[allMontos.length - 1];
  }

  return null;
}

// =====================================================
// API PÚBLICA — lee un PDF y retorna el monto detectado
// =====================================================
async function leerMontoFactura(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js no está disponible');
  }
  const texto = await extraerTextoPDF(file);
  return detectarMontoTotal(texto);
}
