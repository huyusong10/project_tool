import {Button} from './Button';
import {useDetailSection} from './DetailWorkspace';

/** Overview reads the same material as the full details; it never stores a second summary. */
export function OverviewIntroduction({title, text, empty, secondary}: {
  title: string; text?: string | null; empty: string;
  secondary?: {title: string; text?: string | null};
}) {
  const section = useDetailSection();
  return <section className="overview-introduction" aria-label={title}>
    <header><h3>{title}</h3>{section&&<Button size="compact" variant="link" aria-label="查看完整资料" onClick={()=>section('basic')}>资料</Button>}</header>
    <p className={'overview-introduction-text'+(text?.trim()?'':' is-empty')}>{text?.trim()||empty}</p>
    {secondary?.text?.trim()&&<div className="overview-introduction-secondary"><h4>{secondary.title}</h4><p>{secondary.text.trim()}</p></div>}
  </section>;
}
