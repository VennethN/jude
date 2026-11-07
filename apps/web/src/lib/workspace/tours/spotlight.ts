export type Box = { x: number; y: number; w: number; h: number };
export type Placement = {
  x: number;
  y: number;
  side: 'top' | 'bottom' | 'left' | 'right' | 'center';
  caret: number;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

export function firstVisible(selector: string): HTMLElement | undefined {
  for (const choice of selector.split(',')) {
    const match = [...document.querySelectorAll<HTMLElement>(choice)].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    });
    if (match) return match;
  }
  return undefined;
}

function readBounds(target: HTMLElement) {
  const viewportHeight = window.visualViewport?.height ?? innerHeight;
  let left = 4,
    top = 4,
    right = innerWidth - 4,
    bottom = viewportHeight - 4;
  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const css = getComputedStyle(parent),
      rect = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
  }
  if (!target.closest('dialog') && target.closest('main')) {
    const topbar = firstVisible('.desk .topbar');
    if (topbar) top = Math.max(top, topbar.getBoundingClientRect().bottom + 3);
    for (const nav of document.querySelectorAll<HTMLElement>('.desk .phone-nav, .desk .session-strip')) {
      const r = nav.getBoundingClientRect();
      if (r.width && r.bottom > viewportHeight - 155 && r.top > viewportHeight / 2)
        bottom = Math.min(bottom, r.top - 3);
      if (r.width && r.top >= 0 && r.top < top + 6) top = Math.max(top, r.bottom + 3);
    }
  }
  return { left, top, right, bottom };
}

export function litArea(target: HTMLElement, cardHeight: number): Box | null {
  const r = target.getBoundingClientRect(),
    v = readBounds(target);
  const phone = innerWidth < 720;
  const x = Math.max(v.left, r.left - 6),
    y = Math.max(v.top, r.top - 6);
  const w = Math.min(v.right, r.right + 6) - x;
  const visibleHeight = Math.min(v.bottom, r.bottom + 6) - y;
  // A long timeline or register is lit where its content is actually in view.
  const h = Math.min(visibleHeight, phone ? Math.max(42, innerHeight - cardHeight - 58) : innerHeight * 0.7);
  return w > 1 && h > 1 ? { x, y, w, h } : null;
}

export function reveal(target: HTMLElement) {
  const rect = target.getBoundingClientRect(),
    bounds = readBounds(target);
  const height = bounds.bottom - bounds.top;
  if (rect.top >= bounds.top && Math.min(rect.bottom, rect.top + Math.min(rect.height, 160)) <= bounds.bottom)
    return;
  target.scrollIntoView({
    block: rect.height < height * 0.58 ? 'center' : 'start',
    inline: 'nearest',
    behavior: 'instant',
  });
}

export function placeCard(box: Box | null, width: number, height: number): Placement {
  const vw = innerWidth,
    vh = window.visualViewport?.height ?? innerHeight;
  const phone = vw < 720,
    pad = phone ? 12 : 16,
    gap = 15;
  const fitX = (v: number) => clamp(v, pad, vw - width - pad);
  const fitY = (v: number) => clamp(v, pad, vh - height - pad);
  if (!box) return { x: fitX((vw - width) / 2), y: fitY((vh - height) / 2), side: 'center', caret: 0 };
  const middleX = box.x + box.w / 2,
    middleY = box.y + box.h / 2;
  const above = box.y - pad,
    below = vh - box.y - box.h - pad;
  const right = vw - box.x - box.w - pad,
    left = box.x - pad;
  let side: Placement['side'];
  if (!phone && right >= width + gap && box.w < vw * 0.48) side = 'right';
  else if (!phone && left >= width + gap && box.w < vw * 0.48) side = 'left';
  else side = below >= height + gap || below >= above ? 'bottom' : 'top';
  const horizontal = side === 'left' || side === 'right';
  const x = phone
    ? pad
    : fitX(horizontal ? (side === 'right' ? box.x + box.w + gap : box.x - width - gap) : middleX - width / 2);
  const y = fitY(
    horizontal
      ? middleY - height / 2
      : side === 'bottom'
        ? phone
          ? vh - height - pad
          : box.y + box.h + gap
        : phone
          ? pad
          : box.y - height - gap
  );
  return {
    x,
    y,
    side,
    caret: horizontal ? clamp(middleY - y, 22, height - 22) : clamp(middleX - x, 22, width - 22),
  };
}
