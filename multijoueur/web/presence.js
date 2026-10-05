/* Pendant les révisions : mjLive({corner, sound, live: [{pseudo, avatar}],
 *   messages: [{pseudo, avatar, text, verb, click}], pomo: {id, start, work, rest, rounds} | null})
 * À gauche par défaut (les casinos sont à droite). Une bulle cliquable ouvre la fenêtre 👥
 * (pycmd « mjlive:… »). Le minuteur du pomodoro avance seul, chaque seconde. */
(function(){
  if(window.mjLive)return;
  var pomo=null,sound=true,lastPhase=null,timer=null;
  function esc(s){var e=document.createElement('span');e.textContent=s==null?'':String(s);return e.innerHTML;}
  function root(){
    var r=document.getElementById('mj-live');
    if(!r){r=document.createElement('div');r.id='mj-live';r.className='mj-haut-gauche';
      r.innerHTML='<div class="mj-pill"></div><div class="mj-pomo"></div><div class="mj-msgs"></div>';document.body.appendChild(r);}
    return r;
  }
  function send(cmd){try{if(window.pycmd)pycmd(cmd);}catch(e){}}
  function bubble(m){
    var box=root().querySelector('.mj-msgs'),b=document.createElement('div');b.className='mj-msg'+(m.click?' mj-click':'');
    b.innerHTML='<span class="mj-av">'+esc(m.avatar)+'</span><span><b>'+esc(m.pseudo)+'</b>'+(m.verb?' ':' · ')+esc(m.text)+'</span>';
    if(m.click)b.onclick=function(){send('mjlive:'+m.click);b.classList.add('out');};
    box.appendChild(b);
    while(box.children.length>3)box.removeChild(box.firstChild);
    requestAnimationFrame(function(){requestAnimationFrame(function(){b.classList.add('on');});});
    var stay=m.click&&m.click.indexOf('pomo')===0?15000:8000;
    setTimeout(function(){b.classList.remove('on');b.classList.add('out');setTimeout(function(){if(b.parentNode)b.parentNode.removeChild(b);},600);},stay);
  }
  function beep(){
    if(!sound)return;
    try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,.25].forEach(function(t){var o=c.createOscillator(),g=c.createGain();
      o.frequency.value=880;g.gain.value=.06;o.connect(g);g.connect(c.destination);o.start(c.currentTime+t);o.stop(c.currentTime+t+.15);});}catch(e){}
  }
  function phase(p){
    var el=(Date.now()-new Date(p.start).getTime())/1000,cy=(p.work+p.rest)*60;
    if(el<0)return{ph:'work',r:1,left:-el};
    if(el>=cy*p.rounds)return{ph:'over',r:p.rounds,left:0};
    var n=Math.floor(el/cy),into=el-n*cy;
    return into<p.work*60?{ph:'work',r:n+1,left:p.work*60-into}:{ph:'rest',r:n+1,left:cy-into};
  }
  function tick(){
    var box=root().querySelector('.mj-pomo');
    if(!pomo){box.classList.remove('on');lastPhase=null;return;}
    var f=phase(pomo);
    if(f.ph==='over'){box.classList.remove('on');pomo=null;beep();return;}
    var key=f.ph+f.r;
    if(lastPhase&&key!==lastPhase)beep();
    lastPhase=key;
    var m=Math.floor(f.left/60),s=Math.floor(f.left%60);
    box.className='mj-pomo on '+f.ph;
    box.innerHTML='<span>'+(f.ph==='work'?'🍅':'☕')+'</span><b>'+m+':'+(s<10?'0':'')+s+'</b><span class="mj-lab2">'+
      (f.ph==='work'?'travail':'pause')+' · '+f.r+'/'+pomo.rounds+'</span>';
  }
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
    if(!timer)timer=setInterval(tick,1000);
    tick();
    (d.messages||[]).forEach(function(m,i){setTimeout(function(){bubble(m);},i*900);});
  };
})();
