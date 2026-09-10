import type {ComponentProps} from 'react';
import {Modal} from './Modal';
export function DraftModal({children,...props}:ComponentProps<typeof Modal>){return <Modal {...props}><div className="personal-drafts draft-dialog">{children}</div></Modal>;}
