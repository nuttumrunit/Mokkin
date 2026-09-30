// Nuttum AI — live metrics dashboard + realtime feed.
// Data is REAL and SERVER-AUTHORITATIVE: the bot writes nuttum-live.json with a persistent
// history array (one sample every 5s, kept on the server). We just render that history, so
// every visitor sees the SAME real curve and a page refresh never restarts it.
(function () {
    var LIVE = (window.NUTTUM && window.NUTTUM.data) || 'nuttum-live.json';
    var GREEN = '#12a012', RED = '#d02020';

    function hm(ms) { return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }); }
    function fmt(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return (Math.round(n * 10) / 10).toString();
    }
    function niceMax(v) {
        if (v <= 0) return 1;
        var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / mag;
        return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    }
    function pct(s, p) { return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
    function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

    var live = { history: [], events: [], stale: true };

    var metrics = [];
    document.querySelectorAll('.metric').forEach(function (m) {
        var canvas = m.querySelector('.metric-chart');
        metrics.push({
            key: m.getAttribute('data-metric'), canvas: canvas, ctx: canvas.getContext('2d'),
            legend: m.querySelector('.metric-legend'),
            unit: m.getAttribute('data-unit') || '', color: m.getAttribute('data-color') || GREEN
        });
    });

    // pull one metric's value series + matching timestamps straight from the server history
    function seriesFor(key) {
        var h = live.history || [], vals = [], times = [];
        for (var i = 0; i < h.length; i++) { vals.push(h[i][key] || 0); times.push(h[i].t); }
        if (vals.length === 0) { vals = [0]; times = [Date.now()]; }
        return { vals: vals, times: times };
    }

    function draw(m) {
        var ctx = m.ctx, W = m.canvas.width, H = m.canvas.height;
        var ser = seriesFor(m.key), d = ser.vals, times = ser.times;
        var PADL = 46, PADR = 34, PADT = 8, PADB = 18;
        var px0 = PADL, py0 = PADT, pw = W - PADL - PADR, ph = H - PADT - PADB;
        var maxV = niceMax(Math.max.apply(null, d) * 1.08) || 1;
        var n = d.length;
        function X(i) { return n <= 1 ? px0 + pw : px0 + pw * i / (n - 1); }
        function Y(v) { return py0 + ph - (v / maxV) * ph; }

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fbfbfb'; ctx.fillRect(px0, py0, pw, ph);
        ctx.font = '9px Consolas, monospace'; ctx.textBaseline = 'middle';
        for (var g = 0; g <= 4; g++) {
            var val = maxV * g / 4, y = Y(val);
            ctx.strokeStyle = (g === 0) ? '#999' : '#e6cccc';
            ctx.beginPath(); ctx.moveTo(px0, y + 0.5); ctx.lineTo(px0 + pw, y + 0.5); ctx.stroke();
            ctx.fillStyle = '#333'; ctx.textAlign = 'right'; ctx.fillText(fmt(val), px0 - 5, y);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (var vx = 0; vx <= 5; vx++) {
            var i = Math.round((n - 1) * vx / 5), x = X(i);
            ctx.strokeStyle = '#efdcdc'; ctx.beginPath(); ctx.moveTo(x + 0.5, py0); ctx.lineTo(x + 0.5, py0 + ph); ctx.stroke();
            ctx.fillStyle = '#333'; ctx.fillText(hm(times[i]), x, py0 + ph + 3);
        }
        // filled area + line
        ctx.beginPath(); ctx.moveTo(X(0), py0 + ph);
        for (var a = 0; a < n; a++) ctx.lineTo(X(a), Y(d[a]));
        ctx.lineTo(X(n - 1), py0 + ph); ctx.closePath();
        ctx.fillStyle = m.color + '4d'; ctx.fill();
        ctx.beginPath();
        for (var bb = 0; bb < n; bb++) { var xx = X(bb), yy = Y(d[bb]); if (bb === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
        ctx.strokeStyle = m.color; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.strokeStyle = RED; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px0, Y(0) + 0.5); ctx.lineTo(px0 + pw, Y(0) + 0.5); ctx.stroke();
        ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(X(n - 1), Y(d[n - 1]), 2, 0, 7); ctx.fill();
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw, ph);
        ctx.save(); ctx.translate(11, py0 + ph / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#444'; ctx.font = 'bold 9px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(m.unit, 0, 0); ctx.restore();
        ctx.save(); ctx.translate(W - 9, py0 + ph / 2); ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#cccccc'; ctx.font = '8px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('RRDTOOL / NUTTUM.AI', 0, 0); ctx.restore();
    }

    function updateLegend(m) {
        var d = seriesFor(m.key).vals, cur = d[d.length - 1];
        var s = d.slice().sort(function (a, b) { return a - b; });
        var avg = d.reduce(function (a, b) { return a + b; }, 0) / d.length;
        function c(l, v, strong) { return l + ':' + (strong ? '<b>' : '') + String(fmt(v)).padStart(7) + (strong ? '</b>' : ''); }
        m.legend.innerHTML = '<div class="lg-row"><span class="sw" style="background:' + m.color + '"></span>' +
            'Nuttum ' + c(' Min', s[0]) + '  ' + c('Avg', avg) + '  ' + c('90th', pct(s, 0.9)) + '  ' +
            c('Max', s[s.length - 1]) + '  ' + c('Cur', cur, true) + '  ' + m.unit + (live.stale ? '  [offline]' : '') + '</div>';
    }

    function renderCharts() { metrics.forEach(function (m) { draw(m); updateLegend(m); }); }

    // ---- realtime feed (real bot events) ----
    var feed = document.getElementById('nuttumFeed');
    function renderFeed() {
        if (!feed) return;
        var evs = live.events || [];
        feed.innerHTML = '';
        if (!evs.length) {
            var d0 = document.createElement('div'); d0.className = 'feed-line';
            d0.innerHTML = '<span class="feed-time">--:--:--</span> <span class="feed-tag">SYS</span> waiting for Nuttum...';
            feed.appendChild(d0);
        }
        evs.forEach(function (e) {
            var d = document.createElement('div'); d.className = 'feed-line';
            d.innerHTML = '<span class="feed-time">' + esc(e.t || '') + '</span> <span class="feed-tag">' + esc(e.tag || '') + '</span> ' + esc(e.msg || '');
            feed.appendChild(d);
        });
        feed.scrollTop = feed.scrollHeight;
    }

    (function poll() {
        fetch(LIVE + '?_=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (d) { d.stale = (Date.now() - (d.ts || 0)) > 15000; live = d; renderCharts(); renderFeed(); })
            .catch(function () { live.stale = true; renderCharts(); })
            .then(function () { setTimeout(poll, 2000); });
    })();

    // ---- live-cam HUD: total uptime (to the second) + US Eastern time ----
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function startFrom() {
        if (live.startedAt) return live.startedAt;
        var h = live.history || [];
        return h.length ? h[0].t : Date.now();
    }
    (function tickHud() {
        var up = document.getElementById('hudUptime'), est = document.getElementById('hudEst');
        if (up) {
            var s = Math.max(0, Math.floor((Date.now() - startFrom()) / 1000));
            var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
            up.textContent = (hh >= 100 ? hh : pad2(hh)) + ':' + pad2(mm) + ':' + pad2(ss);
        }
        if (est) {
            est.textContent = new Date().toLocaleTimeString('en-US', {
                timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
            }) + ' ET';
        }
        setTimeout(tickHud, 1000);
    })();
})();
