// Nuttum chat room — shared realtime chat backed by Supabase.
// Every visitor sees the same live messages (Postgres realtime); images are uploaded to
// Supabase Storage so they persist for everyone. KWSX style: timestamped lines (US Eastern),
// per-user name colours, emoji + image + colour picker.
(function () {
    // ==== Supabase config — filled from your project (Settings -> API) ====
    var SUPABASE_URL = 'https://lbzlmjaylslzccjbnrcc.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiemxtamF5bHNsemNjamJucmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzc4OTgsImV4cCI6MjA5OTk1Mzg5OH0.MFg6Q7vSBY1DPcwfrCalpUNik5w5Fw32DNi1oPcF6Xk';
    var TABLE = 'messages';
    var BUCKET = 'chat-images';

    var sb = (window.supabase && /^https?:\/\//.test(SUPABASE_URL))
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    function setChatState(text, bad) {
        var el = document.getElementById('chatState'); if (!el) return;
        el.textContent = text; el.classList.toggle('is-error', Boolean(bad)); el.classList.toggle('is-ready', !bad);
    }

    var PALETTE = ["#B60205", "#D93F0B", "#FBCA04", "#0E8A16", "#006B75", "#1D76DB",
        "#0052CC", "#5319E7", "#bd6768", "#ce846b", "#dec768", "#6da871",
        "#66999e", "#749fcf", "#668dc8", "#8e72d5"];
    var EMOJIS = ["😀", "😂", "😊", "😍", "😎", "🤔", "😭", "😡", "👍", "👎",
        "🙏", "🔥", "✨", "🎉", "❤️", "💀", "👀", "🧱", "🌳", "🪵", "⭐", "🚀", "🍉", "🤖"];

    var myColor = localStorage.getItem('nuttumNameColor') || '';
    var colors = {}; // name(lowercased) -> colour

    function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function nameColor(name) {
        var lc = (name || '').toLowerCase();
        if (colors[lc]) return colors[lc];
        var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        return 'hsl(' + (h % 360) + ', 70%, 72%)';
    }
    function fmtTime(iso) {
        var d = iso ? new Date(iso) : new Date();
        return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s/g, '');
    }
    function newRow(n, iso) {
        var d = document.createElement('div'); d.className = 'chatline';
        d.innerHTML =
            '<span class="chat-time">[' + fmtTime(iso) + ']</span>' +
            '<span class="chat-body">' +
            '<span class="chat-name" style="color:' + nameColor(n) + '">' + esc(n) + ':</span> ' +
            '</span>';
        return d;
    }
    function append(d) {
        var el = document.getElementById('chatlog'); if (!el) return;
        var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
        el.appendChild(d);
        if (atBottom) el.scrollTop = el.scrollHeight;
    }
    function scrollBottom() { var el = document.getElementById('chatlog'); if (el) el.scrollTop = el.scrollHeight; }
    function line(n, m, iso) {
        var d = newRow(n, iso);
        var t = document.createElement('span'); t.className = 'chat-text'; t.textContent = m;
        d.querySelector('.chat-body').appendChild(t); append(d);
    }
    function imgLine(n, src, iso) {
        var d = newRow(n, iso);
        var img = document.createElement('img'); img.className = 'chat-img'; img.src = src;
        d.querySelector('.chat-body').appendChild(img); append(d);
    }

    function renderMsg(m) {
        if (m.color) colors[(m.name || '').toLowerCase()] = m.color;
        if (m.image_url) imgLine(m.name || '?', m.image_url, m.created_at);
        else line(m.name || '?', m.body || '', m.created_at);
    }

    function loadHistory() {
        if (!sb) { setChatState('Unavailable', true); line('system', 'chat service could not load'); return; }
        sb.from(TABLE).select('*').order('created_at', { ascending: true }).limit(150)
            .then(function (res) {
                if (res.error) { setChatState('Unavailable', true); line('system', 'chat is temporarily unavailable'); return; }
                (res.data || []).forEach(renderMsg); scrollBottom(); setChatState('Shared Room', false);
            })
            .catch(function () { setChatState('Unavailable', true); line('system', 'chat is temporarily unavailable'); });
    }
    function subscribe() {
        if (!sb) return;
        sb.channel('nuttum-chat')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE },
                function (payload) { renderMsg(payload.new); })
            .subscribe(function (status) {
                if (status === 'SUBSCRIBED') setChatState('Shared Room', false);
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setChatState('Read Only', true);
            });
    }
    function currentName() { return (document.getElementById('chatname').value || 'guest').slice(0, 40); }

    window.nuttumSend = function () {
        var n = currentName();
        var m = document.getElementById('chatmsg').value.trim();
        if (!m) return;
        if (myColor) colors[n.toLowerCase()] = myColor;
        document.getElementById('chatmsg').value = '';
        if (!sb) { line(n, m); return; }
        sb.from(TABLE).insert({ name: n, color: myColor || nameColor(n), body: m })
            .then(function (r) { if (r.error) { setChatState('Send Failed', true); line('system', 'message was not sent'); } });
    };

    function handleFile(f) {
        if (!f || !/^image\//.test(f.type)) return;
        if (f.size > 5 * 1024 * 1024) { line('system', 'image must be smaller than 5 MB'); return; }
        var n = currentName();
        if (!sb) { var rd = new FileReader(); rd.onload = function () { imgLine(n, rd.result); }; rd.readAsDataURL(f); return; }
        var ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        var pathName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        sb.storage.from(BUCKET).upload(pathName, f, { contentType: f.type, upsert: false })
            .then(function (up) {
                if (up.error) { console.error('upload', up.error); return; }
                var pub = sb.storage.from(BUCKET).getPublicUrl(pathName);
                return sb.from(TABLE).insert({ name: n, color: myColor || nameColor(n), image_url: pub.data.publicUrl });
            })
            .then(function (r) { if (r && r.error) console.error('img insert', r.error); })
            .catch(function (e) { console.error('img', e); });
    }

    // ---- input-area controls (colour / emoji / upload) ----
    function toggle(id) {
        var el = document.getElementById(id); if (!el) return;
        ['colorPalette', 'emojiPicker'].forEach(function (o) { if (o !== id) { var e = document.getElementById(o); if (e) e.classList.remove('show'); } });
        el.classList.toggle('show');
    }
    function setMyColor(c) {
        myColor = c; localStorage.setItem('nuttumNameColor', c);
        colors[currentName().toLowerCase()] = c;
        var cb = document.getElementById('colorBtn'); if (cb) cb.style.background = c;
        var p = document.getElementById('colorPalette'); if (p) p.classList.remove('show');
    }
    function insertEmoji(e) {
        var inp = document.getElementById('chatmsg'); inp.value += e; inp.focus();
        var ep = document.getElementById('emojiPicker'); if (ep) ep.classList.remove('show');
    }
    function buildUI() {
        var pal = document.getElementById('colorPalette');
        if (pal && !pal.childNodes.length) {
            PALETTE.forEach(function (c) { var s = document.createElement('div'); s.className = 'swatch'; s.style.background = c; s.onclick = function () { setMyColor(c); }; pal.appendChild(s); });
        }
        var ep = document.getElementById('emojiPicker');
        if (ep && !ep.childNodes.length) {
            EMOJIS.forEach(function (e) { var s = document.createElement('span'); s.className = 'emoji'; s.textContent = e; s.onclick = function () { insertEmoji(e); }; ep.appendChild(s); });
        }
        var cb = document.getElementById('colorBtn'); if (cb) { cb.style.background = myColor || '#0052CC'; cb.onclick = function () { toggle('colorPalette'); }; }
        var eb = document.getElementById('emojiBtn'); if (eb) eb.onclick = function () { toggle('emojiPicker'); };
        var ub = document.getElementById('uploadBtn'), fi = document.getElementById('chatfile');
        if (ub && fi) { ub.onclick = function () { fi.click(); }; fi.onchange = function () { handleFile(fi.files[0]); fi.value = ''; }; }
        loadHistory(); subscribe();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
})();
