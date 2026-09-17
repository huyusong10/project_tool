import {useId,type ReactNode} from 'react';
import './detail-card.css';

/** A business section shares one heading, boundary and content spacing in every detail view. */
export function DetailCard({title,description,actions,children,className='',label}: {
  title:string; description?:ReactNode; actions?:ReactNode; children:ReactNode; className?:string; label?:string;
}) {
  const id=useId();
  return <section className={'detail-card '+className} aria-label={label} aria-labelledby={label?undefined:id}>
    <header className="detail-card-heading"><div><h3 id={id}>{title}</h3>{description&&<div className="detail-card-description">{description}</div>}</div>{actions&&<div className="detail-card-actions">{actions}</div>}</header>
    <div className="detail-card-body">{children}</div>
  </section>;
}
