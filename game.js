'use strict';
// Native NES resolution: all game graphics use integer pixels on a 256 x 240 canvas.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
ctx.imageSmoothingEnabled = false;
const FIELD = 208, CELL = 4, DIR = [[0,-1],[1,0],[0,1],[-1,0]];
const input = new Map(), touchPointers = new Map();
const scene = {mode:'title',previous:'playing',time:0,menu:0,stage:1,twoPlayers:false,editorTile:1,custom:null};
const world = {map:[],players:[],enemies:[],bullets:[],effects:[],spawn:[],bonus:null,base:true,remaining:20,spawnClock:0,spawnIndex:0,freeze:0,fort:0,kills:[0,0,0,0]};
let sound = true, audio, lastTime = 0, accumulator = 0, frame = 0, nextId = 1, editorDragging = false;
let highScore = 20000;
try { highScore = Math.max(20000, Number(localStorage.getItem('battle-city-high')) || 0); } catch {}
const action = document.getElementById('canvas-action');
const $ = id => document.getElementById(id);
function announce(message) { $('status').textContent = message; }
function mode(name) {
  scene.mode=name;scene.time=0;
  action.hidden=!['title','paused','gameover','score'].includes(name);
  action.setAttribute('aria-label',name==='paused'?'Продолжить игру':name==='score'?'Следующий этап':'Начать игру');
  $('pause').textContent=name==='paused'?'RESUME':'PAUSE';
}
function tone(freq=220,duration=.08,type='square',volume=.035) {
  if(!sound)return;
  try {
    audio??=new(window.AudioContext||window.webkitAudioContext)();
    if(audio.state==='suspended')audio.resume();
    const o=audio.createOscillator(),gain=audio.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.6),audio.currentTime+duration);
    gain.gain.setValueAtTime(volume,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    o.connect(gain);gain.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);
  } catch {}
}
function melody() { [262,330,392,523,392,523].forEach((f,i)=>setTimeout(()=>{if(scene.mode==='stage'||scene.mode==='playing')tone(f,.12);},i*130)); }
function expandMap(halfMap) {
  return Array.from({length:52},(_,y)=>Array.from({length:52},(_,x)=>halfMap[Math.floor(y/2)][Math.floor(x/2)]));
}
function baseWalls(tile=1) {
  for(let y=46;y<52;y++)for(let x=22;x<30;x++)if(y<48||x<24||x>=28)world.map[y][x]=tile;
}
function makePlayer(index) { return {id:nextId++,index,enemy:false,x:index?128:64,y:192,d:0,active:true,lives:3,score:0,stars:0,shield:3,cd:0,anim:0,slide:0,spawn:0}; }
function loadStage() {
  const levels=window.BATTLE_LEVELS;
  world.map=expandMap(scene.custom||levels[(scene.stage-1)%levels.length]);baseWalls();
  Object.assign(world,{enemies:[],bullets:[],effects:[],spawn:[],bonus:null,base:true,remaining:20,spawnClock:.6,spawnIndex:0,freeze:0,fort:0,kills:[0,0,0,0]});
  for(const p of world.players){p.x=p.index?128:64;p.y=192;p.d=0;p.active=p.lives>0;p.shield=3;p.cd=0;p.spawn=.7;p.stars=0;}
  mode('stage');announce('Этап '+scene.stage);melody();
}
function newGame(two=false) {
  clearInput();scene.twoPlayers=two;scene.stage=1;
  world.players=[makePlayer(0)];if(two)world.players.push(makePlayer(1));
  loadStage();
}
function start() {
  tone(260,.04);
  if(scene.mode==='title'){
    if(scene.menu===2){scene.custom=window.BATTLE_LEVELS[0].map(row=>row.map(()=>0));world.map=expandMap(scene.custom);baseWalls();world.enemies=[];world.bullets=[];world.players=[];mode('construction');announce('Редактор. Нажимайте на поле. B меняет блок. START — играть.');}
    else {scene.custom=null;newGame(scene.menu===1);}
  } else if(scene.mode==='paused')pause();
  else if(scene.mode==='score'){scene.stage++;loadStage();}
  else if(scene.mode==='gameover'){scene.custom=null;mode('title');}
  else if(scene.mode==='construction'){scene.custom=Array.from({length:26},(_,y)=>Array.from({length:26},(_,x)=>world.map[y*2][x*2]));newGame(false);}
}
function pause() {
  if(scene.mode==='playing'||scene.mode==='stage'){scene.previous=scene.mode;mode('paused');clearInput();announce('Пауза');}
  else if(scene.mode==='paused'){mode(scene.previous);announce('Игра продолжается');}
}
function clearInput() {input.clear();touchPointers.clear();document.querySelectorAll('.active').forEach(b=>b.classList.remove('active'));}
function rects(a,b) {return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function body(t,x=t.x,y=t.y) {return {x:x+1,y:y+1,w:14,h:14};}
function blocked(t,x,y) {
  if(x<0||y<0||x>192||y>192)return true;
  const b=body(t,x,y);
  for(let yy=Math.floor(b.y/4);yy<=Math.floor((b.y+b.h-.01)/4);yy++)for(let xx=Math.floor(b.x/4);xx<=Math.floor((b.x+b.w-.01)/4);xx++){
    if([1,2,4].includes(world.map[yy]?.[xx]))return true;
  }
  if(world.base&&rects(b,{x:96,y:192,w:16,h:16}))return true;
  return [...world.players,...world.enemies].some(o=>o!==t&&o.active&&!o.dead&&!o.spawn&&rects(b,body(o)));
}
function moveTank(t,d,dt) {
  if(t.d%2!==d%2){
    let nx=t.x,ny=t.y;
    if(d%2===0)nx=Math.round(t.x/8)*8;else ny=Math.round(t.y/8)*8;
    if(!blocked(t,nx,ny)){t.x=nx;t.y=ny;}
  }
  t.d=d;
  const speed=t.enemy?(t.kind===1?60:30):(t.stars>0?75:60);
  const v=DIR[d],dist=speed*dt;
  let x=Math.max(0,Math.min(192,t.x+v[0]*dist)),y=Math.max(0,Math.min(192,t.y+v[1]*dist));
  if(!blocked(t,x,y)) {t.x=x;t.y=y;t.anim+=dt*12;return true;}
  return false;
}
function fire(t) {
  if(t.cd>0||!t.active||t.spawn)return;
  if(world.bullets.filter(b=>!b.dead&&b.owner===t.id).length>=(t.stars>=2?2:1))return;
  const v=DIR[t.d];
  world.bullets.push({x:t.x+8+v[0]*8,y:t.y+8+v[1]*8,d:t.d,owner:t.id,enemy:t.enemy,index:t.index,power:!t.enemy&&t.stars>=3,speed:!t.enemy&&t.stars>0?240:180,dead:false});
  t.cd=t.enemy?1+Math.random()*.9:.18;if(!t.enemy)tone(380,.035);
}
function effect(x,y,big=false,points=0) {world.effects.push({x,y,big,t:0,life:big?.45:.12,points});}
function explosion(x,y,big=false) {effect(x,y,big);tone(big?80:120,big?.18:.035,'triangle',big?.08:.025);}
function addScore(p,n) {
  if(!p)return;p.score+=n;
  if(p.score>=20000&&!p.extraLife){p.extraLife=true;p.lives++;tone(700,.3);}
  if(p.score>highScore){highScore=p.score;try{localStorage.setItem('battle-city-high',String(highScore));}catch{}}
}
function damagePlayer(p) {
  if(!p.active||p.shield>0||p.spawn||scene.mode!=='playing')return;
  explosion(p.x+8,p.y+8,true);p.lives=Math.max(0,p.lives-1);p.stars=0;
  world.bullets=world.bullets.filter(b=>b.owner!==p.id);
  if(p.lives>0){p.x=p.index?128:64;p.y=192;p.d=0;p.shield=3;p.spawn=.8;}
  else {p.active=false;announce('Игрок '+(p.index+1)+' потерял все жизни');}
  if(world.players.every(t=>!t.active))gameOver();
}
function gameOver() {
  if(scene.mode!=='playing')return;
  mode('dying');clearInput();announce('Игра окончена');tone(110,.5,'triangle',.08);
}
function destroyBase() {
  if(!world.base)return;world.base=false;explosion(104,200,true);gameOver();
}
function makeEnemy() {
  if(world.remaining<=0||world.enemies.filter(t=>!t.dead).length>=4)return;
  const x=[0,96,192][world.spawnIndex%3];
  if([...world.enemies,...world.players].some(t=>t.active&&!t.dead&&rects({x,y:0,w:16,h:16},body(t))))return;
  const n=20-world.remaining,kind=scene.stage===1?(n>=18?1:0):n%10===9?3:n%6===3?2:n%4===1?1:0;
  const e={id:nextId++,x,y:0,d:2,enemy:true,active:true,kind,armor:kind===3?4:1,stars:0,cd:1,turn:1,anim:0,spawn:1,bonus:[3,10,17].includes(n)};
  world.enemies.push(e);world.remaining--;world.spawnIndex++;
}
function killEnemy(e,b) {
  if(e.dead)return;
  if(e.armor>1){e.armor--;tone(170,.045);return;}
  e.dead=true;e.active=false;explosion(e.x+8,e.y+8,true);
  const n=(e.kind+1)*100;addScore(world.players[b.index],n);world.kills[e.kind]++;effect(e.x,e.y,true,n);
  if(e.bonus)world.bonus={x:16+Math.floor(Math.random()*20)*8,y:16+Math.floor(Math.random()*18)*8,type:Math.floor(Math.random()*6),t:0,life:14};
}
function collectBonus(p) {
  const b=world.bonus;if(!b)return;
  if(!rects(body(p),{x:b.x,y:b.y,w:16,h:16}))return;
  addScore(p,500);tone(900,.15);effect(b.x,b.y,true,500);
  if(b.type===0)p.shield=10;
  if(b.type===1){world.fort=20;baseWalls(2);}
  if(b.type===2)p.stars=Math.min(3,p.stars+1);
  if(b.type===3)p.lives++;
  if(b.type===4){for(const e of world.enemies){if(!e.dead){e.armor=1;killEnemy(e,{index:p.index});}}world.bonus=null;}
  if(b.type===5)world.freeze=10;
  world.bonus=null;
}
function brickHit(b) {
  const v=DIR[b.d],r=b.d%2?{x:b.x-1,y:b.y-3,w:2,h:6}:{x:b.x-3,y:b.y-1,w:6,h:2};
  const cells=[];
  for(let y=Math.max(0,Math.floor(r.y/4));y<=Math.min(51,Math.floor((r.y+r.h-.01)/4));y++)for(let x=Math.max(0,Math.floor(r.x/4));x<=Math.min(51,Math.floor((r.x+r.w-.01)/4));x++)if([1,2].includes(world.map[y][x]))cells.push([x,y]);
  if(!cells.length)return false;
  // A shell chips one four-pixel layer, eight pixels across.
  for(const [x,y] of cells){
    if(world.map[y][x]===1||b.power){
      const across=b.d%2===0?[Math.floor(b.x/8)*2,Math.floor(b.x/8)*2+1]:[Math.floor(b.y/8)*2,Math.floor(b.y/8)*2+1];
      for(const a of across){const xx=b.d%2===0?a:x,yy=b.d%2===0?y:a;if(world.map[yy]?.[xx]===1||b.power&&world.map[yy]?.[xx]===2)world.map[yy][xx]=0;}
    }
  }
  effect(b.x-v[0],b.y-v[1]);if(!b.enemy)tone(90,.025);return true;
}
function updateBullets(dt) {
  for(const b of world.bullets){
    if(b.dead)continue;
    const steps=Math.max(1,Math.ceil(b.speed*dt/2));
    for(let k=0;k<steps&&!b.dead;k++){
      b.x+=DIR[b.d][0]*b.speed*dt/steps;b.y+=DIR[b.d][1]*b.speed*dt/steps;
      if(b.x<0||b.y<0||b.x>=FIELD||b.y>=FIELD){b.dead=true;effect(b.x,b.y);break;}
      if(brickHit(b)){b.dead=true;break;}
      const box={x:b.x-1,y:b.y-1,w:2,h:2};
      if(world.base&&rects(box,{x:96,y:192,w:16,h:16})){b.dead=true;destroyBase();return;}
      for(const other of world.bullets){if(other!==b&&!other.dead&&other.enemy!==b.enemy&&Math.abs(other.x-b.x)<4&&Math.abs(other.y-b.y)<4){b.dead=other.dead=true;break;}}
      if(b.dead)break;
      const targets=b.enemy?world.players:world.enemies;
      for(const t of targets){
        if(t.active&&!t.dead&&!t.spawn&&rects(box,body(t))){b.dead=true;if(b.enemy)damagePlayer(t);else killEnemy(t,b);break;}
      }
      if(scene.mode!=='playing')return;
    }
  }
  world.bullets=world.bullets.filter(b=>!b.dead);
  world.enemies=world.enemies.filter(t=>!t.dead);
}
function pressed(key) {return [...input.values()].includes(key);}
function direction(p) {
  const allowed=p.index?['p2up','p2right','p2down','p2left']:['up','right','down','left'];
  const entries=[...input.values()].reverse();
  for(const v of entries){const d=allowed.indexOf(v);if(d>=0)return d;}
  return -1;
}
function update(dt) {
  scene.time+=dt;frame++;
  if(scene.mode==='stage'){if(scene.time>=1.7)mode('playing');return;}
  if(scene.mode==='dying'){if(scene.time>2)mode('gameover');return;}
  if(scene.mode!=='playing')return;
  world.freeze=Math.max(0,world.freeze-dt);
  if(world.fort>0){world.fort-=dt;if(world.fort<3)baseWalls(Math.floor(world.fort*4)%2?1:2);if(world.fort<=0)baseWalls(1);}
  world.spawnClock-=dt;if(world.spawnClock<=0){makeEnemy();world.spawnClock=1.4;}
  for(const p of world.players){
    if(!p.active)continue;p.shield=Math.max(0,p.shield-dt);p.cd=Math.max(0,p.cd-dt);p.spawn=Math.max(0,p.spawn-dt);
    if(p.spawn)continue;
    const d=direction(p);if(d>=0){moveTank(p,d,dt);p.slide=.18;}else if(p.slide>0&&world.map[Math.floor((p.y+8)/4)]?.[Math.floor((p.x+8)/4)]===5){p.slide-=dt;moveTank(p,p.d,dt);}else p.slide=0;
    if(pressed(p.index?'p2fire':'fire'))fire(p);collectBonus(p);
  }
  for(const t of world.enemies){
    t.spawn=Math.max(0,t.spawn-dt);if(t.spawn||world.freeze>0)continue;t.cd=Math.max(0,t.cd-dt);t.turn-=dt;
    if(!moveTank(t,t.d,dt)||t.turn<=0){t.d=Math.random()<.5?2:Math.floor(Math.random()*4);t.turn=.4+Math.random()*1.3;}
    fire(t);
  }
  updateBullets(dt);
  if(world.bonus){world.bonus.t+=dt;world.bonus.life-=dt;if(world.bonus.life<=0)world.bonus=null;}
  if(scene.mode==='playing'&&world.remaining===0&&world.enemies.every(t=>t.dead)){mode('score');clearInput();announce('Этап пройден. START — следующий этап.');}
}
// Bitmap lettering; no browser fonts or emoji are used inside the console image.
const FONT = {
 'A':['01110','11011','10001','10001','11111','10001','10001'],
 'B':['11110','10001','10001','11110','10001','10001','11110'],
 'C':['01111','11000','10000','10000','10000','11000','01111'],
 'D':['11110','10011','10001','10001','10001','10011','11110'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'F':['11111','10000','10000','11110','10000','10000','10000'],
 'G':['01111','11000','10000','10111','10001','11001','01111'],
 'H':['10001','10001','10001','11111','10001','10001','10001'],
 'I':['11111','00100','00100','00100','00100','00100','11111'],
 'J':['00111','00010','00010','00010','10010','11010','01100'],
 'K':['10001','10010','10100','11000','10100','10010','10001'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
 'M':['10001','11011','11111','10101','10001','10001','10001'],
 'N':['10001','11001','11001','10101','10011','10011','10001'],
 'O':['01110','11011','10001','10001','10001','11011','01110'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 'Q':['01110','10001','10001','10001','10101','10010','01101'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 'S':['01111','11000','10000','01110','00001','00011','11110'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
 'U':['10001','10001','10001','10001','10001','11011','01110'],
 'V':['10001','10001','10001','10001','10001','01010','00100'],
 'W':['10001','10001','10001','10101','11111','11011','10001'],
 'X':['10001','10001','01010','00100','01010','10001','10001'],
 'Y':['10001','10001','01010','00100','00100','00100','00100'],
 'Z':['11111','00001','00010','00100','01000','10000','11111'],
 '0':['01110','11011','11011','10101','11011','11011','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00110','01000','10000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','10001','01110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 '-':['00000','00000','00000','11111','00000','00000','00000'],
 '.':['00000','00000','00000','00000','00000','01100','01100'],
 ':':['00000','01100','01100','00000','01100','01100','00000'],
 '>':['10000','01000','00100','00010','00100','01000','10000'],
 '©':['01110','10001','10111','10101','10111','10001','01110']
};
function text(value,x,y,color='#fcfcfc',spacing=8) {
  ctx.fillStyle=color;
  [...String(value)].forEach((ch,n)=>{const glyph=FONT[ch.toUpperCase()];if(!glyph)return;for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(glyph[r][c]==='1')ctx.fillRect(x+n*spacing+c+1,y+r,1,1);});
}
function centered(value,y,color='#fcfcfc') {text(value,Math.floor((256-String(value).length*8)/2),y,color);}
const TANK_SPRITE = [
'0000000110000000','0000000110000000','0220000110002200','0212000110021200',
'0212111111121200','0222113331122200','0212133333121200','0212131133121200',
'0222131133122200','0212133333121200','0212111111121200','0222111111122200',
'0212001100021200','0212000000021200','0222000000022200','0000000000000000'];
const EAGLE = [
'1000000000000001','1100000000000011','1110000110000111','1111001111001111',
'0111101111011110','0011111111111100','0001111111111000','0011111111111100',
'0110011111100110','1000111111110001','0001111111111000','0011101111011100',
'0110001111000110','0000001111000000','0000011111100000','0000110000110000'];
const STAR=['00010000','00010000','00111000','11111110','00111000','00101000','01000100','00000000'];
function pixels(pattern,x,y,colors,scale=1) {
  for(let r=0;r<pattern.length;r++)for(let c=0;c<pattern[r].length;c++){const n=+pattern[r][c];if(n){ctx.fillStyle=colors[n-1];ctx.fillRect(x+c*scale,y+r*scale,scale,scale);}}
}
function drawBrick(x,y,w=8,h=8) {
  ctx.fillStyle='#a45018';ctx.fillRect(x,y,w,h);
  for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
    const gx=(x+xx)%8,gy=(y+yy)%8;
    if(gy===3||gy===7||gx===(gy<4?7:3)){ctx.fillStyle='#000';ctx.fillRect(x+xx,y+yy,1,1);}
    else if(gy===0||gy===4){ctx.fillStyle='#fcbcb0';ctx.fillRect(x+xx,y+yy,1,1);}
  }
}
function drawLogo() {
  for(const [word,y] of [['BATTLE',48],['CITY',88]]){
    const start=Math.floor((256-(word.length*28-4))/2);
    [...word].forEach((ch,j)=>{for(let r=0;r<7;r++)for(let col=0;col<5;col++)if(FONT[ch][r][col]==='1')drawBrick(start+j*28+col*4,y+r*4,4,4);});
  }
}
function drawTank(t,ox=16,oy=16) {
  const x=Math.round(t.x)+ox,y=Math.round(t.y)+oy;
  if(t.spawn){const phase=Math.floor(t.spawn*8)%3;ctx.strokeStyle='#fcfcfc';ctx.lineWidth=1;ctx.strokeRect(x+phase*2,y+phase*2,15-phase*4,15-phase*4);ctx.fillStyle='#fcfcfc';ctx.fillRect(x+7,y+2,2,12);ctx.fillRect(x+2,y+7,12,2);return;}
  let colors=t.enemy?['#fcfcfc','#7c7c7c','#bcbcbc']:t.index?['#80d010','#005800','#b8f818']:['#f8b800','#a85000','#fce0a8'];
  if(t.bonus&&Math.floor(frame/8)%2===0)colors=['#f83800','#a81000','#fcbcb0'];
  if(t.kind===3&&!t.bonus)colors=t.armor>2?['#b8f818','#005800','#80d010']:t.armor>1?['#f8b800','#a85000','#fce0a8']:['#fcfcfc','#7c7c7c','#bcbcbc'];
  ctx.save();ctx.translate(x+8,y+8);ctx.rotate(t.d*Math.PI/2);pixels(TANK_SPRITE,-8,-8,colors);
  // Tracks alternate one pixel at the native resolution.
  ctx.fillStyle=colors[1];for(let sy=-5+(Math.floor(t.anim||0)%2);sy<7;sy+=3){ctx.fillRect(-6,sy,2,1);ctx.fillRect(5,sy,2,1);}
  if(t.kind===1){ctx.fillStyle=colors[0];ctx.fillRect(-3,-6,6,2);}if(t.kind===3){ctx.fillStyle=colors[0];ctx.fillRect(-4,-3,8,7);ctx.fillStyle=colors[1];ctx.fillRect(-2,-1,4,3);}
  ctx.restore();
  if(t.shield>0){ctx.strokeStyle='#fcfcfc';ctx.lineWidth=1;const q=Math.floor(frame/3)%2;ctx.strokeRect(x-1-q,y-1-q,17+q*2,17+q*2);for(let d=0;d<4;d++){ctx.fillStyle='#000';ctx.fillRect(x-2+q+d*6,y-2,3,1);ctx.fillRect(x-2+q+d*6,y+18,3,1);}}
}
function drawMap(forest=false) {
  for(let y=0;y<52;y++)for(let x=0;x<52;x++){
    const tile=world.map[y]?.[x];if(!tile||(tile===3)!==forest)continue;
    const px=16+x*4,py=16+y*4;
    if(tile===1)drawBrick(px,py,4,4);
    else if(tile===2){ctx.fillStyle='#7c7c7c';ctx.fillRect(px,py,4,4);ctx.fillStyle='#fcfcfc';if(x%2===0)ctx.fillRect(px,py,1,4);if(y%2===0)ctx.fillRect(px,py,4,1);ctx.fillStyle='#bcbcbc';ctx.fillRect(px+1,py+1,2,2);}
    else if(tile===3){ctx.fillStyle='#005800';ctx.fillRect(px,py,4,4);ctx.fillStyle='#00a800';ctx.fillRect(px+(y%2),py,2,1);ctx.fillRect(px+2,py+2,2,1);ctx.fillStyle='#80d010';ctx.fillRect(px,py+3,1,1);}
    else if(tile===4){ctx.fillStyle='#0000a8';ctx.fillRect(px,py,4,4);ctx.fillStyle='#3cbcfc';ctx.fillRect(px+(Math.floor(frame/20)%2),py+1,3,1);}
    else if(tile===5){ctx.fillStyle='#bcbcbc';ctx.fillRect(px,py,4,4);ctx.fillStyle='#fcfcfc';ctx.fillRect(px,py+2,3,1);}
  }
}
function drawSidebar() {
  for(let i=0;i<world.remaining;i++){
    const x=232+i%2*8,y=24+Math.floor(i/2)*8;
    pixels(['01100110','11111111','10111101','11111111','11111111','10111101','11000011','00000000'],x,y,['#000']);
  }
  text('I P',232,128,'#000');drawMiniTank(232,136);text(world.players[0]?.lives??3,240,136,'#000');
  if(scene.twoPlayers){text('II P',224,152,'#000');drawMiniTank(232,160);text(world.players[1]?.lives??3,240,160,'#000');}
  ctx.fillStyle='#000';ctx.fillRect(234,184,1,16);ctx.fillStyle='#a45018';ctx.fillRect(235,184,12,8);ctx.fillStyle='#000';ctx.fillRect(245,184,2,2);ctx.fillRect(245,190,2,2);
  text(String(scene.stage).padStart(2,' '),232,204,'#000');
}
function drawMiniTank(x,y) {pixels(['00111000','10111010','11111110','10111010','11111110','10000010','10000010','00000000'],x,y,['#000']);}
function drawBonus() {
  const b=world.bonus;if(!b||Math.floor(b.t*4)%2)return;
  const x=b.x+16,y=b.y+16;ctx.fillStyle='#000';ctx.fillRect(x,y,16,16);ctx.strokeStyle='#fcfcfc';ctx.lineWidth=1;ctx.strokeRect(x,y,15,15);
  if(b.type===2)pixels(STAR,x+4,y+4,['#fcfcfc']);else text(['H','S','*','T','G','C'][b.type],x+4,y+4);
}
function drawEffects() {
  for(const e of world.effects){const x=Math.round(e.x)+16,y=Math.round(e.y)+16;
    if(e.points&&e.t>.25){text(e.points,x-8,y-3);continue;}
    const r=e.big?(e.t<.1?6:e.t<.25?12:8):3;
    ctx.fillStyle='#f83800';ctx.fillRect(x-r,y-r,r*2,r*2);ctx.fillRect(x-r-2,y-3,r*2+4,6);ctx.fillRect(x-3,y-r-2,6,r*2+4);
    ctx.fillStyle='#f8b800';ctx.fillRect(x-r+2,y-r+2,Math.max(2,r*2-4),Math.max(2,r*2-4));ctx.fillStyle='#fcfcfc';ctx.fillRect(x-2,y-2,4,4);
  }
}
function drawField() {
  ctx.fillStyle='#747474';ctx.fillRect(0,0,256,240);ctx.fillStyle='#000';ctx.fillRect(16,16,208,208);
  drawMap();
  if(world.base)pixels(EAGLE,112,208,['#bcbcbc']);else {ctx.fillStyle='#7c7c7c';pixels(['00010000','00111000','01111100','11111110','11111110','00000000','00000000','00000000'],112,216,['#7c7c7c'],2);}
  world.players.filter(p=>p.active).forEach(p=>drawTank(p));world.enemies.filter(e=>!e.dead).forEach(e=>drawTank(e));
  for(const b of world.bullets){if(!b.dead){ctx.fillStyle='#fcfcfc';ctx.fillRect(Math.round(b.x)+15,Math.round(b.y)+15,b.d%2?3:2,b.d%2?2:3);}}
  drawBonus();drawMap(true);drawEffects();drawSidebar();
}
function drawTitle() {
  ctx.fillStyle='#000';ctx.fillRect(0,0,256,240);
  text('I-     00',16,16);text('HI- '+highScore,128,16);drawLogo();
  text('1 PLAYER',88,144);text('2 PLAYERS',88,160);text('CONSTRUCTION',88,176);
  drawTank({x:56,y:140+scene.menu*16,d:1,index:0,anim:Math.floor(frame/8)},0,0);
  centered('© 1985 NAMCO',208,'#a45018');centered('ALL RIGHTS RESERVED',224,'#a45018');
}
function draw() {
  ctx.imageSmoothingEnabled=false;
  if(scene.mode==='title'){drawTitle();return;}
  if(scene.mode==='stage'){ctx.fillStyle='#747474';ctx.fillRect(0,0,256,240);centered('STAGE '+scene.stage,116,'#000');return;}
  if(scene.mode==='gameover'){ctx.fillStyle='#000';ctx.fillRect(0,0,256,240);centered('GAME OVER',104,'#d82800');centered('PUSH START',144);return;}
  if(scene.mode==='score'){
    ctx.fillStyle='#000';ctx.fillRect(0,0,256,240);centered('HI-SCORE '+highScore,16,'#f83800');centered('STAGE '+scene.stage,40);
    text('I-PLAYER',32,64,'#f83800');text(world.players[0].score,48,80,'#f8b800');
    world.kills.forEach((n,i)=>{text(String(n*(i+1)*100).padStart(4,' ')+' PTS',40,104+i*24);drawTank({x:132,y:100+i*24,d:0,enemy:true,kind:i,armor:1,anim:0},0,0);text(String(n).padStart(2,' '),160,104+i*24);});
    centered('START - NEXT STAGE',216);return;
  }
  drawField();
  if(scene.mode==='paused'){ctx.fillStyle='#000';ctx.fillRect(80,108,96,24);centered('PAUSE',116,Math.floor(frame/24)%2?'#f83800':'#fcfcfc');}
  if(scene.mode==='dying'){
    const y=Math.max(104,224-Math.floor(scene.time*72));ctx.fillStyle='#000';ctx.fillRect(96,y-2,64,20);text('GAME',112,y,'#f83800');text('OVER',112,y+8,'#f83800');
  }
  if(scene.mode==='construction'){
    ctx.fillStyle='#747474';ctx.fillRect(224,16,32,208);text('EDIT',224,24,'#000');text('B',232,48,'#000');text(scene.editorTile,232,64,'#000');text('START',216,192,'#000');
  }
}
function tick(time) {
  const delta=Math.min((time-lastTime)/1000||0,.1);lastTime=time;accumulator+=delta;
  while(accumulator>=1/60){update(1/60);if(scene.mode!=='paused'){for(const e of world.effects)e.t+=1/60;world.effects=world.effects.filter(e=>e.t<e.life);}accumulator-=1/60;}
  draw();requestAnimationFrame(tick);
}
function keyAction(code) {
  const player1={KeyW:'up',KeyD:'right',KeyS:'down',KeyA:'left',Space:'fire'};
  const arrows={ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left'};
  if(player1[code])return player1[code];
  if(arrows[code])return scene.twoPlayers?'p2'+arrows[code]:arrows[code];
  if(code==='Enter'&&scene.twoPlayers&&scene.mode==='playing')return 'p2fire';
  return null;
}
function menuMove(delta) {scene.menu=(scene.menu+delta+3)%3;tone(180,.03);}
window.addEventListener('keydown',e=>{
  const used=['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','KeyP','Escape','KeyB'];
  if(!used.includes(e.code))return;e.preventDefault();
  if(scene.mode==='title'){
    if(!e.repeat&&(e.code==='ArrowUp'||e.code==='KeyW'))menuMove(-1);
    if(!e.repeat&&(e.code==='ArrowDown'||e.code==='KeyS'))menuMove(1);
    if(!e.repeat&&(e.code==='Enter'||e.code==='Space'))start();return;
  }
  if(!e.repeat&&['KeyP','Escape'].includes(e.code)){if(scene.mode==='construction'){mode('title');}else pause();return;}
  if(scene.mode==='construction'&&e.code==='KeyB'&&!e.repeat){scene.editorTile=(scene.editorTile+1)%6;draw();return;}
  const k=keyAction(e.code);if(k&&scene.mode==='playing'){input.set(e.code,k);return;}
  if(!e.repeat&&e.code==='Enter'&&scene.mode!=='playing')start();
});
window.addEventListener('keyup',e=>input.delete(e.code));
window.addEventListener('blur',()=>{clearInput();if(scene.mode==='playing'||scene.mode==='stage')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(scene.mode==='playing'||scene.mode==='stage')pause();}});
for(const b of document.querySelectorAll('[data-key]')){
  b.addEventListener('pointerdown',e=>{
    e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch{}
    const key=b.dataset.key;
    if(scene.mode==='title'){if(key==='up')menuMove(-1);else if(key==='down')menuMove(1);else if(key==='fire')start();return;}
    if(scene.mode==='construction'&&key==='fire'){scene.editorTile=(scene.editorTile+1)%6;return;}
    touchPointers.set(e.pointerId,b);input.set('touch'+e.pointerId,key);b.classList.add('active');
  });
  const release=e=>{input.delete('touch'+e.pointerId);touchPointers.delete(e.pointerId);if(![...touchPointers.values()].includes(b))b.classList.remove('active');};
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,release);
}
function edit(e) {
  if(scene.mode!=='construction')return;
  const r=canvas.getBoundingClientRect(),x=Math.floor(((e.clientX-r.left)/r.width*256-16)/16)*4,y=Math.floor(((e.clientY-r.top)/r.height*240-16)/16)*4;
  if(x<0||y<0||x>48||y>44)return;
  for(let yy=y;yy<y+4;yy++)for(let xx=x;xx<x+4;xx++)world.map[yy][xx]=scene.editorTile;
}
canvas.addEventListener('pointerdown',e=>{if(scene.mode==='construction'){e.preventDefault();editorDragging=true;canvas.setPointerCapture(e.pointerId);edit(e);}else if(scene.mode==='title'){
  const r=canvas.getBoundingClientRect(),y=(e.clientY-r.top)/r.height*240;
  if(y>=136&&y<192){scene.menu=Math.min(2,Math.floor((y-136)/16));start();}
}});
canvas.addEventListener('pointermove',e=>{if(editorDragging)edit(e);});
for(const ev of ['pointerup','pointercancel'])canvas.addEventListener(ev,()=>editorDragging=false);
action.addEventListener('click',e=>{
  if(scene.mode==='title'&&e.detail){const r=canvas.getBoundingClientRect(),y=(e.clientY-r.top)/r.height*240;if(y>=136&&y<192)scene.menu=Math.min(2,Math.floor((y-136)/16));}
  start();
});
$('start').addEventListener('click',()=>{start();$('start').blur();});
$('pause').addEventListener('click',()=>{pause();$('pause').blur();});
$('sound').addEventListener('click',()=>{sound=!sound;$('sound').textContent=sound?'SOUND ON':'SOUND OFF';$('sound').setAttribute('aria-pressed',String(sound));if(sound)tone(440,.08);$('sound').blur();});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();}catch{} });
requestAnimationFrame(tick);
