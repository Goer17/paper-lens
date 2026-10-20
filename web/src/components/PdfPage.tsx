import { useEffect, useRef, useState } from 'react';
import {
  TextLayer,
  type PDFDocumentProxy,
  type PageViewport,
} from 'pdfjs-dist';
import { LoaderCircle, StickyNote, Trash2 } from 'lucide-react';
import type { Annotation, Rect } from '../lib/types';
import {
  cropPageImage,
  normalizeRects,
  textInBox,
  type RectCss,
} from '../lib/pdf';
import { ANNOTATION_COLORS, type Tool } from '../lib/constants';

type TextContentLike = { items: unknown[] };

export type AnnotationDraft = {
  type: 'highlight' | 'underline' | 'box';
  page: number;
  color: string;
  rects: Rect[];
  text: string;
  image_data_url?: string;
};

type Props = {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
  tool: Tool;
  color: string;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (draft: AnnotationDraft) => void;
  onDelete: (id: string) => void;
  onUpdateColor: (id: string, color: string) => void;
  onOpenNote: (id: string) => void;
  onHoverAnnotation: (annotation: Annotation, event: React.MouseEvent) => void;
  onMoveAnnotation: (event: React.MouseEvent) => void;
  onLeaveAnnotation: () => void;
  registerPage: (page: number, element: HTMLDivElement | null) => void;
};

type DrawState = { x0: number; y0: number; x1: number; y1: number };

export function PdfPage({
  document,
  pageNumber,
  scale,
  width,
  height,
  tool,
  color,
  annotations,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  onUpdateColor,
  onOpenNote,
  onHoverAnnotation,
  onMoveAnnotation,
  onLeaveAnnotation,
  registerPage,
}: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayerContainer = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const textContent = useRef<TextContentLike | null>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const [near, setNear] = useState(pageNumber <= 6);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [drawing, setDrawing] = useState<DrawState | null>(null);
  const drawRef = useRef<DrawState | null>(null);

  useEffect(() => {
    const element = wrapper.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    registerPage(pageNumber, wrapper.current);
    return () => registerPage(pageNumber, null);
  }, [pageNumber, registerPage]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: TextLayer | null = null;

    (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        viewportRef.current = viewport;

        const target = canvas.current;
        if (!target) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const context = target.getContext('2d');
        if (!context) return;
        target.width = Math.floor(viewport.width * ratio);
        target.height = Math.floor(viewport.height * ratio);
        target.style.width = '100%';
        target.style.height = '100%';

        const task = page.render({
          canvasContext: context,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        renderTask = task as unknown as { cancel: () => void; promise: Promise<void> };
        await task.promise;
        if (cancelled) return;

        const content = (await page.getTextContent()) as unknown as TextContentLike;
        if (cancelled) return;
        textContent.current = content;

        const container = textLayerContainer.current;
        if (container) {
          container.innerHTML = '';
          container.style.setProperty('--scale-factor', String(viewport.scale));
          container.style.width = `${viewport.width}px`;
          container.style.height = `${viewport.height}px`;
          textLayer = new TextLayer({
            textContentSource: content as never,
            container,
            viewport,
          });
          await textLayer.render();
        }
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'RenderingCancelledException') {
          setError((err as Error).message || 'Could not render this page.');
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore
      }
      try {
        textLayer?.cancel();
      } catch {
        // ignore
      }
      textContent.current = null;
    };
  }, [document, pageNumber, scale, near]);

  function pointerPoint(event: React.PointerEvent): { x: number; y: number; rect: DOMRect } | null {
    const element = overlay.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      rect,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'box' || event.button !== 0) return;
    const point = pointerPoint(event);
    if (!point) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const state = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    drawRef.current = state;
    setDrawing(state);
    onSelect(null);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'box' || !drawRef.current) return;
    const point = pointerPoint(event);
    if (!point) return;
    const next = { ...drawRef.current, x1: point.x, y1: point.y };
    drawRef.current = next;
    setDrawing(next);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'box') return;
    const state = drawRef.current;
    drawRef.current = null;
    setDrawing(null);
    if (!state) return;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    const area: RectCss = {
      x: Math.min(state.x0, state.x1),
      y: Math.min(state.y0, state.y1),
      w: Math.abs(state.x1 - state.x0),
      h: Math.abs(state.y1 - state.y0),
    };
    if (area.w < 5 || area.h < 5) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const content = textContent.current;
    const text = content ? textInBox(content as never, viewport, area) : '';
    const image = canvas.current
      ? cropPageImage(canvas.current, {
          x: area.x / viewport.width,
          y: area.y / viewport.height,
          w: area.w / viewport.width,
          h: area.h / viewport.height,
        })
      : null;
    onCreate({
      type: 'box',
      page: pageNumber,
      color,
      rects: normalizeRects([area], viewport.width, viewport.height),
      text: text.slice(0, 10_000),
      image_data_url: image ?? undefined,
    });
  }

  const drawRect = drawing
    ? {
        left: Math.min(drawing.x0, drawing.x1),
        top: Math.min(drawing.y0, drawing.y1),
        width: Math.abs(drawing.x1 - drawing.x0),
        height: Math.abs(drawing.y1 - drawing.y0),
      }
    : null;

  return (
    <div
      className="page-shell"
      ref={wrapper}
      style={{ width, height }}
      data-page={pageNumber}
      onMouseDown={(event) => {
        if (event.target === wrapper.current) onSelect(null);
      }}
    >
      <canvas ref={canvas} className="page-canvas" />
      {!ready && !error && (
        <div className="page-placeholder">
          <LoaderCircle size={13} className="spin-icon" />
          PAGE {pageNumber}
        </div>
      )}
      {error && <div className="page-placeholder">{error}</div>}

      <div className="text-layer" ref={textLayerContainer} />

      <div
        ref={overlay}
        className={`ann-layer ${tool === 'box' ? 'drawing-mode' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drawRef.current = null;
          setDrawing(null);
        }}
      >
        {annotations.map((annotation) =>
          annotation.rects.map((rect, index) => {
            const selected = selectedId === annotation.id;
            const isFirst = index === 0;
            return (
              <div
                key={`${annotation.id}-${index}`}
                className={`annotation type-${annotation.type} ${selected ? 'selected' : ''}`}
                style={
                  {
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                    '--ann-color': annotation.color,
                  } as React.CSSProperties
                }
                data-annotation-label={annotation.label}
                draggable={tool === 'select'}
                onMouseEnter={(event) => onHoverAnnotation(annotation, event)}
                onMouseMove={onMoveAnnotation}
                onMouseLeave={onLeaveAnnotation}
                onDragStart={(event) => {
                  onLeaveAnnotation();
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(
                    'application/x-annotation',
                    JSON.stringify({
                      id: annotation.id,
                      label: annotation.label,
                      page: annotation.page,
                      type: annotation.type,
                      text: annotation.text,
                    }),
                  );
                  event.dataTransfer.setData('text/plain', `@${annotation.page}:${annotation.label}`);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(annotation.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onSelect(annotation.id);
                  onOpenNote(annotation.id);
                }}
              >
                {selected && isFirst && (
                  <div
                    className="ann-toolbar"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {ANNOTATION_COLORS.map((option) => (
                      <button
                        key={option.value}
                        className="mini-color"
                        style={{ background: option.value }}
                        title={`Recolour ${option.name}`}
                        draggable={false}
                        onClick={() => onUpdateColor(annotation.id, option.value)}
                      />
                    ))}
                    <span
                      style={{
                        width: 1,
                        height: 13,
                        background: 'var(--border)',
                        margin: '0 1px',
                      }}
                    />
                    <button
                      title="Add note"
                      onClick={() => onOpenNote(annotation.id)}
                      draggable={false}
                    >
                      <StickyNote size={11} />
                    </button>
                    <button
                      className="danger"
                      title="Delete annotation"
                      draggable={false}
                      onClick={() => onDelete(annotation.id)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          }),
        )}

        {drawRect && <div className="draw-box" style={drawRect} />}
      </div>

      <span className="page-number-tag">{pageNumber}</span>
    </div>
  );
}
