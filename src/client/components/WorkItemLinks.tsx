import { inspectLinkWrite } from '../features/work-items/link-write';
import { workItemWriteUrl } from '../features/work-items/api';

import { DetailCard } from './DetailCard';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ZodError } from 'zod';
import { normalizeReferenceLinks, readReferenceLinks, type ReferenceLink } from '../../shared/reference-links';
import { api, jsonBody, isWriteOutcomeUnknown, requiresWriteRecheck } from '../api';
import { useDeliveryForm } from '../use-delivery-form';
import { invalidateRequirementViews } from '../query-keys';
import { assertCleanRequirementDraft } from '../use-graph-draft';
import { useSession } from '../app-context';
import type { Requirement, WorkItem } from '../types';
import { ReferenceLinks, ReferenceLinksEditor } from './ReferenceLinks';
import { Button } from './Button';

export function WorkItemLinks({requirement,item,editable,manager}:{requirement:Requirement;item:WorkItem;editable:boolean;manager:boolean}) {
  const client=useQueryClient(),{session}=useSession();
  const [draft,setDraft,clearDraft]=useDeliveryForm(requirement.projectId,item.id+':links',()=>({editing:false,version:item.version,links:readReferenceLinks(item.referenceLinks)}));
  // A pending request is separate from editable input, so cancelling a draft cannot erase it.
  const [receipt,setReceipt,clearReceipt]=useDeliveryForm<{version:number;links:ReferenceLink[];url:string;method:string;body:string}|null>(requirement.projectId,item.id+':links:receipt',()=>null);
  const [error,setError]=useState(''),[needsRead,setNeedsRead]=useState(!!receipt),[reading,setReading]=useState(false),[review,setReview]=useState<WorkItem|null>(null);
  const finish=()=>{setReceipt(null);clearReceipt();setDraft({editing:false,version:item.version,links:readReferenceLinks(item.referenceLinks)});clearDraft();setNeedsRead(false);invalidateRequirementViews(client,requirement.id,'links');};
  const mutation=useMutation({mutationFn:async()=>{
    const links=normalizeReferenceLinks(draft.links);
    await assertCleanRequirementDraft(session.accountId||session.username||'guest',requirement.id,{action:'edit'});
    const terminal=['completed','cancelled'].includes(item.status)||['completed','cancelled'].includes(requirement.status);
    const url=workItemWriteUrl(item.id, terminal),method=terminal?'POST':'PATCH',body=jsonBody({expectedVersion:draft.version,referenceLinks:links,...terminal?{reason:'更新关联链接'}:{}});
    setReceipt({version:draft.version,links,url,method,body});
    return api(url,{method,body});
  },onSuccess:()=>{finish();setError('');},onError:e=>{setError(e instanceof ZodError?e.issues.map(issue=>issue.message).join('；'):e.message);if(!isWriteOutcomeUnknown(e)){setReceipt(null);clearReceipt();}setNeedsRead(requiresWriteRecheck(e));}});
  const read=async()=>{
    setReading(true);setError('');try{
      const {latest:work,outcome}=await inspectLinkWrite(requirement.id,item.id,receipt);
      if(outcome==='applied'){finish();return;}
      if(outcome==='conflict'){setReview(work);setError('当前资料已变化，请核对最新链接。原请求和输入仍保留。');return;}
      setDraft({...draft,version:work.version});setReceipt(null);clearReceipt();setNeedsRead(false);
      setError('已读取最新资料，输入已保留。请核对链接后重新保存。');invalidateRequirementViews(client,requirement.id,'links');
    }catch(e){setError((e as Error).message);}finally{setReading(false);}
  };
  const locked=mutation.isPending||reading,canEdit=editable||manager;
  return <DetailCard title="关联链接" label="工作项关联链接" className="work-item-links" actions={!draft.editing&&!receipt&&canEdit&&<Button size="compact" onClick={()=>setDraft({editing:true,version:item.version,links:readReferenceLinks(item.referenceLinks)})}>编辑</Button>}>
    {draft.editing||receipt?<form onSubmit={e=>{e.preventDefault();if(!receipt&&!needsRead&&!locked)mutation.mutate();}}>
      <ReferenceLinksEditor value={draft.links} disabled={locked||!!receipt||!canEdit} onChange={links=>setDraft({...draft,links})}/>
      {error&&<p role="alert" className="field-help">{error}</p>}
      {review&&<aside><h4>最新关联链接</h4><ReferenceLinks links={review.referenceLinks}/>{!review.referenceLinks?.length&&<p className="field-help">当前没有链接</p>}<Button disabled={locked} aria-label="已核对，保留输入按最新版本继续" onClick={()=>{setDraft({...draft,version:review.version});setReceipt(null);clearReceipt();setReview(null);setNeedsRead(false);setError('已保留输入，请确认后保存。');}}>继续</Button></aside>}
      <div className="form-actions">{receipt||needsRead?<Button disabled={locked} onClick={()=>void read()}>核对</Button>:<><Button disabled={locked} onClick={()=>{setDraft({editing:false,version:item.version,links:readReferenceLinks(item.referenceLinks)});clearDraft();setError('');}}>取消</Button><Button type="submit" variant="primary" busy={mutation.isPending} disabled={!canEdit||locked}>保存</Button></>}</div>
    </form>:<><ReferenceLinks links={item.referenceLinks}/>{!item.referenceLinks?.length&&<p className="field-help">尚未添加链接</p>}</>}
  </DetailCard>;
}
