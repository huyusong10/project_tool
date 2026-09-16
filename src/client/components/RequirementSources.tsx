import {ReferenceLinks} from './ReferenceLinks';
import {readReferenceLinks,referenceUrlKey,type ReferenceLink} from '../../shared/reference-links';
import {requirementSourceIndex} from '../requirement-sources';

export function RequirementSources({notes, referenceUrl,links}: {links?:ReferenceLink[];notes?: string | null; referenceUrl?: string | null}) {
  const manual=readReferenceLinks(links,referenceUrl);
  const sources = requirementSourceIndex(notes).map(source=>({...source,title:manual.find(link=>source.url&&referenceUrlKey(link.url)===referenceUrlKey(source.url))?.title||source.title}));
  if (!notes?.trim() && !manual.length) return null;
  return <section className="requirement-sources" aria-label="参考资料">
    <h3>参考资料</h3>
    <ReferenceLinks links={manual.filter(link=>!sources.some(source=>source.url&&referenceUrlKey(source.url)===referenceUrlKey(link.url)))}/>
    {!!sources.length&&<ul className="requirement-source-list">{sources.map((source,index)=><li key={index}>
      {source.url?<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>:<strong>{source.title}</strong>}
      {source.version&&<small>{source.version}</small>}
      <p>{source.entries.join('；')}</p>
    </li>)}</ul>}
    {notes?.trim()&&(sources.length||notes.length>600?<details className="requirement-source-original">
      <summary>查看原始摘录与历史说明</summary><pre>{notes}</pre>
    </details>:<p className="requirement-source-text">{notes}</p>)}
  </section>;
}
