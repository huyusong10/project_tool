import fs from 'node:fs';
import type { Database } from 'better-sqlite3';

/** Diagnostic reads use fixture data only; bind values are not written into reports. */
export function profileQueries<T>(sqlite: Database, read:()=>T) {
  const prepare=sqlite.prepare.bind(sqlite),queries:Array<{sql:string;elapsedMs:number;plan:unknown[]}> = [];
  sqlite.prepare=((sql:string)=>{
    const statement=prepare(sql);
    if(!/^\s*(SELECT|WITH)\b/i.test(sql))return statement;
    return new Proxy(statement,{get(target,key){
      const value=Reflect.get(target,key,target);
      if(!['get','all'].includes(String(key)))return typeof value==='function'?value.bind(target):value;
      return (...args:unknown[])=>{
        const start=performance.now(),result=value.apply(target,args),elapsedMs=performance.now()-start;
        queries.push({sql,elapsedMs,plan:prepare('EXPLAIN QUERY PLAN '+sql).all(...args)});
        return result;
      };
    }});
  }) as typeof sqlite.prepare;
  try {
    const value=read();
    fs.mkdirSync('coverage/performance',{recursive:true});
    fs.writeFileSync('coverage/performance/queries.json',JSON.stringify(queries,null,2)+'\n');
    return {value,queries};
  } finally { sqlite.prepare=prepare as typeof sqlite.prepare; }
}
