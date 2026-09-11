import {describe, expect, it, vi} from 'vitest';
import {createChromeStore} from '../src/client/page-foundation';
import {chooseProject, pageIdentity, restorePageSearch, pathBackTarget} from '../src/client/page-foundation';
import type {Project} from '../src/client/types';

describe('页面上下文与声明', () => {
  it('返回只采用相同项目的直接历史来源', () => {
    const source={projectId:'p',label:'需求 A',index:2};
    expect(pathBackTarget('p',source,3)).toMatchObject({kind:'history',label:'返回需求 A'});
    expect(pathBackTarget('other',source,3).kind).toBe('path');
    expect(pathBackTarget('p',source,5).kind).toBe('path');
    expect(pathBackTarget('p',undefined,0)).toMatchObject({kind:'path',fallback:'/paths'});
  });
  it('明确项目与个人筛选分开恢复，深链参数不会被记忆覆盖', () => {
    expect(restorePageSearch('?projectId=b','status=blocked&q=abc').toString()).toBe('status=blocked&q=abc&projectId=b');
    expect(restorePageSearch('?projectId=b&issueId=i','ownerId=old').toString()).toBe('projectId=b&issueId=i');
    expect(restorePageSearch('?q=new','q=old').get('q')).toBe('new');
  });
  it('明确项目不回退；失效记忆只从已授权项目选择', () => {
    const projects = [{id:'a'},{id:'b'}] as Project[];
    expect(chooseProject(projects,'missing','b')).toBeUndefined();
    expect(chooseProject(projects,null,'b')?.id).toBe('b');
    expect(chooseProject(projects,null,'missing')?.id).toBe('a');
    expect(chooseProject([],null,'a')).toBeUndefined();
  });
  it('视图参数不产生新导航；项目、对象和模式发生变化才改变身份', () => {
    const key = (path:string,search='') => pageIdentity(path,new URLSearchParams(search));
    expect(key('/paths','projectId=a&focus=x&q=hello')).toBe(key('/paths','projectId=a&focus=y&q=world'));
    expect(key('/paths','projectId=a')).not.toBe(key('/paths','projectId=b'));
    expect(key('/requirements/a')).not.toBe(key('/requirements/b'));
    expect(key('/requirements/a')).not.toBe(key('/requirements/a','view=path'));
    expect(key('/templates','edit=a')).not.toBe(key('/templates','edit=b'));
  });
  it('迟到发布、旧清理与重复取消不会覆盖当前声明', async () => {
    const store = createChromeStore<{title:string;runtime?:{commitFields:()=>boolean;cancel:()=>void}}>('b'), a = Symbol(), b = Symbol();
    store.publish('b',a,{title:'loading'});
    store.publish('b',b,{title:'current'});
    store.release('b',a); store.publish('a',a,{title:'late'}); store.release('a',b);
    expect(store.getSnapshot()?.title).toBe('current');
    const commitFields = vi.fn(() => true), cancel = vi.fn();
    store.publish('b',b,{title:'current',runtime:{commitFields,cancel}});
    store.prepareNavigation(); store.prepareNavigation();
    expect(commitFields).toHaveBeenCalledExactlyOnceWith(false); expect(cancel).toHaveBeenCalledTimes(1);
    await Promise.resolve(); store.prepareNavigation(); expect(cancel).toHaveBeenCalledTimes(2);
    store.release('b',b); store.release('b',b); expect(store.getSnapshot()).toBeNull();
  });
});
