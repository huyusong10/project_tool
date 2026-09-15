import type {ReactNode} from 'react';

/** Fits an existing tools row; on narrow screens floats above the bottom edge. */
export function SelectionActions({count,children}:{count:number;children:ReactNode}){
  return count>0?<div className="selection-actions" role="region" aria-label="所选内容操作"><span>已选 {count} 项</span>{children}</div>:null;
}
