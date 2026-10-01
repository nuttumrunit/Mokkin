(function () {
  var cfg = window.NUTTUM || {};
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function setOffline(kind, offline) {
    var frame = document.getElementById(kind + 'Frame'), shell = frame && frame.parentElement, light = document.getElementById(kind + 'Light');
    if (shell) shell.classList.toggle('service-offline', offline);
    if (light) light.classList.toggle('offline', offline);
  }
  function setFrame(kind, url) {
    var frame = document.getElementById(kind + 'Frame');
    var shell = frame && frame.parentElement;
    var placeholder = shell && shell.querySelector('.frame-placeholder span');
    var retry = document.getElementById(kind + 'Retry');
    if (!frame || !shell) return;
    if (!url) {
      setOffline(kind, true);
      if (placeholder) placeholder.textContent = kind === 'cam' ? 'Builder Host Offline' : 'World Map Offline';
      if (retry) retry.hidden = true;
      return;
    }
    setOffline(kind, false); if (placeholder) placeholder.textContent = 'Connecting To Live Service';
    if (kind === 'cam' && cfg.camMode === 'image') {
      var image = document.getElementById('camImage'); frame.hidden = true; image.hidden = false;
      var refresh = function () { image.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(); };
      image.onload = function () { shell.classList.add('frame-loaded'); setOffline(kind, false); setTimeout(refresh, 2500); };
      image.onerror = function () { shell.classList.remove('frame-loaded'); setOffline(kind, true); if (placeholder) placeholder.textContent = 'Live Camera Disconnected'; setTimeout(refresh, 5000); };
      refresh();
    } else {
      frame.src = url;
      frame.addEventListener('load', function () { shell.classList.add('frame-loaded'); setOffline(kind, false); }, { once: true });
    }
    if (retry) { retry.hidden = false; retry.href = url; }
  }
  setFrame('cam', cfg.cam);
  setFrame('map', cfg.map);
  var popout = document.getElementById('cameraPopout');
  if (popout) {
    if (cfg.viewer || cfg.cam) popout.href = cfg.viewer || cfg.cam;
    else { popout.removeAttribute('href'); popout.setAttribute('aria-disabled', 'true'); popout.textContent = 'Host Offline'; }
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
      navigator.clipboard.writeText(ca).then(function () {
        caButton.textContent = 'Copied'; setTimeout(function () { caButton.textContent = 'Copy'; }, 1400);
      });
    });
  }
  document.querySelectorAll('.runtime-mode').forEach(function (el) { el.textContent = cfg.data ? 'Live Runtime' : 'Verified Snapshot'; });
})();