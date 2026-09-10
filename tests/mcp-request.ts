import {request} from 'node:http';
/** Node HTTP permits all OS-assigned ephemeral test ports, unlike fetch's browser port list. */
export function mcpRequest(origin:string,token:string,name:string,args:Record<string,unknown>){
  return mcpRpcRequest(origin,token,'tools/call',{name,arguments:args});
}
export function mcpRpcRequest(origin:string,token:string,method:string,params:Record<string,unknown>){
  return new Promise<{statusCode:number;body:string}>((resolve,reject)=>{
    const req=request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,accept:'application/json, text/event-stream','content-type':'application/json',connection:'close'}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve({statusCode:res.statusCode||0,body:Buffer.concat(chunks).toString()}));res.on('error',reject);
    });
    req.setTimeout(10000,()=>req.destroy(new Error('MCP test timeout')));req.on('error',reject);
    req.end(JSON.stringify({jsonrpc:'2.0',id:1,method,params}));
  });
}
