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
    // Reconstruye el texto con espacios, preservando proximidad de tokens
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// =====================================================
// Parsea un string de monto MXN → number
// Acepta: "16,709.80" | "$16,709.80" | "16709.80" | "16 709.80"
// =====================================================
function parsearMonto(str) {
  if (!str) return null;
  // Quitar signo de pesos, espacios internos y comas de miles
  const limpio = str.replace(/\$/g, '').replace(/\s/g, '').replace(/,/g, '');
  const num = parseFloat(limpio);
  return (!isNaN(num) && num > 0) ? num : null;
}

// =====================================================
// Detecta el monto total en texto de factura
//
// Estrategia multi-paso:
//   1. Buscar cerca de palabras clave de "total" (excluyendo subtotal)
//   2. Buscar el patrón CFDI estructurado (Subtotal / IVA / Total)
//   3. Fallback: el mayor importe del documento
// =====================================================
function detectarMontoTotal(texto) {
  // Normalizar: colapsar espacios múltiples, preservar saltos de línea
  const norm = texto.replace(/[ \t]+/g, ' ').replace(/\r/g, '');

  // Regex para montos con formato MXN: 1,234.56 o 1234.56 o 1 234.56
  const MONTO_RX = /\$?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})/g;

  // ── Paso 1: Buscar montos después de keywords de "total" ──
  // Excluir "subtotal" para no confundirlo con el total final
  const totalKeywordRx = /(?<!\w)(?:total\s+(?:a\s+pagar|del\s+comprobante|factura|mxn|importe)?|importe\s+total|monto\s+total|gran\s+total|total\s+general|precio\s+total|amount\s+due|total\s+due)\s*[:\$]?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})/gi;

  const candidatosPaso1 = [];
  let m;
  while ((m = totalKeywordRx.exec(norm)) !== null) {
    const num = parsearMonto(m[1]);
    if (num !== null) candidatosPaso1.push(num);
  }

  // También buscar líneas donde la palabra exacta "total" aparece sola
  // seguida por un número en la misma o siguiente línea (formato tabla)
  const lines = norm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Línea que es exactamente "Total" o "TOTAL" con posible espacio y monto
    if (/^total\s*[:\$]?\s*(\d[\d,\s.]+)$/i.test(line)) {
      const match = line.match(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})/);
      if (match) {
        const num = parsearMonto(match[1]);
        if (num !== null) candidatosPaso1.push(num);
      }
    }
    // Línea que solo dice "Total" o "TOTAL" y la siguiente tiene el número
    if (/^total\s*[:\$]?\s*$/i.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const match = nextLine.match(/^[:\$]?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})/);
      if (match) {
        const num = parsearMonto(match[1]);
        if (num !== null) candidatosPaso1.push(num);
      }
    }
  }

  if (candidatosPaso1.length > 0) {
    // Si hay varios candidatos, el mayor suele ser el total final
    // (el subtotal es siempre menor que el total con IVA)
    return Math.max(...candidatosPaso1);
  }

  // ── Paso 2: Patrón CFDI — buscar la secuencia Subtotal → IVA → Total ──
  // En CFDI el texto suele tener: "Subtotal $X IVA $Y Total $Z"
  const cfdiRx = /subtotal\s*\$?\s*([\d,]+\.?\d*)\s+(?:iva|impuesto|taxes?)\s*\$?\s*([\d,]+\.?\d*)\s+total\s*\$?\s*([\d,]+\.?\d*)/i;
  const cfdiMatch = cfdiRx.exec(norm);
  if (cfdiMatch) {
    const num = parsearMonto(cfdiMatch[3]);
    if (num !== null) return num;
  }

  // ── Paso 3: Fallback — mayor monto del documento ──
  // (excluir cantidades muy pequeñas que son unitarias/cantidades)
  const todosLosMontos = [];
  let fm;
  while ((fm = MONTO_RX.exec(norm)) !== null) {
    const num = parsearMonto(fm[1]);
    // Ignorar montos menores a 10 (cantidades, porcentajes, etc.)
    if (num !== null && num >= 10) todosLosMontos.push(num);
  }

  if (todosLosMontos.length > 0) {
    return Math.max(...todosLosMontos);
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
