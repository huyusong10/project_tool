import {describe,it,expect} from 'vitest';
import {EditorSession,newHistory,readHistory} from '../src/client/editor-session';
import {fieldObjectId,projectFieldActive,templateFieldActive} from '../src/client/editor-fields';
import type {DependencyChanges,EditorEntityChange} from '../src/shared/path-contracts';
import type {PathAnalysis} from '../src/shared/paths';

const empty:DependencyChanges={add:[],remove:[],estimates:[]};
const invalid={value:'',original:'保留原文',error:'请填写名称'};
const source={requirements:[{id:'r'}],nodes:[{id:'w',requirementId:'r'},{id:'m',requirementId:'r'}],milestones:[{id:'m',requirementId:'r'}]} as PathAnalysis;
function project(){const session=new EditorSession(newHistory(empty,'1',source));session.loading=false;session.fieldAvailability=projectFieldActive;return session;}
const entity=(id:string,op:EditorEntityChange['op'],requirementId?:string):EditorEntityChange=>({id,op,entity:requirementId?'work':'requirement',requirementId,data:{}});

describe('field buffers follow document membership',()=>{
 it('resolves colon-containing client IDs without confusing property or title prefixes',()=>{
  expect(fieldObjectId('title:r:template:w')).toBe('r:template:w');expect(fieldObjectId('r:template:w:duration')).toBe('r:template:w');expect(fieldObjectId('unrecognized')).toBeUndefined();
 });
 it('deletion suspends only that object; undo restores its raw input, redo suspends it again',()=>{
  const session=project();session.dispatch({type:'field',key:'title:w',buffer:invalid});session.dispatch({type:'field',key:'title:m',buffer:invalid});
  session.dispatch({type:'change',value:{...empty,entities:[entity('w','delete','r')]}});expect(Object.keys(session.fields)).toEqual(['title:m']);expect(session.state.fields['title:w']).toEqual(invalid);
  session.dispatch({type:'undo'});expect(Object.keys(session.fields)).toEqual(['title:w','title:m']);session.dispatch({type:'redo'});expect(Object.keys(session.fields)).toEqual(['title:m']);
  const restored=new EditorSession(readHistory<DependencyChanges>(JSON.parse(JSON.stringify(session.state)))!);restored.fieldAvailability=projectFieldActive;expect(restored.fields).toEqual(session.fields);expect(restored.state.fields).toEqual(session.state.fields);
 });
 it('deleting a requirement suspends child fields while unrelated fields remain active',()=>{
  const session=project();session.dispatch({type:'field',key:'w:duration',buffer:invalid});session.dispatch({type:'field',key:'title:r',buffer:invalid});
  session.dispatch({type:'change',value:{...empty,entities:[entity('r','delete')]}});expect(session.fields).toEqual({});session.dispatch({type:'undo'});expect(Object.keys(session.fields)).toHaveLength(2);
 });
 it('milestone ownership remains usable when the execution graph omits that milestone',()=>{
  const session=project();session.state.server={...source,nodes:[]};session.dispatch({type:'field',key:'m:targetDate',buffer:invalid});expect(session.fields['m:targetDate']).toEqual(invalid);
  session.dispatch({type:'change',value:{...empty,entities:[entity('r','delete')]}});expect(session.fields).toEqual({});session.dispatch({type:'undo'});expect(session.fields['m:targetDate']).toEqual(invalid);
 });
 it('undoing a creation and then replacing its redo branch cannot reactivate an orphan buffer',()=>{
  const session=project();session.dispatch({type:'change',value:{...empty,entities:[entity('new','create','r')]}});session.dispatch({type:'field',key:'title:new',buffer:invalid});expect(session.fields['title:new']).toEqual(invalid);
  session.dispatch({type:'undo'});expect(session.fields).toEqual({});session.dispatch({type:'redo'});expect(session.fields['title:new']).toEqual(invalid);
  session.dispatch({type:'undo'});session.dispatch({type:'change',value:{...empty,entities:[entity('r','update')]}});expect(session.fields).toEqual({});expect(session.state.fields['title:new']).toEqual(invalid);expect(session.state.values).toHaveLength(2);
 });
 it('template settings and surviving elements still validate after another item is removed',()=>{
  const session=new EditorSession(newHistory({items:[{clientKey:'a'},{clientKey:'b'}]},'1'));session.loading=false;session.fieldAvailability=templateFieldActive;
  for(const key of ['template:name','title:a','b:duration'])session.dispatch({type:'field',key,buffer:invalid});session.dispatch({type:'change',value:{items:[{clientKey:'b'}]}});
  expect(Object.keys(session.fields)).toEqual(['template:name','b:duration']);session.dispatch({type:'undo'});expect(Object.keys(session.fields)).toHaveLength(3);
 });
 it('reset invalidates mounted field transactions; ordinary changes do not',()=>{
  const session=project(),epoch=session.fieldEpoch;session.dispatch({type:'field',key:'title:w',buffer:invalid});session.dispatch({type:'change',value:{...empty,entities:[entity('r','update')]}});expect(session.fieldEpoch).toBe(epoch);
  session.dispatch({type:'reset',value:empty,version:'2',server:source});expect(session.fieldEpoch).toBe(epoch+1);expect(session.fields).toEqual({});expect(session.state.fields).toEqual({});
 });
 it('reuses field projection between reads but sees the current input in the same save event',()=>{
  const session=project();session.dispatch({type:'field',key:'title:w',buffer:invalid});const before=session.fields;expect(session.fields).toBe(before);
  session.dispatch({type:'field',key:'title:w'});expect(session.fields).toEqual({});expect(session.fields).not.toBe(before);expect(session.fields).toBe(session.fields);
 });
 it('legacy raw keys and unavailable source snapshots do not silently bypass validation',()=>{
  const session=project();session.dispatch({type:'field',key:'legacy-key',buffer:invalid});expect(session.fields['legacy-key']).toEqual(invalid);
  const unavailable=newHistory(empty,'1');unavailable.fields={'title:unknown':invalid};expect(projectFieldActive(unavailable,'title:unknown')).toBe(true);
 });
 it('adopting another tab replaces stale buffers and preserves its undo history',()=>{
  const old=project();old.dispatch({type:'field',key:'title:w',buffer:invalid});old.requestField('title:w');const epoch=old.fieldEpoch;
  const latest=project();latest.dispatch({type:'change',value:{...empty,entities:[{...entity('w','update','r'),data:{title:'新名称'}}]}});latest.dispatch({type:'field',key:'w:duration',buffer:{original:'2',value:'0',error:'工期无效'}});
  old.adopt(latest.state);expect(old.fieldEpoch).toBe(epoch+1);expect(old.fields).toEqual(latest.fields);expect(old.pendingField).toBeUndefined();expect(old.state.values).toEqual(latest.state.values);old.dispatch({type:'undo'});expect(old.state.values[old.state.index]).toEqual(empty);expect(old.fields['w:duration'].value).toBe('0');
 });
 it('deleting a requested object cancels navigation without refocusing it after undo',()=>{
  const session=project();session.dispatch({type:'field',key:'title:w',buffer:invalid});session.requestField('title:w');session.dispatch({type:'change',value:{...empty,entities:[entity('w','delete','r')]}});expect(session.pendingField).toBeUndefined();session.dispatch({type:'undo'});expect(session.fields['title:w']).toEqual(invalid);expect(session.pendingField).toBeUndefined();
 });
 it('late persistence acknowledgements cannot relabel an adopted snapshot',async()=>{
  const session=project();let release!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve);session.persist(async()=>{await waiting;throw new Error('older write failed');});session.adopt(newHistory(empty,'2',source));release();await session.flush();expect(session.error).toBe('');expect(session.stored).toBe(true);expect(session.state.version).toBe('2');
 });
});
