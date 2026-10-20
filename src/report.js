'use strict';
// Plain-Romanian summaries for producers (no technical counters).
function fillSummary(r) {
  const L = []; const lines = r.lineState || [];
  const i = r.issued;
  if (r.mode === 'fill-only') L.push('PREVIZUALIZARE: formularul a fost completat in SmartBill, dar NU s-a salvat nimic (nici ciorna, nici factura).');
  else if (i && i.status === 'draft-only') L.push(`CIORNA SALVATA in SmartBill (id ${i.invoiceId}). Nu este emisa si nu pleaca la ANAF. Verific-o si emite-o din SmartBill > Documente > Ciorne.`);
  else if (i && i.status === 'issued') L.push(`FACTURA EMISA: ${i.number || i.title || 'id ' + i.invoiceId}.`);
  else if (i) L.push(`Stare: ${i.status}`);
  if (lines.length) { L.push(`Linii (${lines.length}):`); lines.forEach((l, k) => L.push(`  ${k + 1}. ${l.name}  [${l.um}]  cod ${l.code || '-'}`)); }
  if (r.deliveryAddress) L.push('Adresa de livrare: ' + r.deliveryAddress.replace('NEADAUGATA (fill-only: ar fi adaugata la emitere)', 'magazin nou - se adauga la ciorna/factura'));
  if (i && i.draftXmlCheck) L.push('Verificare XML e-Factura: ' + Object.entries(i.draftXmlCheck).map(([k, v]) => `${k} ${v ? 'OK' : 'LIPSA'}`).join(', '));
  if (r.freeTextLines && r.freeTextLines.length) L.push('Atentie: produse care nu sunt in lista SmartBill (linie scrisa direct): ' + r.freeTextLines.map(x => x.name).join(', '));
  if (r.filledShot) L.push('Poza formularului: ' + r.filledShot);
  return L.join('\n');
}
module.exports = { fillSummary };
