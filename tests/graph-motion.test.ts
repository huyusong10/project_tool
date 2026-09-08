import {describe,it,expect} from 'vitest';
import {graphMotionFrame} from '../src/client/graph-motion';
describe('graph motion clock',()=>{
  it('hides outgoing routes before moving geometry and reveals incoming routes only at their final positions',()=>{
    expect(graphMotionFrame(40,true)).toMatchObject({phase:'fade-out',position:0,oldOpacity:.5,newOpacity:0});
    const moving=graphMotionFrame(200,true);expect(moving.position).toBeGreaterThan(0);expect(moving.position).toBeLessThan(1);expect(moving.oldOpacity).toBe(0);expect(moving.newOpacity).toBe(0);
    expect(graphMotionFrame(380,true)).toMatchObject({phase:'fade-in',position:1,oldOpacity:0,newOpacity:.5,done:false});
    expect(graphMotionFrame(440,true)).toMatchObject({position:1,newOpacity:1,done:true});
  });
  it('does not wait for motion when only routes change',()=>{
    expect(graphMotionFrame(140,false)).toMatchObject({position:1,newOpacity:.5});
    expect(graphMotionFrame(200,false).done).toBe(true);
  });
});
