import { useEffect, useState } from 'react';

const luminance = css => {
  const m = String(css).match(/[\d.]+/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

// 'dark' when the page text colour is light, which is how the platform's dark
// theme shows up. Re-checks when the platform changes its theme.
export default function useTheme(ref) {
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    const detect = () => {
      if (ref.current)
        setTheme(luminance(getComputedStyle(ref.current).color) > 150 ? 'dark' : 'light');
    };
    detect();
    const mo = new MutationObserver(detect);
    [document.documentElement, document.body].forEach(n => mo.observe(n, { attributes: true }));
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', detect);
    return () => {
      mo.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', detect);
    };
  }, [ref]);
  return theme;
}
