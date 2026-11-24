// Twenty distinguishable colors, none of them the error red.
const PALETTE = [
  '#2f7fd1',
  '#2a9d8f',
  '#8e5bd1',
  '#d17a2f',
  '#c2417e',
  '#4d9a3a',
  '#5b6bd1',
  '#a08a1c',
  '#2a8fb5',
  '#b5543a',
  '#7b8794',
  '#0f766e',
  '#9333ea',
  '#ca8a04',
  '#0e7490',
  '#be185d',
  '#65a30d',
  '#6d28d9',
  '#b45309',
  '#475569'
];

// Color from the name alone: stable, but two names can land on the same color.
export const hashColor = name => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

let assigned = new Map();

// Gives the names (busiest first) their own colors, one each, so the services
// of the workflow on screen never share one. More names than colors wrap
// around. Names not listed fall back to the hash color.
export const setColorOrder = names => {
  assigned = new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
};

// Color per service/system name, from setColorOrder when it listed the name.
export const colorFor = name => assigned.get(name) || hashColor(name);
