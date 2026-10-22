// Tiny DOM helpers (no framework).

type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | number | boolean | undefined> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : String(c));
  }
  return e;
}

export function button(label: string, onClick: (e: MouseEvent) => void,
  attrs: Record<string, string | undefined> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'btn', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function panel(title: string, ...body: Child[]): { root: HTMLElement; head: HTMLElement; body: HTMLElement } {
  const head = el('header', { class: 'panel-head' }, el('h2', {}, title));
  const b = el('div', { class: 'panel-body' }, ...body);
  const root = el('section', { class: 'panel' }, head, b);
  return { root, head, body: b };
}

let facilityPrefix = 'PROD';
/** Set from the engine profile (facilities are productions: PROD01..PROD32). */
export function setFacilityPrefix(p: string | undefined) { if (p) facilityPrefix = p; }
export const fmtF = (f: number) => `${facilityPrefix}${String(f + 1).padStart(2, '0')}`;

export function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
