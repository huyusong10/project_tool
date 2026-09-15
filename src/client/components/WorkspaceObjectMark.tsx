import {Layers3,Flag,FileText,Square,SquareDot,SquareCheck,SquareMinus,Inbox} from 'lucide-react';
export type WorkspaceObjectKind='feature'|'phase'|'requirement'|'work'|'group';
const kinds={feature:{label:'特性',icon:Layers3},phase:{label:'Phase',icon:Flag},requirement:{label:'需求',icon:FileText},work:{label:'工作项',icon:SquareCheck},group:{label:'归类',icon:Inbox}};
const workStates={not_started:{label:'未开始',icon:Square},in_progress:{label:'进行中',icon:SquareDot},completed:{label:'已完成',icon:SquareCheck},cancelled:{label:'已取消',icon:SquareMinus}};
export function WorkspaceObjectMark({kind,status}:{kind:WorkspaceObjectKind;status?:string}){
  const state=kind==='work'&&status&&status in workStates?workStates[status as keyof typeof workStates]:null;
  const {icon:Icon,label:name}=state||kinds[kind];
  return <span className="workspace-object-mark" data-kind={kind} data-work-status={state?status:undefined} title={name} role="img" aria-label={name}><Icon size={15} aria-hidden="true"/></span>;
}
