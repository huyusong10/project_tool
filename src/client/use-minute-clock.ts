import { useEffect, useState } from "react";

/** 让依赖当前时间的展示按分钟更新，并在重新聚焦页面时立即校准。 */
export function useMinuteClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow((current) => {
      const next = Date.now();
      return Math.floor(next / 60_000) === Math.floor(current / 60_000) ? current : next;
    });
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return now;
}
