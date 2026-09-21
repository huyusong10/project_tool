import {z} from 'zod';

export const linkKinds = ['document','task','other'] as const;
export type LinkKind = typeof linkKinds[number];
export type ReferenceLink = {title:string;url:string;kind?:LinkKind};
export const linkKindLabels = {document:'文档',task:'任务',other:'其他'};
export function inferReferenceLink(value:string):ReferenceLink {
  const url=value.trim();
  try {
    const parsed=new URL(url),task=/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(parsed.pathname);
    if(task)return {url,title:task[1],kind:'task'};
    if(/\/pages\/|\/spaces\/|confluence/i.test(parsed.pathname+' '+parsed.hostname))return {url,title:'Confluence 文档',kind:'document'};
    return {url,title:parsed.hostname,kind:'other'};
  }catch{return {url,title:'关联链接',kind:'other'};}
}
export function referenceUrlKey(url:string){try{return new URL(url.trim()).href;}catch{return url.trim();}}
export const referenceLinksInput = z.array(z.object({
  title:z.string().trim().min(1,'请填写链接名称').max(200),
  url:z.string().trim().max(4000).url('链接地址格式不正确').refine(v=>/^https?:\/\//i.test(v),'链接仅支持 HTTP 或 HTTPS'),
  kind:z.enum(linkKinds).optional(),
}).strict()).max(20,'最多关联 20 个链接').refine(links=>new Set(links.map(l=>referenceUrlKey(l.url))).size===links.length,'同一地址无需重复添加');

export function readReferenceLinks(value:unknown,legacy?:string|null):ReferenceLink[] {
  let links:unknown=value;
  if(typeof links==='string'){try{links=JSON.parse(links);}catch{links=[];}}
  const result:ReferenceLink[]=Array.isArray(links)?links.filter(l=>l&&typeof l.url==='string'&&typeof l.title==='string').map(l=>({...l,kind:l.kind||inferReferenceLink(l.url).kind})):[];
  if((value===undefined||value===null)&&legacy?.trim())return [inferReferenceLink(legacy)];
  return result;
}
export function normalizeReferenceLinks(value:unknown):ReferenceLink[]{return readReferenceLinks(referenceLinksInput.parse(value));}
export function referenceLinksEqual(left:unknown,right:unknown):boolean {
  const a=referenceLinksInput.safeParse(left??[]),b=referenceLinksInput.safeParse(right??[]);
  return a.success&&b.success&&JSON.stringify(readReferenceLinks(a.data))===JSON.stringify(readReferenceLinks(b.data));
}
export function requirementReferenceLinks(input:{referenceLinks?:unknown;referenceUrl?:unknown},current?:{referenceLinks?:unknown;referenceUrl?:string|null}) {
  if(input.referenceLinks!==undefined)return normalizeReferenceLinks(input.referenceLinks);
  const links=readReferenceLinks(current?.referenceLinks,current?.referenceUrl);
  if(input.referenceUrl===undefined)return links;
  const url=String(input.referenceUrl||'').trim(),index=links.findIndex(l=>referenceUrlKey(l.url)===referenceUrlKey(current?.referenceUrl||''));
  if(index>=0){if(url)links[index]=url===links[index].url?links[index]:inferReferenceLink(url);else links.splice(index,1);}
  else if(url)links.unshift(inferReferenceLink(url));
  return normalizeReferenceLinks(links.filter((l,i,all)=>all.findIndex(v=>referenceUrlKey(v.url)===referenceUrlKey(l.url))===i));
}
