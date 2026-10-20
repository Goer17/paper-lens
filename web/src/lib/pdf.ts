import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

type TextItemLike = {
  str: string;
  width: number;
  transform: number[];
  hasEOL?: boolean;
};

type TextContentLike = {
  items: Array<TextItemLike | { type?: string; str?: string }>;
};

type ViewportLike = {
  transform: number[];
  scale: number;
};

export type RectCss = { x: number; y: number; w: number; h: number };

type ItemBox = RectCss & {
  str: string;
  fontHeight: number;
};

function itemBox(item: TextItemLike, viewport: ViewportLike): ItemBox | null {
  if (!item.str || !item.str.trim()) return null;
  const tx = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
  const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 1;
  const width = Math.max(0, item.width * viewport.scale);
  if (width <= 0) return null;
  return {
    x: tx[4],
    y: tx[5] - fontHeight,
    w: width,
    h: fontHeight,
    str: item.str,
    fontHeight,
  };
}

function intersects(a: RectCss, b: RectCss): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function itemsInRect(
  textContent: TextContentLike,
  viewport: ViewportLike,
  area: RectCss,
): ItemBox[] {
  const boxes: ItemBox[] = [];
  for (const raw of textContent.items) {
    const item = raw as TextItemLike;
    if (typeof item.str !== 'string') continue;
    const box = itemBox(item, viewport);
    if (box && intersects(box, area)) boxes.push(box);
  }
  return boxes;
}

/** Extracts the text captured by a box annotation. */
export function textInBox(
  textContent: TextContentLike,
  viewport: ViewportLike,
  area: RectCss,
): string {
  const boxes = itemsInRect(textContent, viewport, area);
  const sorted = [...boxes].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));
  const parts: string[] = [];
  let lastY: number | null = null;
  let lastRight = 0;
  for (const box of sorted) {
    if (lastY !== null && Math.abs(lastY - box.y) > Math.max(2, box.fontHeight * 0.6)) {
      parts.push('\n');
      lastRight = 0;
    } else if (lastRight && box.x - lastRight > 2) {
      parts.push(' ');
    }
    parts.push(box.str);
    lastY = box.y;
    lastRight = box.x + box.w;
  }
  return parts.join('').replace(/[ \t]+/g, ' ').trim();
}

export function cropPageImage(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): string | null {
  const sx = Math.max(0, Math.round(rect.x * canvas.width));
  const sy = Math.max(0, Math.round(rect.y * canvas.height));
  const sw = Math.min(canvas.width - sx, Math.round(rect.w * canvas.width));
  const sh = Math.min(canvas.height - sy, Math.round(rect.h * canvas.height));
  if (sw < 4 || sh < 4) return null;

  const output = document.createElement('canvas');
  output.width = sw;
  output.height = sh;
  const context = output.getContext('2d');
  if (!context) return null;
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return output.toDataURL('image/png');
}

export function normalizeRects(rects: RectCss[], width: number, height: number) {
  return rects.map((rect) => ({
    x: Math.max(0, Math.min(1, rect.x / width)),
    y: Math.max(0, Math.min(1, rect.y / height)),
    w: Math.max(0, Math.min(1, rect.w / width)),
    h: Math.max(0, Math.min(1, rect.h / height)),
  }));
}
