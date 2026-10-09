/* Pendant les révisions : mjLive({corner, sound, live: [{pseudo, avatar}],
 *   messages: [{pseudo, avatar, text, verb, click}], pomo: {id, start, work, rest, rounds} | null,
 *   race: {me: {pct, left, avatar}, others: [{pseudo, avatar, pct, left}]} | null})
 * À gauche par défaut (les casinos sont à droite). Une bulle cliquable ouvre la fenêtre 👥
 * (pycmd « mjlive:… »). Le minuteur du pomodoro avance seul, chaque seconde : un anneau se referme
 * autour de 🍅 ; un clic le réduit à l'anneau seul. La course : une fine ligne, chacun à son % du
 * paquet qu'il fait en ce moment ; un mot discret seulement quand quelqu'un passe devant ou finit son paquet.
 * mjEta({eta: {secs, new, rev, learn, answers, per_new, speed, deck} | null, corner}) : « 🏁 14 h 35 », l'heure
 * où le paquet en cours sera fini ; lissée pour ne pas sauter à chaque carte (détails au survol). */
(function(){
  if(window.mjLive)return;
  // writing an answer (any text box of the review screen): the dot's halo stops, so it never slows the typing
  function typing(e){var t=e.target;return t&&(t.isContentEditable||t.tagName==='TEXTAREA'||t.tagName==='INPUT');}
  document.addEventListener('focusin',function(e){if(typing(e))document.documentElement.classList.add('mj-typing');});
  document.addEventListener('focusout',function(e){if(typing(e))document.documentElement.classList.remove('mj-typing');});
  var pomo=null,sound=true,lastPhase=null,timer=null,leader=null,finished={},noteTimer=null;
  var RING=81.68;   // 2·π·13: the circle around 🍅
  function esc(s){var e=document.createElement('span');e.textContent=s==null?'':String(s);return e.innerHTML;}
  function root(){
    var r=document.getElementById('mj-live');
    if(!r){r=document.createElement('div');r.id='mj-live';r.className='mj-haut-gauche';
      r.innerHTML='<div class="mj-pill"></div><div class="mj-race"><div class="mj-track"></div><div class="mj-note"></div></div>'+
        '<div class="mj-eta"><span>🏁</span><b class="mj-at"></b><span class="mj-lab3">fin du paquet</span></div>'+
        '<div class="mj-pomo"><span class="mj-ring"><svg viewBox="0 0 32 32" aria-hidden="true"><circle class="mj-t" cx="16" cy="16" r="13"/>'+
        '<circle class="mj-arc" cx="16" cy="16" r="13" stroke-dasharray="'+RING+'" stroke-dashoffset="'+RING+'"/></svg><span class="mj-ico">🍅</span></span>'+
        '<b class="mj-time"></b><span class="mj-lab2"></span></div><div class="mj-msgs"></div>';document.body.appendChild(r);
      r.querySelector('.mj-pomo').onclick=function(){mini(!mini());tick();};}
    return r;
  }
  function mini(v){try{if(v===undefined)return localStorage.getItem('mj-pomo-mini')==='1';localStorage.setItem('mj-pomo-mini',v?'1':'0');}catch(e){}return false;}
  function send(cmd){try{if(window.pycmd)pycmd(cmd);}catch(e){}}
  function bubble(m){
    var box=root().querySelector('.mj-msgs'),b=document.createElement('div');b.className='mj-msg'+(m.click?' mj-click':'');
    b.innerHTML='<span class="mj-av">'+esc(m.avatar)+'</span><span class="mj-txt"><b>'+esc(m.pseudo)+'</b>'+(m.verb?' ':' · ')+esc(m.text)+'</span>';
    if(m.click)b.onclick=function(){send('mjlive:'+m.click);b.classList.add('out');};
    box.appendChild(b);
    while(box.children.length>3)box.removeChild(box.firstChild);
    requestAnimationFrame(function(){requestAnimationFrame(function(){b.classList.add('on');});});
    var stay=m.click&&m.click.indexOf('pomo')===0?15000:Math.min(16000,6000+String(m.text||'').length*60);   // long messages stay longer
    setTimeout(function(){b.classList.remove('on');b.classList.add('out');setTimeout(function(){if(b.parentNode)b.parentNode.removeChild(b);},600);},stay);
  }
  function beep(){
    if(!sound)return;
    try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,.25].forEach(function(t){var o=c.createOscillator(),g=c.createGain();
      o.frequency.value=880;g.gain.value=.06;o.connect(g);g.connect(c.destination);o.start(c.currentTime+t);o.stop(c.currentTime+t+.15);});}catch(e){}
  }
  function phase(p){
    var el=(Date.now()-new Date(p.start).getTime())/1000,cy=(p.work+p.rest)*60;
    if(el<0)return{ph:'work',r:1,left:-el,len:p.work*60};
    if(el>=cy*p.rounds)return{ph:'over',r:p.rounds,left:0,len:1};
    var n=Math.floor(el/cy),into=el-n*cy;
    return into<p.work*60?{ph:'work',r:n+1,left:p.work*60-into,len:p.work*60}:{ph:'rest',r:n+1,left:cy-into,len:p.rest*60};
  }
  function tick(){
    var box=root().querySelector('.mj-pomo');
    if(!pomo){box.classList.remove('on');lastPhase=null;return;}
    var f=phase(pomo);
    if(f.ph==='over'){box.classList.remove('on');pomo=null;beep();return;}
    var key=f.ph+f.r;
    var changed=lastPhase&&key!==lastPhase;
    if(changed)beep();
    var arc=box.querySelector('.mj-arc'),small=mini();
    // a new phase: the ring starts again from empty at once (no backwards animation)
    if(key!==lastPhase){arc.style.transition='none';arc.getBoundingClientRect();}
    else arc.style.transition='';
    lastPhase=key;
    var m=Math.floor(f.left/60),s=Math.floor(f.left%60),done=Math.max(0,Math.min(1,1-f.left/f.len));
    arc.setAttribute('stroke-dashoffset',(RING*(1-done)).toFixed(2));
    box.className='mj-pomo on '+f.ph+(small?' mj-mini':'')+(changed||box.classList.contains('mj-ping')?' mj-ping':'')+(f.left<=60?' mj-last':'');
    box.title=(f.ph==='work'?'Travail':'Pause')+' · '+(m?m+' min ':'')+s+' s restantes · tour '+f.r+'/'+pomo.rounds+' · clique pour '+(small?'agrandir':'réduire');
    box.querySelector('.mj-ico').textContent=f.ph==='work'?'🍅':'☕';
    box.querySelector('.mj-time').textContent=m+':'+(s<10?'0':'')+s;
    box.querySelector('.mj-lab2').textContent=(f.ph==='work'?'travail':'pause')+' · '+f.r+'/'+pomo.rounds;
    if(changed)setTimeout(function(){box.classList.remove('mj-ping');},3600);
  }
  // the live race: a thin line, each one at their % of the deck they're doing now
  function note(text){
    var n=root().querySelector('.mj-note');
    n.textContent=text;n.classList.add('on');
    clearTimeout(noteTimer);noteTimer=setTimeout(function(){n.classList.remove('on');},5000);
  }
  function race(d){
    var el=root().querySelector('.mj-race');
    if(!d||!d.me||!d.others||!d.others.length){el.classList.remove('on');leader=null;return;}
    var all=[{k:'me',pseudo:'Toi',avatar:d.me.avatar,pct:d.me.pct,left:d.me.left}].concat(d.others.map(function(o){
      return{k:'o:'+o.pseudo,pseudo:o.pseudo,avatar:o.avatar,pct:o.pct,left:o.left};}));
    function left(p){return p.left===0?'paquet fini':p.left+(p.left>1?' cartes restantes':' carte restante');}
    var track=el.querySelector('.mj-track');
    all.forEach(function(p){
      var dot=track.querySelector('[data-k="'+p.k.replace(/"/g,'')+'"]');
      if(!dot){dot=document.createElement('span');dot.className='mj-runner'+(p.k==='me'?' mj-me':'');dot.setAttribute('data-k',p.k.replace(/"/g,''));
        dot.innerHTML='<span class="mj-av"></span><span class="mj-pc"></span>';track.appendChild(dot);}
      dot.querySelector('.mj-av').textContent=p.avatar;
      dot.querySelector('.mj-pc').textContent=p.pct+' %';
      dot.style.left=Math.min(100,p.pct)+'%';
      dot.title=p.pseudo+' : '+p.pct+' % '+(p.k==='me'?'de ton':'de son')+' paquet · '+left(p);
    });
    Array.prototype.slice.call(track.querySelectorAll('.mj-runner')).forEach(function(x){
      if(!all.some(function(p){return p.k.replace(/"/g,'')===x.getAttribute('data-k');}))track.removeChild(x);});
    el.title=all.map(function(p){return p.pseudo+' '+p.pct+' % ('+left(p)+')';}).join(' · ')+' — le paquet que chacun fait en ce moment';
    el.classList.add('on');
    var best=all.slice().sort(function(a,b){return b.pct-a.pct;})[0];
    var lead=best.pct===d.me.pct?'me':best.k;
    var first=leader===null;   // just arrived in the reviews: nothing to announce yet
    if(!first&&lead!==leader&&best.pct>0)note(lead==='me'?'👑 Tu passes devant !':'⚡ '+best.pseudo+' passe devant');
    all.forEach(function(p){   // someone just finished their deck: one word, once
      var over=p.left===0;
      if(!first&&over&&!finished[p.k])note(p.k==='me'?'🏁 Paquet fini !':'🏁 '+p.pseudo+' a fini son paquet');
      finished[p.k]=over;
    });
    leader=lead;
  }
  // when will the deck be finished: smoothed, rounded, and only redrawn when it really moved
  var eta={deck:null,smooth:null,shown:null};
  function clock(ms){var t=new Date(ms),m=t.getMinutes();return t.getHours()+' h '+(m<10?'0':'')+m;}
  function dur(s){var m=Math.round(s/60);return m<60?m+' min':Math.floor(m/60)+' h '+(m%60<10?'0':'')+(m%60);}
  function plural(n,one,many){return n+' '+(n>1?many:one);}
  window.mjEta=function(d){
    var r=root(),box=r.querySelector('.mj-eta'),e=d&&d.eta;
    if(d&&d.corner)r.className='mj-'+d.corner;
    if(!e){box.classList.remove('on');eta.deck=null;return;}
    var now=Date.now(),at=box.querySelector('.mj-at');
    if(e.answers<=0||e.secs<=0){at.textContent='paquet fini';box.title='Plus rien à faire aujourd\'hui dans ce paquet 🎉';
      box.classList.add('on');eta.deck=null;return;}
    var target=now+e.secs*1000;
    if(eta.deck!==e.deck||eta.smooth===null){eta.deck=e.deck;eta.smooth=target;eta.shown=null;}
    else eta.smooth+=0.3*(target-eta.smooth);   // one fast or slow card only moves it a little
    eta.smooth=Math.max(eta.smooth,now);
    var left=(eta.smooth-now)/1000,step=(left>2700?5:1)*60000;
    if(eta.shown===null||Math.abs(eta.smooth-eta.shown)>0.75*step)eta.shown=Math.round(eta.smooth/step)*step;
    at.textContent=left<60?'presque fini':(left>2700?'vers ':'')+clock(eta.shown);
    var parts=[];
    if(e.rev)parts.push(plural(e.rev,'révision','révisions'));
    if(e.new)parts.push(plural(e.new,'nouvelle','nouvelles')+' (~'+String(e.per_new).replace('.',',')+' passages chacune)');
    if(e.learn)parts.push(plural(e.learn,'carte','cartes')+' en apprentissage');
    box.title='Fin du paquet vers '+clock(eta.smooth)+' · encore ~'+dur(left)+'\n'+parts.join(', ')+
      ' ≈ '+e.answers+' réponses à ~'+String(e.speed).replace('.',',')+' s chacune (ta vitesse en ce moment)';
    box.classList.add('on');
  };
  window.mjLive=function(d){
    var r=root(),live=d.live||[],p=r.querySelector('.mj-pill');
    r.className='mj-'+(d.corner||'haut-gauche');
    sound=d.sound!==false;
    if(live.length){
      p.innerHTML=live.map(function(m){return '<span class="mj-who"><span class="mj-av">'+esc(m.avatar)+'</span><i class="mj-dot"></i></span>';}).join('')+
        '<span class="mj-lab">'+esc(live.length===1?live[0].pseudo+' révise':live.map(function(m){return m.pseudo;}).join(', ')+' révisent')+'</span>';
      p.classList.add('on');
    } else p.classList.remove('on');
    if(d.pomo===null||d.pomo===undefined){pomo=null;}
    else if(!pomo||pomo.id!==d.pomo.id){pomo=d.pomo;lastPhase=null;}
    race(d.race);
    if(!timer)timer=setInterval(tick,1000);
    tick();
    (d.messages||[]).forEach(function(m,i){setTimeout(function(){bubble(m);},i*900);});
  };
})();
