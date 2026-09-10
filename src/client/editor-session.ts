import type {Point} from './path-layout';
import type {PathAnalysis} from '../shared/paths';

export type FieldBuffer={value:string;original:string;error?:string};
export type EditorHistory<T>={formatVersion:2;version:string;values:T[];index:number;active:boolean;baseline?:T;server?:PathAnalysis;layouts:Record<string,Record<string,Point>>;fields:Record<string,FieldBuffer>};
export type FieldAvailability<T>=(state:EditorHistory<T>,key:string)=>boolean;
export type HistoryCommand<T>=
  |{type:'change';value:T;group?:string}
  |{type:'begin'|'undo'|'redo'|'end-group'}
  |{type:'reset';value:T;version:string;server?:PathAnalysis}
  |{type:'rebase';value:T;values?:T[];baseline:T;version:string;server?:PathAnalysis}
  |{type:'layout-baseline';scope:string;positions:Record<string,Point>}
  |{type:'field';key:string;buffer?:FieldBuffer};
export function newHistory<T>(value:T,version:string,server?:PathAnalysis):EditorHistory<T>{return {formatVersion:2,version,values:[value],index:0,active:false,server,layouts:{},fields:{}};}
export function readHistory<T>(raw:unknown):EditorHistory<T>|undefined{
  if(raw==null)return;
  if(typeof raw!=='object')throw new Error('本机草稿格式无法识别，原记录已保留');
  const value=raw as EditorHistory<T>;
  if(value.formatVersion!==undefined&&value.formatVersion!==2||!Array.isArray(value.values)||!Number.isInteger(value.index)||value.index<0||value.index>=value.values.length||typeof value.version!=='string')throw new Error('本机草稿格式无法识别，原记录已保留');
  return {...value,formatVersion:2,layouts:value.layouts||{},fields:value.fields||{}};
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function historyTransition<T>(state:EditorHistory<T>,command:HistoryCommand<T>,group?:string|null):EditorHistory<T>{
  switch(command.type){
    case 'begin':return state.active?state:{...state,active:true};
    case 'end-group':return state;
    case 'undo':return state.index?{...state,index:state.index-1}:state;
    case 'redo':return state.index+1<state.values.length?{...state,index:state.index+1}:state;
    case 'reset':return newHistory(command.value,command.version,command.server);
    case 'rebase':return {...state,version:command.version,baseline:command.baseline,server:command.server,values:command.values||[command.baseline,command.value],index:command.values?state.index:1};
    case 'layout-baseline':return state.layouts[command.scope]?state:{...state,layouts:{...state.layouts,[command.scope]:structuredClone(command.positions)}};
    case 'field':{const fields={...state.fields};if(command.buffer)fields[command.key]=command.buffer;else delete fields[command.key];return same(fields,state.fields)?state:{...state,fields};}
    case 'change':{
      if(same(state.values[state.index],command.value))return state;
      if(command.group&&command.group===group&&state.index>0)return {...state,active:true,values:[...state.values.slice(0,state.index),command.value]};
      let values=[...state.values.slice(0,state.index+1),command.value],index=state.index+1;
      if(values.length>101){const drop=values.length-101;values=values.slice(drop);index-=drop;}
      return {...state,active:true,baseline:state.baseline||state.values[0],values,index};
    }
  }
}

/** One in-memory document survives route mounts; disk writes keep command order. */
export class EditorSession<T>{
  state:EditorHistory<T>;mounts=0;loading=true;saving=false;readOnly=false;error='';stored=false;restored=false;blocked=false;
  fieldEpoch=0;fieldAvailability?:FieldAvailability<T>;
  pendingField?:string;
  requestField=(key?:string)=>{if(this.pendingField===key)return;this.pendingField=key;this.notify();};
  adopt(state:EditorHistory<T>){this.state=state;this.fieldEpoch++;this.group=null;this.sequence++;this.pendingField=undefined;this.error='';this.stored=true;this.restored=state.active;this.notify();}
  isFieldActive=(key:string)=>this.fieldAvailability?.(this.state,key)??true;
  private fieldCache?:{state:EditorHistory<T>;availability?:FieldAvailability<T>;fields:Record<string,FieldBuffer>};
  get fields(){
    if(this.fieldCache?.state===this.state&&this.fieldCache.availability===this.fieldAvailability)return this.fieldCache.fields;
    const fields=Object.fromEntries(Object.entries(this.state.fields).filter(([key])=>this.isFieldActive(key)));
    this.fieldCache={state:this.state,availability:this.fieldAvailability,fields};return fields;
  }
  private listeners=new Set<()=>void>();private group:string|null=null;private sequence=0;private writeQueue=Promise.resolve();private revision=0;
  constructor(initial:EditorHistory<T>){this.state=initial;}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.revision;
  notify(){this.revision++;for(const listener of this.listeners)listener();}
  setSaving(value:boolean){this.saving=value;this.notify();}
  dispatch(command:HistoryCommand<T>){
    if(this.loading||this.readOnly||this.blocked||this.saving&&['change','undo','redo','rebase'].includes(command.type))return false;
    const next=historyTransition(this.state,command,this.group);
    this.group=command.type==='change'?command.group||null:command.type==='field'||command.type==='layout-baseline'?this.group:null;
    if(next===this.state)return false;if(command.type==='reset'){this.fieldEpoch++;this.pendingField=undefined;}this.state=next;if(this.pendingField&&!this.isFieldActive(this.pendingField))this.pendingField=undefined;this.stored=false;this.notify();return true;
  }
  persist(write:(state:EditorHistory<T>)=>Promise<void>){
    const state=this.state,sequence=++this.sequence;
    this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>write(state)).then(()=>{if(sequence===this.sequence){this.error='';this.stored=true;this.notify();}},()=>{if(sequence===this.sequence){this.error='本机草稿保存失败，关闭页面可能丢失修改';this.stored=false;this.notify();}});
    return this.writeQueue;
  }
  flush=()=>this.writeQueue;
}
