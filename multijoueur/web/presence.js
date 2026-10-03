/* Pendant les révisions : mjLive({corner, live: [{pseudo, avatar}], messages: [{pseudo, avatar, text, verb}]}) */
(function(){
  if(window.mjLive)return;
  function esc(s){var e=document.createElement('span');e.textContent=s==null?'':String(s);return e.innerHTML;}
  function root(){
    var r=document.getElementById('mj-live');
    if(!r){r=document.createElement('div');r.id='mj-live';r.innerHTML='<div class="mj-pill"></div><div class="mj-msgs"></div>';document.body.appendChild(r);}
    return r;
  }
  function bubble(m){
    var box=root().querySelector('.mj-msgs'),b=document.createElement('div');b.className='mj-msg';
    b.innerHTML='<span class="mj-av">'+esc(m.avatar)+'</span><span><b>'+esc(m.pseudo)+'</b>'+(m.verb?' ':' · ')+esc(m.text)+'</span>';
    box.appendChild(b);
    while(box.children.length>3)box.removeChild(box.firstChild);
    requestAnimationFrame(function(){requestAnimationFrame(function(){b.classList.add('on');});});
    setTimeout(function(){b.classList.remove('on');b.classList.add('out');setTimeout(function(){if(b.parentNode)b.parentNode.removeChild(b);},600);},7000);
  }
  window.mjLive=function(d){
    var r=root(),live=d.live||[],p=r.querySelector('.mj-pill');
    r.className='mj-'+(d.corner||'haut-droite');
    if(live.length){
      p.innerHTML=live.map(function(m){return '<span class="mj-who"><span class="mj-av">'+esc(m.avatar)+'</span><i class="mj-dot"></i></span>';}).join('')+
        '<span class="mj-lab">'+esc(live.length===1?live[0].pseudo+' révise':live.map(function(m){return m.pseudo;}).join(', ')+' révisent')+'</span>';
      p.classList.add('on');
    } else p.classList.remove('on');
    (d.messages||[]).forEach(function(m,i){setTimeout(function(){bubble(m);},i*900);});
  };
})();
