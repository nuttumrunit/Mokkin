(function () {
  var cfg = window.NUTTUM || {};
  var refreshTimer = null;
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function setState(kind, state, title, detail) {
    var frame = document.getElementById(kind + 'Frame');
    var shell = frame && frame.parentElement;
    var light = document.getElementById(kind + 'Light');
    var status = document.getElementById(kind + 'State');
    var offline = state !== 'ready';
    if (shell) { shell.classList.toggle('service-offline', offline); shell.classList.toggle('is-connecting', state === 'connecting'); }
    if (light) light.classList.toggle('offline', offline);
    if (status) { status.textContent = state === 'ready' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Signal Offline'; status.className = 'panel-state ' + (state === 'ready' ? 'is-ready' : state === 'error' ? 'is-error' : ''); }
    if (kind === 'map') { var mapLabel = shell && shell.querySelector('.frame-placeholder span'); if (mapLabel) mapLabel.textContent = state === 'ready' ? 'World Map Online' : 'World Map Offline'; }
    if (kind === 'cam') { setText('camPlaceholderTitle', title || 'Reconnecting To Builder'); setText('camPlaceholderDetail', detail || 'The secure camera link is temporarily offline.'); }
  }
  function setFrame(kind, url) {
    var frame = document.getElementById(kind + 'Frame');
    var shell = frame && frame.parentElement;
    var retry = document.getElementById(kind + 'Retry');
    if (!frame || !shell) return;
    if (!url) {
      setState(kind, 'error', kind === 'cam' ? 'Builder Camera Is Standing By' : 'World Map Offline', kind === 'cam' ? 'Live video resumes automatically when the builder host reconnects.' : 'The map host is not connected.');
      if (retry) retry.hidden = true;
      return;
    }
    setState(kind, 'connecting', 'Acquiring Builder Signal', 'Establishing a secure link to the live camera.');
    if (kind === 'cam' && cfg.camMode === 'image') {
      var image = document.getElementById('camImage');
      frame.hidden = true; image.hidden = false;
      var refresh = function () { image.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(); };
      image.onload = function () { shell.classList.add('frame-loaded'); setState(kind, 'ready'); clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 2500); };
      image.onerror = function () { shell.classList.remove('frame-loaded'); setState(kind, 'error', 'Camera Signal Interrupted', 'Retrying the encrypted builder feed automatically.'); clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 5000); };
      refresh();
    } else {
      frame.src = url;
      frame.addEventListener('load', function () { shell.classList.add('frame-loaded'); setState(kind, 'ready'); }, { once: true });
    }
    if (retry) { retry.hidden = false; retry.href = url; }
  }
  setFrame('cam', cfg.cam);
  setFrame('map', cfg.map);
  var reconnect = document.getElementById('camReconnect');
  if (reconnect) reconnect.addEventListener('click', function () { setState('cam', 'connecting', 'Checking Builder Signal', 'Looking for the live camera endpoint.'); setTimeout(function () { if (cfg.cam) setFrame('cam', cfg.cam); else setState('cam', 'error', 'Builder Camera Is Standing By', 'Live video resumes automatically when the builder host reconnects.'); }, 700); });
  function updateClock() { var value = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' ET'; setText('camStandbyClock', value); setText('hudEst', value); }
  updateClock(); setInterval(updateClock, 1000);
  var popout = document.getElementById('cameraPopout');
  if (popout) {
    if (cfg.viewer || cfg.cam) popout.href = cfg.viewer || cfg.cam;
    else { popout.removeAttribute('href'); popout.setAttribute('aria-disabled', 'true'); popout.textContent = 'View Offline'; }
  }
  var ca = String(cfg.contractAddress || '').trim();
  var caValue = document.getElementById('contractValue');
  var caNote = document.getElementById('contractNote');
  var caButton = document.getElementById('contractCopy');
  if (caValue) caValue.textContent = ca || 'TBA';
  if (caNote) caNote.textContent = ca ? cfg.network : 'Published here after launch';
  if (caButton) {
    caButton.disabled = !ca;
    caButton.addEventListener('click', function () {
      if (!ca || !navigator.clipboard) return;
      navigator.clipboard.writeText(ca).then(function () { caButton.textContent = 'Copied'; setTimeout(function () { caButton.textContent = 'Copy'; }, 1400); });
    });
  }
  document.querySelectorAll('.runtime-mode').forEach(function (el) { el.textContent = cfg.data ? 'Live Runtime' : 'Verified Snapshot'; });
})();