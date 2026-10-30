'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const engineSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
let passed = 0, failed = 0, skipped = 0;
function context() {
  const elements = new Map();
  const drawing = new Proxy({}, {get(target,key) {return target[key] ?? (()=>{});}});
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden:false, textContent:'', innerHTML:'', dataset:{}, style:{},
      classList:{add(){},remove(){},contains(){return false;}},
      setAttribute(){}, addEventListener(){}, removeEventListener(){}, querySelectorAll:()=>[],
      getContext:()=>drawing, getBoundingClientRect:()=>({left:0,top:0,width:256,height:240}),
      focus(){}, setPointerCapture(){}, releasePointerCapture(){}, contains(){return false;}
    });
    return elements.get(id);
  }
  const sandbox = {
    console, assert,
    document:{getElementById:element,querySelector:()=>element('game'),querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(){},devicePixelRatio:1},
    localStorage:{getItem:()=>null,setItem(){}},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    setTimeout:()=>0,clearTimeout(){},performance:{now:()=>0},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(root+'/levels.js','utf8'),sandbox);
  vm.runInContext(engineSource,sandbox);
  vm.runInContext(`
    sound=false;
    function resetBattle(){
      scene.mode='playing';scene.stage=1;scene.time=0;scene.twoPlayers=false;input.clear();
      world.map=Array.from({length:52},()=>Array(52).fill(0));
      world.players=[makePlayer(0)];world.players[0].shield=0;world.players[0].spawn=0;
      Object.assign(world,{enemies:[],bullets:[],effects:[],spawn:[],bonus:null,base:true,remaining:20,spawnClock:999,freeze:0,fort:0,kills:[0,0,0,0],clearTimer:0});
    }
    function testBullet(x,y,d,enemy=false,power=false){return {x,y,d,enemy,power,index:0,owner:enemy?999:world.players[0].id,speed:180,dead:false};}
    function brickCount(tile=1){return world.map.flat().filter(t=>t===tile).length;}
  `,sandbox);
  return sandbox;
}
function test(name,body) {
  const sandbox=context();
  try {vm.runInContext(body,sandbox);passed++;console.log('PASS '+name);}
  catch(error) {failed++;console.error('FAIL '+name+'\n  '+error.message);}
}

test('start uses native map geometry, stage transition and protected player spawn', `
  start();
  assert.equal(scene.mode,'stage');assert.equal(world.remaining,20);
  assert.equal(world.map.length,52);assert.equal(world.map[0].length,52);
  assert.equal(world.players.length,1);assert.equal(world.players[0].x,64);assert.equal(world.players[0].y,192);
  assert.equal(blocked(world.players[0],64,192),false);
  update(1.8);assert.equal(scene.mode,'playing');
`);

test('one enemy hit by two simultaneous shells scores once', `
  resetBattle();
  world.enemies=[{id:999,x:80,y:80,d:0,kind:0,enemy:true,active:true,dead:false,spawn:0,armor:1,bonus:false}];
  world.bullets=[testBullet(88,86,2),testBullet(88,86,2)];
  updateBullets(1/60);
  assert.equal(world.players[0].score,100);assert.equal(world.kills[0],1);
  assert.equal(world.enemies.length,0);
`);

test('last life cannot become negative on repeated same-frame damage', `
  resetBattle();const p=world.players[0];p.lives=1;p.shield=0;p.spawn=0;
  world.bullets=[testBullet(72,198,0,true),testBullet(72,198,0,true)];
  updateBullets(1/60);damagePlayer(p);
  assert.equal(p.lives,0);assert.equal(p.active,false);assert.equal(scene.mode,'dying');
`);

test('a surviving player respawns with invulnerability', `
  resetBattle();const p=world.players[0];p.x=48;p.y=48;p.lives=3;p.stars=2;
  damagePlayer(p);damagePlayer(p);
  assert.equal(p.lives,2);assert.equal(p.x,64);assert.equal(p.y,192);assert.equal(p.stars,0);
  assert.ok(p.shield>0);assert.ok(p.spawn>0);assert.equal(scene.mode,'playing');
`);

test('tank geometry respects borders, walls and another 16px tank', `
  resetBattle();const p=world.players[0];p.x=16;p.y=16;
  assert.equal(body(p).w,14);assert.equal(body(p).h,14);
  for(let y=4;y<8;y++)world.map[y][8]=1;
  assert.equal(blocked(p,17,16),false);assert.equal(blocked(p,18,16),true);
  assert.equal(blocked(p,-1,16),true);assert.equal(blocked(p,193,16),true);
  world.map=Array.from({length:52},()=>Array(52).fill(0));
  const other=makePlayer(1);other.x=32;other.y=16;world.players.push(other);
  assert.equal(blocked(p,16,16),false);assert.equal(blocked(p,19,16),true);
`);

test('perpendicular turns snap the cross axis to the 8px grid', `
  resetBattle();const p=world.players[0];p.x=66;p.y=64;p.d=1;
  moveTank(p,0,1/60);assert.equal(p.x,64);assert.equal(p.d,0);
  p.x=64;p.y=67;p.d=0;moveTank(p,1,1/60);assert.equal(p.y,64);assert.equal(p.d,1);
`);

test('a brick loses one 4px layer across 8px, steel survives normal shells', `
  resetBattle();for(let y=8;y<10;y++)for(let x=8;x<10;x++)world.map[y][x]=1;
  assert.equal(brickHit(testBullet(36,39,0)),true);assert.equal(brickCount(),2);
  assert.equal(world.map[8][8],1);assert.equal(world.map[9][8],0);
  for(let y=8;y<10;y++)for(let x=8;x<10;x++)world.map[y][x]=2;
  assert.equal(brickHit(testBullet(36,39,0)),true);assert.equal(brickCount(2),4);
  assert.equal(brickHit(testBullet(36,39,0,false,true)),true);assert.equal(brickCount(2),0);
`);

test('opposing shells cancel each other before hitting a tank', `
  resetBattle();world.bullets=[testBullet(80,80,1),testBullet(83,80,3,true)];
  updateBullets(1/60);assert.equal(world.bullets.length,0);assert.equal(world.players[0].lives,3);
`);

test('pause clears held input and freezes the battle until resume', `
  resetBattle();const p=world.players[0];input.set('test','up');
  pause();assert.equal(scene.mode,'paused');assert.equal(input.size,0);
  update(1);assert.equal(p.x,64);assert.equal(p.y,192);assert.equal(world.remaining,20);
  pause();assert.equal(scene.mode,'playing');assert.equal(input.size,0);
`);

test('one active shell by default, two with the second star upgrade', `
  resetBattle();const p=world.players[0];fire(p);p.cd=0;fire(p);
  assert.equal(world.bullets.length,1);
  p.stars=2;p.cd=0;fire(p);p.cd=0;fire(p);assert.equal(world.bullets.length,2);
`);

test('stage advances while preserving score and remaining lives', `
  resetBattle();const p=world.players[0];p.score=1200;p.lives=2;
  world.remaining=0;world.enemies=[];update(1/60);assert.equal(scene.mode,'playing');
  update(2.5);assert.equal(scene.mode,'score');
  start();assert.equal(scene.stage,2);assert.equal(scene.mode,'stage');
  assert.equal(world.players[0].score,1200);assert.equal(world.players[0].lives,2);assert.equal(world.remaining,20);
`);


// Regressions for mechanics that must stay consistent across stages and hit angles.
test('shell contact at an 8px boundary removes the actual brick it touched', `
  resetBattle();world.map[8][17]=1;
  assert.equal(brickHit(testBullet(72,35,0)),true);
  assert.equal(world.map[8][17],0,'the touched cell to the left of the shell axis must be removed');
`);

test('brick edge contacts work from every direction', `
  for(const [d,x,y,cellX,cellY] of [[0,72,35,17,8],[2,72,33,17,8],[1,35,72,8,17],[3,33,72,8,17]]){
    resetBattle();world.map[cellY][cellX]=1;
    assert.equal(brickHit(testBullet(x,y,d)),true,'shell direction '+d);
    assert.equal(world.map[cellY][cellX],0,'brick direction '+d);
  }
`);

test('normal shells cannot clear steel at an off-axis edge contact', `
  resetBattle();world.map[8][17]=2;
  assert.equal(brickHit(testBullet(72,35,0)),true);
  assert.equal(world.map[8][17],2);
  assert.equal(brickHit(testBullet(72,35,0,false,true)),true);
  assert.equal(world.map[8][17],0);
`);

test('star upgrades survive stage loading for both players', `
  resetBattle();const p1=world.players[0],p2=makePlayer(1);world.players.push(p2);scene.twoPlayers=true;
  p1.stars=3;p1.score=1200;p1.lives=2;p2.stars=2;p2.score=700;p2.lives=1;
  scene.stage=2;loadStage();
  assert.equal(p1.stars,3);assert.equal(p2.stars,2);
  assert.equal(p1.score,1200);assert.equal(p2.score,700);assert.equal(p1.lives,2);assert.equal(p2.lives,1);
  assert.ok(p1.shield>0&&p2.shield>0);
`);

test('stars upgrade shells without increasing tank movement speed', `
  const distances=[];
  for(let stars=0;stars<=3;stars++){
    resetBattle();const p=world.players[0];p.x=64;p.y=64;p.d=1;p.stars=stars;
    for(let frame=0;frame<10;frame++)moveTank(p,1,1/60);
    distances.push(p.x-64);
  }
  assert.ok(distances.every(d=>Math.abs(d-distances[0])<.000001),'movement distance by upgrade: '+distances.join(', '));
`);

test('a star still increases shell speed', `
  resetBattle();const p=world.players[0];fire(p);const base=world.bullets[0].speed;
  world.bullets=[];p.cd=0;p.stars=1;fire(p);assert.ok(world.bullets[0].speed>base);
`);

test('enemy perpendicular turns use the same 8px alignment as player turns', `
  resetBattle();
  const enemy={id:999,x:64,y:67,d:0,kind:0,enemy:true,active:true,dead:false,spawn:0,armor:1,anim:0,stars:0};
  world.enemies=[enemy];assert.equal(turnTank(enemy,1),true);
  assert.equal(enemy.y,64);assert.equal(enemy.d,1);
`);

test('turn alignment cannot teleport a tank through a solid tile', `
  resetBattle();const p=world.players[0];p.x=64;p.y=67;p.d=0;
  world.map[16][17]=1;
  assert.equal(blocked(p,p.x,p.y),false);
  assert.equal(turnTank(p,1),false);
  assert.equal(p.x,64);assert.equal(p.y,67);assert.equal(p.d,0);
`);

test('enemy AI finishes its lane before changing to a perpendicular heading' , `
  resetBattle();
  const enemy={id:999,x:64,y:67,d:0,kind:0,enemy:true,active:true,dead:false,spawn:0,armor:1,anim:0,stars:0,turn:0,cd:10};
  world.enemies=[enemy];
  const random=Math.random;let randomIndex=0;const values=[.1,.1,.1,.9,.1];Math.random=()=>values[randomIndex++%values.length];
  try{
    update(1/60);assert.equal(enemy.d,0,'an enemy must not turn halfway between lanes');
    for(let i=0;i<5;i++)update(1/60);
  }finally{Math.random=random;}
  assert.equal(enemy.d%2,1,'the deterministic AI shuffle should choose a perpendicular heading');
  assert.equal(enemy.y%8,0,'the cross axis must be aligned when the AI turns');
`);

test('first hit on an armored bonus tank drops its power-up once', `
  resetBattle();
  const enemy={id:999,x:80,y:80,d:0,kind:3,enemy:true,active:true,dead:false,spawn:0,armor:4,bonus:true};
  world.enemies=[enemy];killEnemy(enemy,testBullet(88,88,0));
  assert.equal(enemy.armor,3);assert.ok(!enemy.dead&&enemy.active);assert.ok(world.bonus);
  assert.equal(enemy.bonus,false);assert.equal(world.players[0].score,0);
  const bonus=world.bonus;killEnemy(enemy,testBullet(88,88,0));
  assert.equal(enemy.armor,2);assert.equal(world.bonus,bonus,'later armor hits must not create another drop');
`);

if (/\bstun\b/.test(engineSource)) {
  test('two-player friendly fire stuns without taking a life or awarding points', `
    resetBattle();scene.twoPlayers=true;
    const p1=world.players[0],p2=makePlayer(1);p1.x=40;p1.y=80;p2.x=80;p2.y=80;p2.shield=0;p2.spawn=0;
    world.players.push(p2);world.bullets=[testBullet(78,88,1)];
    updateBullets(1/30);
    assert.equal(p2.lives,3);assert.equal(p2.active,true);assert.ok(p2.stun>0);
    assert.equal(p1.score,0);assert.equal(world.bullets.length,0);
    const x=p2.x,y=p2.y;input.set('second-player','p2up');update(1/60);
    assert.equal(p2.x,x);assert.equal(p2.y,y);
  `);
} else {skipped++;console.log('SKIP optional two-player friendly-fire stun: not implemented');}

test('score screen automatically loads the next stage after its delay', `
  resetBattle();const p=world.players[0];p.stars=2;p.score=800;p.lives=2;
  world.remaining=0;world.enemies=[];update(2.5);assert.equal(scene.mode,'score');
  update(5.9);assert.equal(scene.mode,'score');assert.equal(scene.stage,1);
  update(.11);assert.equal(scene.mode,'stage');assert.equal(scene.stage,2);
  assert.equal(p.stars,2);assert.equal(p.score,800);assert.equal(p.lives,2);
`);

test('a grenade gives only its 500-point pickup and clears armor without extra kills or drops', `
  resetBattle();const p=world.players[0];p.score=1200;
  world.kills=[1,2,3,4];
  world.enemies=Array.from({length:4},(_,kind)=>({id:900+kind,x:80+kind*16,y:80,d:0,kind,enemy:true,active:true,dead:false,spawn:0,armor:kind===3?4:1,bonus:true}));
  world.bonus={x:p.x,y:p.y,type:4,t:0,life:20};
  const originalDrop=dropBonus;let drops=0;dropBonus=e=>{drops++;originalDrop(e);};
  try{collectBonus(p);}finally{dropBonus=originalDrop;}
  assert.equal(p.score,1700);assert.ok(world.enemies.every(e=>e.dead&&!e.active));
  assert.deepEqual(world.kills,[1,2,3,4]);assert.equal(world.bonus,null);assert.equal(drops,0);
  assert.equal(world.remaining,20,'the grenade clears active enemies, not the unspawned wave');
`);

test('power enemies have faster shells and movement than basic enemies', `
  function measureEnemy(kind){
    resetBattle();const enemy={id:999,x:64,y:64,d:1,kind,enemy:true,active:true,dead:false,spawn:0,armor:1,bonus:false,anim:0,stars:0,cd:0};
    world.enemies=[enemy];
    for(let i=0;i<10;i++)moveTank(enemy,1,1/60);
    fire(enemy);assert.equal(world.bullets.length,1);
    return {distance:enemy.x-64,shellSpeed:world.bullets[0].speed};
  }
  const basic=measureEnemy(0),power=measureEnemy(2),fast=measureEnemy(1);
  assert.equal(basic.distance,5);assert.equal(power.distance,10);assert.equal(fast.distance,15);
  assert.equal(basic.shellSpeed,150);assert.equal(power.shellSpeed,240);
  assert.equal(fast.shellSpeed,basic.shellSpeed,'a fast tank upgrades movement, not its shell');
`);

test('a fired shell survives its player death and can still score a hit', `
  resetBattle();const p=world.players[0];p.x=64;p.y=80;p.d=1;p.lives=3;
  world.enemies=[{id:999,x:88,y:80,d:0,kind:0,enemy:true,active:true,dead:false,spawn:0,armor:1,bonus:false}];
  fire(p);assert.equal(world.bullets.length,1);const shell=world.bullets[0];
  damagePlayer(p);
  assert.equal(p.lives,2);assert.equal(world.bullets.length,1);assert.equal(world.bullets[0],shell);
  assert.equal(shell.dead,false);assert.equal(shell.owner,p.id);
  updateBullets(.1);assert.equal(p.score,100);assert.equal(world.enemies.length,0);
`);

console.log(`${passed} passed, ${failed} failed, ${skipped} skipped.`);
process.exitCode=failed?1:0;

