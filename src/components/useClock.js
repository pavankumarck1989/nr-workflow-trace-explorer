import { useEffect, useState } from 'react';

// Current time that advances every `everyMs` while the page is visible, so ages
// and idle times keep counting without reloading any data.
export default function useClock(everyMs = 10000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
