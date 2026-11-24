// Keyboard support for elements that are clickable but not <button>s.

const onActivate = handler => e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handler(e);
  }
};

// For standalone controls (chips, tiles, nodes): a focusable button role.
export const clickable = handler => ({
  role: 'button',
  tabIndex: 0,
  onClick: handler,
  onKeyDown: onActivate(handler)
});

// For rows and headers: focusable and activatable, keeping their own semantics.
export const activatable = handler => ({
  tabIndex: 0,
  onClick: handler,
  onKeyDown: onActivate(handler)
});
