(function(){
  var triggers=[].slice.call(document.querySelectorAll('.github-browser-trigger'));
  if(!triggers.length)return;
  var repo=triggers[0].getAttribute('data-repo')||'nuttumrunit/Mokkin';
  var branch=triggers[0].getAttribute('data-branch')||'main';
  var modal=document.createElement('div');
  modal.className='github-browser-modal';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<section class="github-browser-dialog" role="dialog" aria-modal="true" aria-label="Mokkin GitHub repository browser"><header class="github-browser-head"><span class="github-browser-mark">&lt;/&gt;</span><span class="github-browser-title"><strong>Mokkin Source Archive</strong><small>'+repo+' / '+branch+'</small></span><a class="github-browser-open" href="https://github.com/'+repo+'" target="_blank" rel="noopener">Open GitHub</a><button class="github-browser-close" type="button" aria-label="Close">×</button></header><div class="github-browser-body"><aside class="github-browser-sidebar"><input class="github-browser-search" type="search" placeholder="Search files" aria-label="Search repository files"><div class="github-browser-meta">Loading repository</div><div class="github-browser-tree"></div></aside><main class="github-browser-view"><div class="github-browser-path">Select a file</div><div class="github-browser-empty">Browse the public Mokkin source without leaving the site.<br>Select a file from the archive.</div></main></div></section>';
  document.body.appendChild(modal);
  var closeButton=modal.querySelector('.github-browser-close'), search=modal.querySelector('.github-browser-search'), meta=modal.querySelector('.github-browser-meta'), tree=modal.querySelector('.github-browser-tree'), view=modal.querySelector('.github-browser-view');
  var files=[],loaded=false,lastFocus=null;
  function api(path){return 'https://api.github.com/repos/'+repo+path}
  function raw(path){return 'https://raw.githubusercontent.com/'+repo+'/'+branch+'/'+path.split('/').map(encodeURIComponent).join('/')}
  function escapePath(path){return path.replace(/[^a-z0-9._/-]/gi,'')}
  function renderTree(){
    var term=search.value.trim().toLowerCase();
    var shown=files.filter(function(f){return !term||f.path.toLowerCase().indexOf(term)>-1}).slice(0,600);
    tree.textContent=''; meta.textContent=shown.length+' of '+files.length+' files';
    shown.forEach(function(file){var button=document.createElement('button');button.type='button';button.className='github-browser-file';button.innerHTML='<span>◇</span><span></span>';button.lastChild.textContent=file.path;button.addEventListener('click',function(){openFile(file,button)});tree.appendChild(button)});
    if(!shown.length){tree.innerHTML='<div class="github-browser-empty">No matching files.</div>'}
  }
  function setMessage(message){view.innerHTML='<div class="github-browser-path">Mokkin / '+branch+'</div><div class="github-browser-empty"></div>';view.lastChild.textContent=message}
  function openFile(file,button){
    [].forEach.call(tree.querySelectorAll('.is-active'),function(el){el.classList.remove('is-active')});button.classList.add('is-active');
    view.innerHTML='<div class="github-browser-path"></div><div class="github-browser-empty">Loading file…</div>';view.firstChild.textContent=file.path;
    if(Number(file.size||0)>1500000){view.lastChild.textContent='This file is too large for the inline viewer. Use Open GitHub to inspect it.';return}
    var ext=(file.path.split('.').pop()||'').toLowerCase();
    if(/^(png|jpg|jpeg|gif|webp|svg|ico)$/.test(ext)){var img=document.createElement('img');img.className='github-browser-image';img.alt=file.path;img.src=raw(escapePath(file.path));view.lastChild.replaceWith(img);return}
    fetch(raw(escapePath(file.path))).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(text){var pre=document.createElement('pre');pre.className='github-browser-content';pre.textContent=text;view.lastChild.replaceWith(pre)}).catch(function(){view.lastChild.textContent='This file could not be loaded. Try Open GitHub.'})
  }
  function loadTree(){if(loaded)return;loaded=true;fetch(api('/git/trees/'+encodeURIComponent(branch)+'?recursive=1'),{headers:{Accept:'application/vnd.github+json'}}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){files=(data.tree||[]).filter(function(item){return item.type==='blob'}).sort(function(a,b){return a.path.localeCompare(b.path)});renderTree()}).catch(function(){loaded=false;meta.textContent='Repository unavailable';setMessage('GitHub could not return the repository right now. Try again shortly or use Open GitHub.')})}
  function openModal(event){event.preventDefault();lastFocus=event.currentTarget;modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');document.documentElement.classList.add('github-browser-lock');loadTree();setTimeout(function(){search.focus()},30)}
  function closeModal(){modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true');document.documentElement.classList.remove('github-browser-lock');if(lastFocus)lastFocus.focus()}
  triggers.forEach(function(trigger){trigger.addEventListener('click',openModal)});closeButton.addEventListener('click',closeModal);search.addEventListener('input',renderTree);modal.addEventListener('click',function(e){if(e.target===modal)closeModal()});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('is-open'))closeModal()});
})();