// Nuttum guestbook — shared realtime board backed by Supabase.
// Visitors leave feedback / ideas / feature requests; everyone sees new notes live.
// Atabook style: Date (US Eastern) / Name / Number + a brick message. Newest on top.
(function () {
    var SUPABASE_URL = 'https://lbzlmjaylslzccjbnrcc.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiemxtamF5bHNsemNjamJucmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzc4OTgsImV4cCI6MjA5OTk1Mzg5OH0.MFg6Q7vSBY1DPcwfrCalpUNik5w5Fw32DNi1oPcF6Xk';
    var TABLE = 'guestbook';

    var sb = (window.supabase && /^https?:\/\//.test(SUPABASE_URL))
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    var count = 0;
    function setCount(n) { var c = document.getElementById('gbCount'); if (c) c.textContent = String(n); }
    function fmtDate(iso) {
        return new Date(iso || Date.now()).toLocaleString('en-US', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }
    function entryEl(row) {
        var d = document.createElement('div'); d.className = 'gb-entry';
        d.innerHTML =
            '<div class="gb-head">' +
            '<div><span class="gb-lbl">Date:</span> <span class="gb-val d"></span></div>' +
            '<div><span class="gb-lbl">Name:</span> <span class="gb-val n"></span></div>' +
            '<div><span class="gb-lbl">Number:</span> <span class="gb-val num"></span></div>' +
            '</div><div class="gb-brick gb-text"></div>';
        d.querySelector('.d').textContent = fmtDate(row.created_at);
        d.querySelector('.n').textContent = row.name || 'anon';
        d.querySelector('.num').textContent = row.id;
        d.querySelector('.gb-text').textContent = row.body || '';
        return d;
    }

    function load() {
        var list = document.getElementById('gbList'); if (!list) return;
        if (!sb) { return; }
        sb.from(TABLE).select('*').order('created_at', { ascending: false }).limit(300)
            .then(function (res) {
                if (res.error) { console.error('guestbook load', res.error); return; }
                var rows = res.data || [];
                list.innerHTML = '';
                rows.forEach(function (r) { list.appendChild(entryEl(r)); });   // newest first
                count = rows.length; setCount(count);
            })
            .catch(function (e) { console.error('guestbook', e); });
    }
    function subscribe() {
        if (!sb) return;
        sb.channel('nuttum-guestbook')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, function (p) {
                var list = document.getElementById('gbList'); if (!list) return;
                list.insertBefore(entryEl(p.new), list.firstChild);
                count += 1; setCount(count);
            })
            .subscribe();
    }

    window.nuttumSign = function () {
        var name = (document.getElementById('gbName').value || 'anon').slice(0, 30);
        var msg = document.getElementById('gbMsg').value.trim();
        if (!msg) return;
        document.getElementById('gbMsg').value = '';
        if (!sb) { return; }
        sb.from(TABLE).insert({ name: name, body: msg })
            .then(function (r) { if (r.error) console.error('sign', r.error); });
    };

    function start() { load(); subscribe(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
