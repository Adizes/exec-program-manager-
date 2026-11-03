/* ===================================================================================
 * CHARTS — small dependency-free SVG charts (line + bar) with hover tooltips,
 * legend for ≥2 series and a "table" view. Categorical colors in fixed order.
 * =================================================================================== */
var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
var SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, parent) {
  var e = document.createElementNS(SVGNS, tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(min, max, n) {
  var span = max - min || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
  step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  var out = []; for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// opts: { x: [labels], series: [{name, values:[n|null], color?}], yMin, yMax, yFmt(v), title, height, xShort(label) }
function lineChart(opts) {
  var wrap = h('.epm-chart');
  var tableMode = false;
  var head = h('.epm-chart-head', opts.title ? h('h4', opts.title) : h('span'),
    h('button.epm-link', { type: 'button', onclick: function () { tableMode = !tableMode; this.textContent = tableMode ? 'Chart' : 'Table'; draw(); } }, 'Table'));
  var body = h('.epm-chart-body');
  var tip = h('.epm-tip', { role: 'tooltip' });
  var legend = opts.series.length > 1 ? h('.epm-legend', opts.series.map(function (s, i) {
    return h('span.epm-legend-i', h('i', { style: { background: s.color || SERIES[i % SERIES.length] } }), s.name);
  })) : null;
  append(wrap, [head, legend, body]);
  var fmt = opts.yFmt || function (v) { return v; };

  function draw() {
    clear(body);
    if (tableMode) { body.appendChild(dataTable()); return; }
    var W = Math.max(280, wrap.clientWidth || 640), H = opts.height || 240;
    var m = { l: 44, r: 12, t: 12, b: 46 };
    var vals = []; opts.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) vals.push(v); }); });
    if (!vals.length) { body.appendChild(empty('No data yet.')); return; }
    var yMin = opts.yMin != null ? opts.yMin : Math.min.apply(null, vals), yMax = opts.yMax != null ? opts.yMax : Math.max.apply(null, vals);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var n = opts.x.length, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var X = function (i) { return m.l + (n === 1 ? iw / 2 : i * iw / (n - 1)); };
    var Y = function (v) { return m.t + ih - (v - yMin) / (yMax - yMin) * ih; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': opts.title || 'chart', class: 'epm-svg' });
    niceTicks(yMin, yMax, 4).forEach(function (t) {
      sv('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'epm-grid' }, svg);
      var tx = sv('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'epm-axis' }, svg); tx.textContent = fmt(t);
    });
    var every = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));
    opts.x.forEach(function (lab, i) {
      if (i % every && i !== n - 1) return;
      var tx = sv('text', { x: X(i), y: H - m.b + 16, 'text-anchor': 'middle', class: 'epm-axis' }, svg);
      tx.textContent = opts.xShort ? opts.xShort(lab, i) : String(lab).slice(0, 10);
    });
    opts.series.forEach(function (s, si) {
      var col = s.color || SERIES[si % SERIES.length], d = '', pen = false;
      s.values.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      sv('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      s.values.forEach(function (v, i) {
        var isolated = v != null && (s.values[i - 1] == null) && (s.values[i + 1] == null);
        if (v != null && (n <= 24 || isolated)) sv('circle', { cx: X(i), cy: Y(v), r: 4, fill: col, stroke: '#fff', 'stroke-width': 2 }, svg);
      });
    });
    var cross = sv('line', { y1: m.t, y2: m.t + ih, class: 'epm-cross', visibility: 'hidden' }, svg);
    var hit = sv('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect(); var px = (e.clientX - r.left) * W / r.width;
      var i = n === 1 ? 0 : Math.round((px - m.l) / (iw / (n - 1))); i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      clear(tip);
      tip.appendChild(h('.epm-tip-t', String(opts.x[i])));
      opts.series.forEach(function (s, si) {
        var v = s.values[i]; if (v == null && opts.series.length > 1) return;
        tip.appendChild(h('.epm-tip-r', h('i', { style: { background: s.color || SERIES[si % SERIES.length] } }), h('b', v == null ? '—' : fmt(v)), opts.series.length > 1 ? h('span', s.name) : null));
      });
      tip.style.display = 'block';
      var left = X(i) * r.width / W; tip.style.left = Math.min(r.width - 180, Math.max(0, left + 12)) + 'px'; tip.style.top = '10px';
    });
    hit.addEventListener('pointerleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
    body.appendChild(svg); body.appendChild(tip);
  }
  function dataTable() {
    return h('.epm-table-wrap', h('table.epm-table.epm-table-sm', h('thead', h('tr', h('th', ''), opts.series.map(function (s) { return h('th', s.name); }))),
      h('tbody', opts.x.map(function (x, i) { return h('tr', h('td', String(x)), opts.series.map(function (s) { return h('td.num', s.values[i] == null ? '—' : fmt(s.values[i])); })); }))));
  }
  setTimeout(draw, 0);
  if (window.ResizeObserver) { var last = 0; new ResizeObserver(function () { var w = wrap.clientWidth; if (Math.abs(w - last) > 20) { last = w; draw(); } }).observe(wrap); }
  return wrap;
}

// Horizontal bars: opts { rows: [{label, value, sub}], max, fmt, title }
function barList(opts) {
  var fmt = opts.fmt || function (v) { return v; };
  var max = opts.max || Math.max.apply(null, opts.rows.map(function (r) { return r.value || 0; }).concat([1]));
  return h('.epm-chart', opts.title ? h('.epm-chart-head', h('h4', opts.title)) : null,
    opts.rows.length ? h('.epm-bars', opts.rows.map(function (r) {
      var w = r.value == null ? 0 : Math.max(0, Math.min(1, r.value / max)) * 100;
      return h('.epm-bar-row', { title: r.label + ': ' + (r.value == null ? '—' : fmt(r.value)) + (r.sub ? ' · ' + r.sub : '') },
        h('.epm-bar-label', r.label),
        h('.epm-bar-track', h('.epm-bar-fill', { style: { width: w + '%', background: r.color || SERIES[0] } })),
        h('.epm-bar-val', r.value == null ? '—' : fmt(r.value), r.sub ? h('small', ' ' + r.sub) : null));
    })) : empty('No data yet.'));
}
