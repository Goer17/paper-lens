import { normalizeRects, type RectCss } from './pdf';
import type { Rect } from './types';

export type PageTextSelection = {
  page: number;
  rects: Rect[];
  text: string;
  anchor: { x: number; y: number };
};

function mergeLineRects(rects: RectCss[]): RectCss[] {
  const sorted = [...rects].sort((a, b) =>
    Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x,
  );
  const lines: RectCss[] = [];
  for (const rect of sorted) {
    const last = lines[lines.length - 1];
    const sameLine =
      last &&
      Math.abs(last.y - rect.y) <= Math.max(2, Math.min(last.h, rect.h) * 0.5) &&
      rect.x <= last.x + last.w + 6;
    if (sameLine) {
      const right = Math.max(last.x + last.w, rect.x + rect.w);
      const bottom = Math.max(last.y + last.h, rect.y + rect.h);
      last.x = Math.min(last.x, rect.x);
      last.y = Math.min(last.y, rect.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else {
      lines.push({ ...rect });
    }
  }
  return lines;
}

/**
 * Reads the current native text selection and maps it to the page being read.
 * Only selections that start inside a PDF text layer are accepted, so selecting
 * the surrounding UI never creates an annotation.
 */
export function readPageTextSelection(container: HTMLElement): PageTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const anchorNode = selection.anchorNode;
  if (!anchorNode) return null;
  const anchorElement =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode.parentElement;
  if (!anchorElement?.closest('.text-layer')) return null;

  const pageElement = anchorElement.closest('.page-shell') as HTMLElement | null;
  if (!pageElement || !container.contains(pageElement)) return null;

  const text = selection
    .toString()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!text) return null;

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width < 2 || pageRect.height < 2) return null;

  const range = selection.getRangeAt(0);
  const raw: RectCss[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 2 || rect.height < 2) continue;
    if (
      rect.right < pageRect.left ||
      rect.left > pageRect.right ||
      rect.bottom < pageRect.top ||
      rect.top > pageRect.bottom
    ) {
      continue;
    }
    const left = Math.max(rect.left, pageRect.left) - pageRect.left;
    const top = Math.max(rect.top, pageRect.top) - pageRect.top;
    const right = Math.min(rect.right, pageRect.right) - pageRect.left;
    const bottom = Math.min(rect.bottom, pageRect.bottom) - pageRect.top;
    if (right - left < 2 || bottom - top < 2) continue;
    raw.push({ x: left, y: top, w: right - left, h: bottom - top });
  }
  if (!raw.length) return null;

  const merged = mergeLineRects(raw);
  const last = merged[merged.length - 1];
  return {
    page: Number(pageElement.dataset.page),
    rects: normalizeRects(merged, pageRect.width, pageRect.height),
    text: text.slice(0, 20_000),
    anchor: {
      x: pageRect.left + last.x + last.w,
      y: pageRect.top + last.y + last.h,
    },
  };
}
