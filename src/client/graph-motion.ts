export const graphMotion={wait:250,fadeOut:80,move:240,fadeIn:120};
/** One clock controls geometry and edge visibility; changing polyline shapes never morph through cards. */
export function graphMotionFrame(elapsed:number,moves:boolean){
  const {fadeOut,move,fadeIn}=graphMotion,moving=moves?move:0;
  if(elapsed<fadeOut)return {phase:'fade-out' as const,position:0,oldOpacity:1-elapsed/fadeOut,newOpacity:0,done:false};
  if(elapsed<fadeOut+moving){const t=(elapsed-fadeOut)/moving;return {phase:'moving' as const,position:1-Math.pow(1-t,3),oldOpacity:0,newOpacity:0,done:false};}
  const t=Math.min(1,(elapsed-fadeOut-moving)/fadeIn);
  return {phase:'fade-in' as const,position:1,oldOpacity:0,newOpacity:t,done:t>=1};
}
