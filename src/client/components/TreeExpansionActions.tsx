import {ChevronsDownUp,ChevronsUpDown} from 'lucide-react';
import {Button} from './Button';
import './tree-expansion-actions.css';

export function TreeExpansionActions({canExpand,canCollapse,onChange}:{canExpand:boolean;canCollapse:boolean;onChange:(expanded:boolean)=>void}){
  return <div className="tree-expansion-actions" role="group" aria-label="层级展开">
    <Button size="compact" width="action" aria-label="展开全部" title="展开当前范围的全部层级" disabled={!canExpand} onClick={()=>onChange(true)}><ChevronsUpDown/>展开</Button>
    <Button size="compact" width="action" aria-label="收起全部" title="收起当前范围，只显示第一层" disabled={!canCollapse} onClick={()=>onChange(false)}><ChevronsDownUp/>收起</Button>
  </div>;
}
