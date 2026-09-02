import { createContext, useContext } from 'react';
import type { Project, Session } from './types';

export type AppContextValue = {
  session: Session;
  projects: Project[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  openLogin: () => void;
  openPassword: () => void;
};

export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('AppContext未初始化');
  return context;
}
