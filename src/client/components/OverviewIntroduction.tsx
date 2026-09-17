import {ReferenceLinks} from './ReferenceLinks';
import type {ReferenceLink} from '../../shared/reference-links';
import {Button} from './Button';
import {useDetailSection} from './DetailWorkspace';
import {DetailCard} from './DetailCard';

/** Overview reads the same material as the full details; it never stores a second summary. */
export function OverviewIntroduction({title, text, empty, secondary, links, legacy}: {
  links?:ReferenceLink[];legacy?:string|null;title: string; text?: string | null; empty: string;
  secondary?: {links?:ReferenceLink[];legacy?:string|null;title: string; text?: string | null};
}) {
  const section = useDetailSection();
  return <DetailCard title={title} className="overview-introduction" actions={section&&<Button size="compact" variant="link" aria-label="查看完整资料" onClick={()=>section('basic')}>资料</Button>}>
    <p className={'overview-introduction-text'+(text?.trim()?'':' is-empty')}>{text?.trim()||empty}</p>
    {secondary?.text?.trim()&&<div className="overview-introduction-secondary"><h4>{secondary.title}</h4><p>{secondary.text.trim()}</p></div>}
    <ReferenceLinks links={links} legacy={legacy} compact/>
  </DetailCard>;
}
