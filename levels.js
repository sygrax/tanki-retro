/* Each cell is an 8 x 8 pixel half-tile. 0 empty, 1 brick, 2 steel,
   3 forest, 4 water, 5 ice. Maps are expanded to 4px destruction cells. */
window.BATTLE_LEVELS = (() => {
  function first() {
    const m = Array.from({length:26}, () => Array(26).fill(0));
    const rect = (x,y,w,h,t=1) => {for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)m[j][i]=t;};
    for(const x of [2,6,18,22])rect(x,2,2,8);
    rect(10,2,2,6);rect(14,2,2,6);rect(12,6,2,2,2);
    rect(2,12,2,2);rect(6,12,4,2);rect(16,12,4,2);rect(22,12,2,2);
    rect(0,12,2,2,2);rect(24,12,2,2,2);
    rect(10,10,2,4);rect(14,10,2,4);rect(12,14,2,2);
    for(const x of [2,6,18,22])rect(x,16,2,8);
    rect(10,18,6,2);rect(10,20,2,2);rect(14,20,2,2);
    return m;
  }
  const maps=[first()];
  for(let stage=1;stage<5;stage++){
    const m=first();
    for(let y=2;y<22;y++)for(let x=2;x<24;x++){
      if(stage===1&&y>=8&&y<10&&x>=4&&x<22)m[y][x]=x<10||x>15?3:0;
      if(stage===2&&x>=10&&x<16&&y>=4&&y<14)m[y][x]=y<8?4:0;
      if(stage===3&&y>=10&&y<16&&x>=4&&x<22)m[y][x]=(x<8||x>=18)?4:5;
      if(stage===4&&m[y][x]===1&&y<10&&x%8<4)m[y][x]=2;
    }
    maps.push(m);
  }
  return maps;
})();
