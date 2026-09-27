/** הצגת הלוח: HTML לתצוגה ולהדפסה, וטקסט לשיתוף (וואטסאפ וכו'). */

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function luachHtml(l) {
  let h = '<div class="stripe"></div><div class="stripe s"></div><div class="stripe"></div>';
  if (l.shul) h += '<div class="l-shul">' + esc(l.shul) + '</div>';
  h += '<h2 class="l-title">' + esc(l.title) + '</h2><div class="l-dates">' + esc(l.dates) + '</div>';
  for (const s of l.sections) {
    h += '<table class="l-sec"><tr><th>' + esc(s.title) + '</th><th class="d">' + esc(s.date) + '</th></tr>';
    for (const r of s.rows) h += '<tr><td>' + esc(r.name) + '</td><td class="t">' + esc(r.text) + '</td></tr>';
    if (s.zmanim.length) {
      h += '<tr><td colspan="2" class="z">' +
        s.zmanim.map(z => '<span>' + esc(z[0]) + ' <b>' + esc(z[1]) + '</b></span>').join('') + '</td></tr>';
    }
    h += '</table>';
  }
  if (l.notes) h += '<div class="l-notes">' + esc(l.notes).replace(/\n/g, '<br>') + '</div>';
  return h;
}

export function luachText(l) {
  const lines = ['*' + l.title + '*'];
  if (l.shul) lines.push(l.shul);
  lines.push(l.dates);
  for (const s of l.sections) {
    lines.push('', '*' + s.title + '* – ' + s.date);
    for (const r of s.rows) lines.push(r.name + ' ' + r.text);
    if (s.zmanim.length) lines.push('_' + s.zmanim.map(z => z[0] + ' ' + z[1]).join(' · ') + '_');
  }
  if (l.notes) lines.push('', l.notes);
  return lines.join('\n');
}
