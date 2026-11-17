/** Minimal DOM builder: h('button.primary', { onclick }, 'Play'). */
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  props?: Props | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(' ');
  if (props instanceof Node || typeof props !== 'object' || props === null) {
    children.unshift(props as Child);
  } else {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'html') el.innerHTML = String(value);
      else if (key.startsWith('on') && typeof value === 'function')
        (el as unknown as Props)[key] = value;
      else if (key in el && key !== 'list') (el as unknown as Props)[key] = value;
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${fill ? 0 : 2.2}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  gear: svg(
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>',
  ),
  undo: svg('<path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h10a6 6 0 010 12h-3"/>'),
  hint: svg(
    '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.5.4.8 1 .8 1.7h5.6c0-.7.3-1.3.8-1.7A6 6 0 0012 3z"/>',
  ),
  xray: svg(
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  ),
  restart: svg('<path d="M4 12a8 8 0 108-8H7"/><path d="M10 1L7 4l3 3"/>'),
  heart: svg(
    '<path d="M12 20.5s-8-4.9-8-10.7A4.6 4.6 0 0112 7a4.6 4.6 0 018 2.8c0 5.8-8 10.7-8 10.7z"/>',
    true,
  ),
  star: svg(
    '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
    true,
  ),
  lock: svg(
    '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  ),
  launch: svg('<path d="M5 12h13M12.5 6l6 6-6 6"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
};

export function icon(name: keyof typeof ICONS, cls = ''): HTMLSpanElement {
  return h('span', { class: `icon ${cls}`, html: ICONS[name] });
}
