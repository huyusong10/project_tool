import {useAppNavigate} from './use-app-navigation';
import {useResolvedPage} from './page-context';

export type {PathSource} from './page-foundation';

/** Only a source recorded by a path workspace identifies a contextual return. */
export function usePathReturn(){
  const page=useResolvedPage(),navigate=useAppNavigate(),target=page.back;
  return {label:target?.label || '返回项目路径',back:()=>{if(target?.kind==='history')navigate(-1);else navigate(target?.fallback || '/paths',{replace:true,state:null});}};
}
