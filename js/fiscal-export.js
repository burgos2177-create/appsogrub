/* =====================================================
   SOGRUB Bitácora — Exportación Fiscal
   Excel (SheetJS), CSV, PDF (jsPDF)
   ===================================================== */
'use strict';

// =====================================================
// EXCEL (SheetJS / XLSX)
// =====================================================
function exportFiscalExcel(data, rango) {
  if (typeof XLSX === 'undefined') {
    showToast('Librería XLSX no cargada', 'error');
    return;
  }

  const wb = XLSX.utils.book_new();
  const periodoStr = `${rango.desde} a ${rango.hasta}`;

  // Hoja 1: Resumen
  const resumen = [
    ['RESUMEN FISCAL — SOGRUB', '', '', periodoStr],
    [],
    ['INGRESOS'],
    ['Total ingresos', data.ingresos.total],
    ['Ingresos base (subtotal)', data.ingresos.subtotal],
    ['IVA de ingresos', data.ingresos.iva],
    ['Ingresos con IVA', data.ingresos.con_iva],
    ['Ingresos sin IVA', data.ingresos.sin_iva],
    ['Número de ingresos', data.ingresos.count],
    [],
    ['GASTOS'],
    ['Total gastos', data.gastos.total],
    ['Gastos base (subtotal)', data.gastos.subtotal],
    ['IVA de gastos', data.gastos.iva],
    ['Gastos con IVA', data.gastos.con_iva],
    ['Gastos sin IVA', data.gastos.sin_iva],
    ['Gastos deducibles (base)', data.gastos.deducible_subtotal],
    ['Gastos no deducibles', data.gastos.no_deducible_total],
    ['Número de gastos', data.gastos.count],
    [],
    ['IVA'],
    ['IVA trasladado', data.iva_trasladado],
    ['IVA acreditable', data.iva_acreditable],
    ['IVA neto', data.iva_neto],
    ['Resultado', data.iva_neto >= 0 ? 'A pagar' : 'Saldo a favor'],
    [],
    ['ISR'],
    ['Utilidad fiscal', data.utilidad_fiscal],
    ['ISR estimado', data.isr_estimado],
    ['Tasa ISR aplicada', (getFiscalConfig().tasa_isr ?? 0.30) * 100 + '%'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(resumen);
  ws1['!cols'] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');

  // Hoja 2: Por Proyecto
  const proyHeaders = ['Proyecto', 'Cliente', 'Ingresos Total', 'Ingresos Base', 'IVA Trasladado', 'Gastos Total', 'Gastos Base', 'IVA Acreditable', 'Utilidad', '# Ingresos', '# Gastos'];
  const proyRows = data.porProyecto.map(p => [
    p.nombre, p.cliente, p.ingresos_total, p.ingresos_subtotal, p.iva_trasladado,
    p.gastos_total, p.gastos_subtotal, p.iva_acreditable, p.utilidad,
    p.num_ingresos, p.num_gastos,
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([proyHeaders, ...proyRows]);
  ws2['!cols'] = proyHeaders.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Por Proyecto');

  // Hoja 3: Por Categoría
  const catHeaders = ['Categoría', '# Movimientos', 'Total', 'Base', 'IVA', 'Con IVA', 'Sin IVA', 'Proveedor Principal'];
  const catRows = data.porCategoria.map(c => [
    c.nombre, c.count, c.total, c.subtotal, c.iva, c.con_iva, c.sin_iva, c.proveedor_principal,
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]);
  ws3['!cols'] = catHeaders.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Por Categoría');

  // Hoja 4: Trazabilidad
  const trazRows = calcTrazabilidadFiscal(rango.desde, rango.hasta);
  const trazHeaders = ['Fecha', 'Proyecto', 'Tipo', 'Concepto', 'Categoría', 'Proveedor', 'Base', 'IVA', 'Total', 'Incluye IVA', 'XML', 'PDF', 'Estatus Fiscal', 'Alertas'];
  const trazData = trazRows.map(r => [
    r.fecha, r.proyecto_nombre, r.tipo, r.concepto, r.categoria, r.proveedor,
    r.subtotal, r.iva, r.total, r.incluye_iva ? 'Sí' : 'No',
    r.tiene_xml ? 'Sí' : 'No', r.tiene_pdf ? 'Sí' : 'No',
    r.estatus_label, r.alertas.map(a => a.mensaje).join('; '),
  ]);
  const ws4 = XLSX.utils.aoa_to_sheet([trazHeaders, ...trazData]);
  ws4['!cols'] = trazHeaders.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, ws4, 'Trazabilidad');

  // Hoja 5: Alertas
  const alertHeaders = ['Severidad', 'Mensaje', 'Proyecto'];
  const alertRows = data.alertas.map(a => {
    const proy = a.proyecto_id ? getItem(KEYS.PROYECTOS, a.proyecto_id) : null;
    return [a.tipo, a.mensaje, proy?.nombre ?? ''];
  });
  const ws5 = XLSX.utils.aoa_to_sheet([alertHeaders, ...alertRows]);
  ws5['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'Alertas');

  XLSX.writeFile(wb, `SOGRUB_Fiscal_${rango.desde}_${rango.hasta}.xlsx`);
  showToast('Excel exportado', 'success');
}

// =====================================================
// CSV
// =====================================================
function exportFiscalCSV(data, rango) {
  const trazRows = calcTrazabilidadFiscal(rango.desde, rango.hasta);
  const headers = ['Fecha', 'Proyecto', 'Tipo', 'Concepto', 'Categoría', 'Proveedor', 'Base', 'IVA', 'Total', 'Incluye IVA', 'XML', 'PDF', 'Estatus Fiscal', 'Alertas'];

  const csvContent = [
    headers.join(','),
    ...trazRows.map(r => [
      r.fecha,
      `"${(r.proyecto_nombre || '').replace(/"/g, '""')}"`,
      r.tipo,
      `"${(r.concepto || '').replace(/"/g, '""')}"`,
      `"${(r.categoria || '').replace(/"/g, '""')}"`,
      `"${(r.proveedor || '').replace(/"/g, '""')}"`,
      r.subtotal.toFixed(2),
      r.iva.toFixed(2),
      r.total.toFixed(2),
      r.incluye_iva ? 'Sí' : 'No',
      r.tiene_xml ? 'Sí' : 'No',
      r.tiene_pdf ? 'Sí' : 'No',
      `"${r.estatus_label}"`,
      `"${r.alertas.map(a => a.mensaje).join('; ').replace(/"/g, '""')}"`,
    ].join(',')),
  ].join('\n');

  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SOGRUB_Fiscal_${rango.desde}_${rango.hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado', 'success');
}

// =====================================================
// PDF (jsPDF + autoTable)
// =====================================================
function exportFiscalPDF(data, rango) {
  if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
    showToast('jsPDF no disponible', 'error');
    return;
  }

  const { jsPDF } = window.jspdf || window;
  const doc = new jsPDF('p', 'mm', 'letter');
  const periodoStr = `${formatDate(rango.desde)} — ${formatDate(rango.hasta)}`;
  let y = 15;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SOGRUB — Resumen Fiscal', 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Periodo: ${periodoStr}`, 14, y);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-MX')}`, 140, y);
  y += 4;
  doc.text('RESICO Persona Moral — Estimación interna', 14, y);
  y += 8;

  // Resumen en tabla
  doc.autoTable({
    startY: y,
    head: [['Concepto', 'Monto']],
    body: [
      ['Total Ingresos', formatMXN(data.ingresos.total)],
      ['  Ingresos base', formatMXN(data.ingresos.subtotal)],
      ['  IVA de ingresos', formatMXN(data.ingresos.iva)],
      ['Total Gastos', formatMXN(data.gastos.total)],
      ['  Gastos deducibles (base)', formatMXN(data.gastos.deducible_subtotal)],
      ['  Gastos no deducibles', formatMXN(data.gastos.no_deducible_total)],
      ['IVA Trasladado', formatMXN(data.iva_trasladado)],
      ['IVA Acreditable', formatMXN(data.iva_acreditable)],
      ['IVA Neto (' + (data.iva_neto >= 0 ? 'a pagar' : 'a favor') + ')', formatMXN(Math.abs(data.iva_neto))],
      ['Utilidad Fiscal', formatMXN(data.utilidad_fiscal)],
      ['ISR Estimado', formatMXN(data.isr_estimado)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [26, 159, 212], textColor: 255 },
    columnStyles: { 1: { halign: 'right' } },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Proyectos
  if (data.porProyecto.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Desglose por Proyecto', 14, y);
    y += 2;

    doc.autoTable({
      startY: y,
      head: [['Proyecto', 'Ingresos', 'Gastos', 'IVA Trasl.', 'IVA Acred.', 'Utilidad']],
      body: data.porProyecto.map(p => [
        p.nombre,
        formatMXN(p.ingresos_total),
        formatMXN(p.gastos_total),
        formatMXN(p.iva_trasladado),
        formatMXN(p.iva_acreditable),
        formatMXN(p.utilidad),
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [26, 159, 212], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  // Alertas
  if (data.alertas.length > 0 && y < 240) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Alertas Fiscales', 14, y);
    y += 2;

    doc.autoTable({
      startY: y,
      head: [['Severidad', 'Mensaje']],
      body: data.alertas.slice(0, 20).map(a => [a.tipo.toUpperCase(), a.mensaje]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [224, 82, 82], textColor: 255 },
    });
  }

  doc.save(`SOGRUB_Fiscal_${rango.desde}_${rango.hasta}.pdf`);
  showToast('PDF exportado', 'success');
}
