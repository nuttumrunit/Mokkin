(function () {
  var cfg = window.NUTTUM || {};
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function setFrame(kind, url) {
    var frame = document.getElementById(kind + 'Frame');
    var shell = frame && frame.parentElement;
    var placeholder = shell && shell.querySelector('.frame-placeholder span');
    var light = document.getElementById(kind + 'Light');
    var retry = document.getElementById(kind + 'Retry');
    if (!frame || !shell) return;
    if (!url) {
      shell.classList.add('service-offline');
      if (placeholder) placeholder.textContent = kind === 'cam' ? 'Builder Host Offline' : 'World Map Offline';
      if (light) light.classList.add('offline');
      if (retry) retry.hidden = true;
      return;
    }
    shell.classList.remove('service-offline');
    if (placeholder) placeholder.textContent = 'Connecting';
    frame.src = url;
    if (retry) { retry.hidden = false; retry.href = url; }
    frame.addEventListener('load', function () {
      shell.classList.add('frame-loaded');
      if (light) light.classList.remove('offline');
    }, { once: true });
  }
  setFrame('cam', cfg.cam);
  setFrame('map', cfg.map);
  var popout = document.getElementById('cameraPopout');
  if (popout) {
    if (cfg.cam) popout.href = cfg.cam;
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