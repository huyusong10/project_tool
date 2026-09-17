import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { todayIso } from '../../shared/domain';
import { invalidateBusinessDateViews } from '../query-keys';

export function useBusinessDateClock() {
  const client = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const previous = useRef(date);
  useEffect(() => {
    const refresh = () => setDate(current => { const next = todayIso(); return next === current ? current : next; });
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    if (previous.current === date) return;
    previous.current = date;
    invalidateBusinessDateViews(client);
  }, [date, client]);
  return date;
}
