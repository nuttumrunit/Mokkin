// Mokkin verified market telemetry. No synthetic transactions are generated here.
(function () {
  'use strict';
  var settings = window.NUTTUM || {};
  var remote = String(settings.data || '').trim();
  var snapshot = settings.snapshot || '../data/mokkin-live.json';
  var live = { history: [], signals: null, stale: true, source: 'loading' };
  var COLORS = { fomo: '#7cf2c3', pumpfun: '#ffd166', consumed: '#79c8ff', queue: '#ff9b6a', grid: 'rgba(205,239,255,.14)' };

  function fmt(n) {
    n = Number(n || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function et(ms, seconds) {
    return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  }
  function setText(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }
  function request(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function canvasBase(canvas) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#062b47'); bg.addColorStop(1, '#0a5478');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function emptyChart(canvas, title, detail) {
    if (!canvas) return;
    var b = canvasBase(canvas), ctx = b.ctx;
    ctx.strokeStyle = COLORS.grid; ctx.setLineDash([5, 8]);
    for (var y = 42; y < b.h - 20; y += 40) { ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(b.w - 28, y); ctx.stroke(); }
    ctx.setLineDash([]); ctx.textAlign = 'center'; ctx.fillStyle = '#e7f8ff'; ctx.font = '700 17px Arial'; ctx.fillText(title, b.w / 2, b.h / 2 - 5);
    ctx.fillStyle = '#91c8df'; ctx.font = '12px Consolas'; ctx.fillText(detail, b.w / 2, b.h / 2 + 22);
  }
  function dataNow() {
    return live.source === 'snapshot' && Number(live.ts) ? Number(live.ts) : Date.now();
  }
  function recentTransactions() {
    var rows = live.signals && Array.isArray(live.signals.recentTransactions) ? live.signals.recentTransactions : [];
    var now = dataNow(), start = now - 3600000;
    return rows.filter(function (tx) { var t = Number(tx.t); return t >= start && t <= now + 60000 && (tx.source === 'fomo' || tx.source === 'pumpfun') && tx.signature; });
  }
  function hourlyActivity() {
    var now = dataNow(), start = now - 3600000;
    var bins = Array.from({ length: 12 }, function () { return { fomo: 0, pumpfun: 0 }; });
    var minuteRows = live.signals && Array.isArray(live.signals.minuteBuckets) ? live.signals.minuteBuckets : [];
    var firstObserved = now;
    if (minuteRows.length) {
      minuteRows.forEach(function (row) {
        var t = Number(row.t); if (t < start || t > now + 60000) return;
        firstObserved = Math.min(firstObserved, t);
        var i = Math.min(11, Math.max(0, Math.floor((t - start) / 300000)));
        bins[i].fomo += Number(row.fomo || 0); bins[i].pumpfun += Number(row.pumpfun || 0);
      });
    } else {
      recentTransactions().forEach(function (tx) {
        firstObserved = Math.min(firstObserved, Number(tx.t));
        var i = Math.min(11, Math.max(0, Math.floor((Number(tx.t) - start) / 300000)));
        bins[i][tx.source]++;
      });
    }
    var fomo = bins.reduce(function (n, x) { return n + x.fomo; }, 0);
    var pumpfun = bins.reduce(function (n, x) { return n + x.pumpfun; }, 0);
    return { bins: bins, fomo: fomo, pumpfun: pumpfun, total: fomo + pumpfun, start: start, windowMinutes: Math.min(60, Math.max(1, Math.ceil((now - firstObserved) / 60000))) };
  }
  function drawVelocity() {
    var canvas = document.getElementById('transactionChart'), legend = document.getElementById('transactionLegend');
    if (!canvas) return;
    var activity = hourlyActivity(), bins = activity.bins;
    setText('transactionWindow', activity.total ? 'Observed ' + activity.windowMinutes + ' Minutes' : 'Last 60 Minutes');
    if (!activity.total) {
      emptyChart(canvas, 'No verified transactions', 'Waiting for verified onchain Fomo and pump.fun trades');
      if (legend) legend.innerHTML = '<span><i style="background:' + COLORS.fomo + '"></i>Fomo 0</span><span><i style="background:' + COLORS.pumpfun + '"></i>Pump.fun 0</span>';
      return;
    }
    var b = canvasBase(canvas), ctx = b.ctx, w = b.w, h = b.h;
    var max = Math.max(1, Math.max.apply(null, bins.map(function (x) { return x.fomo + x.pumpfun; })));
    var left = 42, right = 24, top = 25, bottom = 38, plotW = w - left - right, plotH = h - top - bottom;
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1; ctx.font = '10px Consolas'; ctx.fillStyle = '#8fc7df';
    for (var g = 0; g <= 4; g++) { var gy = top + plotH * g / 4; ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(w - right, gy); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(String(Math.round(max * (4 - g) / 4)), left - 8, gy + 3); }
    var slot = plotW / bins.length, bw = Math.max(10, slot - 10);
    bins.forEach(function (bin, i) {
      var x = left + i * slot + (slot - bw) / 2, pumpH = plotH * bin.pumpfun / max, fomoH = plotH * bin.fomo / max, base = top + plotH;
      if (pumpH) { ctx.fillStyle = COLORS.pumpfun; ctx.fillRect(x, base - pumpH, bw, pumpH); }
      if (fomoH) { ctx.fillStyle = COLORS.fomo; ctx.fillRect(x, base - pumpH - fomoH, bw, fomoH); }
      if (i % 3 === 0) { ctx.textAlign = 'center'; ctx.fillStyle = '#8fc7df'; ctx.fillText(et(activity.start + i * 300000, false), x + bw / 2, h - 16); }
    });
    if (legend) legend.innerHTML = '<span><i style="background:' + COLORS.fomo + '"></i>Fomo <b>' + fmt(activity.fomo) + '</b></span><span><i style="background:' + COLORS.pumpfun + '"></i>Pump.fun <b>' + fmt(activity.pumpfun) + '</b></span><span>Window <b>' + activity.windowMinutes + 'm · ' + fmt(activity.total) + '</b></span>';
  }  function drawCredits() {
    var canvas = document.getElementById('creditChart'), legend = document.getElementById('creditLegend');
    if (!canvas) return;
    var signals = live.signals;
    if (!signals || signals.totalVerified == null) {
      emptyChart(canvas, 'No runtime balance', 'A live signed event gateway is required');
      if (legend) legend.innerHTML = '<span>Verified <b>0</b></span><span>Built <b>0</b></span><span>Queued <b>0</b></span>';
      setText('creditChartState', 'No Runtime Data'); return;
    }
    var verified = Math.max(0, Number(signals.totalVerified || 0)), consumed = Math.max(0, Math.min(verified, Number(live.signalConsumed || 0))), queue = Math.max(0, verified - consumed);
    var b = canvasBase(canvas), ctx = b.ctx, w = b.w, h = b.h;
    var items = [{ label: 'VERIFIED TRADES', value: verified, color: COLORS.fomo }, { label: 'BLOCKS PLACED', value: consumed, color: COLORS.consumed }, { label: 'CREDITS QUEUED', value: queue, color: COLORS.queue }];
    var max = Math.max(1, verified), x0 = 190, barW = w - x0 - 46;
    items.forEach(function (item, i) {
      var y = 42 + i * 68; ctx.fillStyle = '#9ccfe3'; ctx.font = '10px Consolas'; ctx.textAlign = 'left'; ctx.fillText(item.label, 28, y + 9);
      ctx.fillStyle = '#f4fbff'; ctx.font = '700 24px Arial'; ctx.fillText(fmt(item.value), 28, y + 34);
      ctx.fillStyle = 'rgba(216,244,255,.11)'; ctx.fillRect(x0, y, barW, 28);
      ctx.fillStyle = item.color; ctx.fillRect(x0, y, barW * item.value / max, 28);
      ctx.fillStyle = '#dff5ff'; ctx.font = '10px Consolas'; ctx.textAlign = 'right'; ctx.fillText(Math.round(item.value / max * 100) + '%', w - 28, y + 18);
    });
    setText('creditChartState', queue ? fmt(queue) + ' Waiting' : 'Queue Clear');
    if (legend) legend.innerHTML = '<span>Rule <b>1 verified TX = 1 block credit</b></span><span>Consumed <b>' + fmt(consumed) + '</b></span><span>Remaining <b>' + fmt(queue) + '</b></span>';
  }
  function renderFeed() {
    var feed = document.getElementById('transactionFeed'); if (!feed) return;
    var rows = live.signals && Array.isArray(live.signals.recentTransactions) ? live.signals.recentTransactions.slice().sort(function (a, b) { return Number(b.t) - Number(a.t); }) : [];
    feed.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('div'); empty.className = 'tx-empty'; empty.innerHTML = '<strong>No verified TX received</strong><span>The feed remains empty until a verified onchain trade arrives.</span>'; feed.appendChild(empty); return;
    }
    rows.slice(0, 160).forEach(function (tx) {
      var row = document.createElement('div'); row.className = 'tx-row';
      var meta = document.createElement('div'); meta.className = 'tx-meta';
      var source = document.createElement('span'); source.className = 'tx-source ' + tx.source; source.textContent = tx.source === 'pumpfun' ? 'PUMP.FUN' : 'FOMO';
      var time = document.createElement('time'); time.textContent = et(Number(tx.t), true) + ' ET'; meta.appendChild(source); meta.appendChild(time);
      var link = document.createElement('a'); link.className = 'tx-signature'; link.href = 'https://solscan.io/tx/' + encodeURIComponent(tx.signature); link.target = '_blank'; link.rel = 'noopener'; link.textContent = tx.signature;
      row.appendChild(meta); row.appendChild(link); feed.appendChild(row);
    });
  }
  function renderStatus() {
    var source = live.source, fresh = source === 'live' && !live.stale;
    document.querySelectorAll('.runtime-mode').forEach(function (el) { el.textContent = fresh ? 'Live Verified Feed' : source === 'live' ? 'Stale Runtime' : source === 'snapshot' ? 'Last Verified Snapshot' : 'Runtime Offline'; });
    setText('txFeedState', fresh ? 'Live' : source === 'live' ? 'Stale' : source === 'snapshot' ? 'Snapshot' : 'Offline');
    var light = document.getElementById('txFeedLight'); if (light) light.classList.toggle('offline', !fresh);
    var note = document.getElementById('marketDataNotice');
    if (note) note.querySelector('span:last-child').innerHTML = fresh ? '<strong>Verified feed online.</strong> Every row below was accepted by the signed gateway and deduplicated by transaction ID.' : source === 'snapshot' ? '<strong>Last verified snapshot.</strong> Live runtime is offline; the most recent saved transaction data remains visible below.' : '<strong>Runtime offline.</strong> No current transaction feed is configured.';
    var signals = live.signals || {}, activity = hourlyActivity();
    setText('fomoCount', signals.totalVerified == null ? 'Awaiting Feed' : fmt(activity.fomo) + ' / ' + activity.windowMinutes + 'm');
    setText('pumpfunCount', signals.totalVerified == null ? 'Awaiting Feed' : fmt(activity.pumpfun) + ' / ' + activity.windowMinutes + 'm');
    setText('blockQueue', signals.totalVerified == null ? 'Runtime Offline' : fmt(Math.max(0, Number(signals.totalVerified || 0) - Number(live.signalConsumed || 0))) + ' Credits Queued');
  }
  function applyData(data, source) {
    data.source = source; data.stale = source !== 'live' || Date.now() - Number(data.ts || 0) > 15000; live = data;
    renderStatus(); drawVelocity(); drawCredits(); renderFeed();
  }
  (function poll() {
    var load = remote ? request(remote).then(function (d) { applyData(d, 'live'); return 2000; }).catch(function () { return request(snapshot).then(function (d) { applyData(d, 'snapshot'); return 30000; }); }) : request(snapshot).then(function (d) { applyData(d, 'snapshot'); return 30000; });
    load.catch(function () { live.source = 'offline'; live.stale = true; renderStatus(); drawVelocity(); drawCredits(); renderFeed(); return 10000; }).then(function (delay) { setTimeout(poll, delay || 10000); });
  })();

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  (function tickHud() {
    var up = document.getElementById('hudUptime'), est = document.getElementById('hudEst');
    if (up) {
      if (live.source !== 'live' || !live.startedAt) up.textContent = '--:--:--';
      else { var sec = Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000)), hh = Math.floor(sec / 3600); up.textContent = (hh >= 100 ? hh : pad2(hh)) + ':' + pad2(Math.floor((sec % 3600) / 60)) + ':' + pad2(sec % 60); }
    }
    if (est) est.textContent = et(Date.now(), true) + ' ET';
    setTimeout(tickHud, 1000);
  })();
  window.addEventListener('resize', function () { drawVelocity(); drawCredits(); });
})();