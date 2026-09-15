import {Layers3,Flag,FileText,SquareCheck,Inbox} from 'lucide-react';
export type WorkspaceObjectKind='feature'|'phase'|'requirement'|'work'|'group';
const kinds={feature:{label:'特性',icon:Layers3},phase:{label:'Phase',icon:Flag},requirement:{label:'需求',icon:FileText},work:{label:'工作项',icon:SquareCheck},group:{label:'归类',icon:Inbox}};
export function WorkspaceObjectMark({kind}:{kind:WorkspaceObjectKind}){
  const {icon:Icon,label:name}=kinds[kind];
  return <span className="workspace-object-mark" data-kind={kind} title={name}><Icon size={15} aria-hidden="true"/></span>;
}
