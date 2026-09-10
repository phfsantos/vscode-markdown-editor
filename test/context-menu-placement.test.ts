import { expect, it } from 'vitest';
import { placeMenu } from '../packages/media/src/context-menu-placement';
it('opens left and above at the bottom right', () => {
  expect(placeMenu({anchor:{left:780,right:780,top:590,bottom:590},size:{width:200,height:300},viewport:{left:0,top:0,width:800,height:600},kind:'root'})).toEqual({left:580,top:290,width:200,height:300,side:'left'});
});
for (const kind of ['root','submenu'] as const) {
  for (const viewport of [{left:0,top:0,width:800,height:600},{left:30,top:50,width:320,height:240},{left:0,top:0,width:8,height:6}]) {
    for (const [x,y] of [[0,0],[viewport.width,0],[0,viewport.height],[viewport.width,viewport.height],[viewport.width/2,viewport.height/2]]) {
      it(`contains ${kind} at ${x},${y} in ${JSON.stringify(viewport)}`, () => {
        const pos=placeMenu({anchor:{left:x+viewport.left,right:x+viewport.left,top:y+viewport.top,bottom:y+viewport.top},size:{width:1200,height:1600},viewport,kind});
        expect(pos.left).toBeGreaterThanOrEqual(viewport.left);
        expect(pos.top).toBeGreaterThanOrEqual(viewport.top);
        expect(pos.left+pos.width).toBeLessThanOrEqual(viewport.left+viewport.width);
        expect(pos.top+pos.height).toBeLessThanOrEqual(viewport.top+viewport.height);
      });
    }
  }
}
it.each([[200, 'right', 254],[650,'left',446],[375,'right',429]] as const)('chooses submenu direction at x=%s', (x, side, left) => {
  const pos=placeMenu({anchor:{left:x,right:x+50,top:100,bottom:130},size:{width:200,height:100},viewport:{left:0,top:0,width:800,height:600},kind:'submenu'});
  expect(pos.side).toBe(side); expect(pos.left).toBe(left);
});
it('prefers an exact right fit',()=>{
  expect(placeMenu({anchor:{left:590,right:590,top:10,bottom:10},size:{width:200,height:100},viewport:{left:0,top:0,width:800,height:600},kind:'root'}).side).toBe('right');
});
