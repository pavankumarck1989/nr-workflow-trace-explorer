import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

// navigator.clipboard is often blocked inside the platform's frame (it rejects,
// or is missing), so fall back to selecting a hidden textarea and copying.
export async function copyText(text) {
  const value = String(text);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) {
    // fall through to the textarea route
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

// A text button that copies `text` and says whether it worked.
export default function CopyButton({ text, label = 'copy', className = '', title = 'Copy' }) {
  const [state, setState] = useState(null); // null | 'ok' | 'fail'
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async e => {
    e.stopPropagation();
    const ok = await copyText(typeof text === 'function' ? text() : text);
    setState(ok ? 'ok' : 'fail');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 1500);
  };
  return (
    <button type="button" className={`wte-linkbtn ${className}`} title={title} onClick={onClick}>
      {state === 'ok' ? 'copied' : state === 'fail' ? 'copy failed' : label}
    </button>
  );
}

CopyButton.propTypes = {
  text: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.func]).isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
  title: PropTypes.string
};
