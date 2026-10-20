import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Sparkles,
  SquareDashed,
  StickyNote,
  Underline,
} from 'lucide-react';
import type { Annotation, Paper } from '../lib/types';
import { getToken } from '../lib/api';
import { pdfjs } from '../lib/pdf';
import { ANNOTATION_COLORS, type Tool } from '../lib/constants';
import { PdfPage, type AnnotationDraft } from './PdfPage';
import { readPageTextSelection, type PageTextSelection } from '../lib/selection';
import { NotesRail, type PageSize } from './NotesRail';

type Props = {
  paper: Paper;
  annotations: Annotation[];
  notesOpen: boolean;
  chatOpen: boolean;
  focusCitation: { label: string; nonce: number } | null;
  onToggleNotes: (open: boolean) => void;
  onToggleChat: () => void;
  onCreateAnnotation: (draft: AnnotationDraft) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onUpdateColor: (id: string, color: string) => Promise<void>;
  onSaveNote: (id: string, note: string) => Promise<void>;
  onNotice: (message: string) => void;
};

type BasePage = { width: number; height: number };

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'highlight',
  u: 'underline',
  b: 'box',
};

export function Reader({
  paper,
  annotations,
  notesOpen,
  chatOpen,
  focusCitation,
  onToggleNotes,
  onToggleChat,
  onCreateAnnotation,
  onDeleteAnnotation,
  onUpdateColor,
  onSaveNote,
  onNotice,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [basePages, setBasePages] = useState<BasePage[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [containerWidth, setContainerWidth] = useState(900);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(ANNOTATION_COLORS[0].value);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  const [hoverLabel, setHoverLabel] = useState<{
    label: string;
    page: number;
    color: string;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoverPoint = useRef({ x: 0, y: 0 });
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  const [noteFocus, setNoteFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<PageTextSelection | null>(null);
  const scrollFrame = useRef<number | null>(null);

  // Load the PDF document for the active paper.
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setLoading(true);
    setLoadError('');
    setBasePages([]);
    setDocument(null);
    setSelectedId(null);
    setSelectionMenu(null);
    clearHover();
    setCurrentPage(1);
    setPageInput('1');
    setOpenNoteIds([]);
    setZoom(1);

    const task = pdfjs.getDocument({
      url: `/api/papers/${paper.id}/file`,
      httpHeaders: { Authorization: `Bearer ${getToken()}` },
      withCredentials: false,
    });

    task.promise
      .then(async (pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        loaded = pdf;
        const pages = await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, index) => {
            const page = await pdf.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }),
        );
        if (cancelled) return;
        setDocument(pdf);
        setBasePages(pages);
        setLoading(false);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setLoadError(error.message || 'Could not load this PDF.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
      else void task.destroy();
    };
  }, [paper.id]);

  // Track the width available for the page canvas. Measuring on every render
  // keeps the page fitted when the sidebar, notes rail, or AI panel changes size.
  const measureWidth = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const style = window.getComputedStyle(element);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    setContainerWidth(Math.max(220, element.clientWidth - padding));
  }, []);

  useLayoutEffect(() => {
    measureWidth();
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measureWidth());
    observer.observe(element);
    window.addEventListener('resize', measureWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureWidth);
    };
  }, [measureWidth]);

  const maxBaseWidth = useMemo(
    () => Math.max(1, ...basePages.map((page) => page.width)),
    [basePages],
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const update = () => setIsNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const railSpace = notesOpen && !isNarrow ? 270 : 0;
  const availableWidth = Math.max(280, containerWidth - railSpace - 2);
  const scale = Math.min(4, Math.max(0.25, (availableWidth / maxBaseWidth) * zoom));
  const pageSizes: PageSize[] = useMemo(
    () => basePages.map((page) => ({ width: page.width * scale, height: page.height * scale })),
    [basePages, scale],
  );

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (element) pageElements.current.set(page, element);
    else pageElements.current.delete(page);
  }, []);

  const goToPage = useCallback(
    (page: number, behavior: ScrollBehavior = 'smooth') => {
      const total = docPages(document);
      const target = Math.min(Math.max(1, page), Math.max(1, total));
      pageElements.current.get(target)?.scrollIntoView({ block: 'start', behavior });
      setCurrentPage(target);
      setPageInput(String(target));
    },
    [document],
  );

  const scrollToAnnotation = useCallback(
    (label: string) => {
      const annotation = annotations.find((item) => item.label === label);
      if (!annotation) {
        onNotice(`Annotation @${label} was not found.`);
        return;
      }
      setSelectedId(annotation.id);
      goToPage(annotation.page);
      const reveal = () => {
        const container = scrollRef.current;
        const element = container?.querySelector<HTMLElement>(
          `[data-annotation-label="${annotation.label}"]`,
        );
        if (!element) return false;
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        element.classList.add('flash');
        window.setTimeout(() => element.classList.remove('flash'), 1700);
        return true;
      };
      window.setTimeout(() => {
        if (!reveal()) window.setTimeout(reveal, 700);
      }, 350);
    },
    [annotations, goToPage, onNotice],
  );

  useEffect(() => {
    if (focusCitation) scrollToAnnotation(focusCitation.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCitation?.nonce]);

  // Track the page currently in view.
  function onScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = scrollRef.current;
      if (!container) return;
      setSelectionMenu(null);
      clearHover();
      const top = container.getBoundingClientRect().top;
      let visible = 1;
      pageElements.current.forEach((element, page) => {
        const rect = element.getBoundingClientRect();
        if (rect.top - top <= 120) visible = Math.max(visible, page);
      });
      setCurrentPage(visible);
      setPageInput(String(visible));
    });
  }

  // Turn a native text selection into an annotation. Highlight / underline
  // modes apply immediately; Select mode opens a small action menu.
  useEffect(() => {
    function onMouseUp(event: MouseEvent) {
      if (event.button !== 0) return;
      if (tool === 'box') return;
      const target = event.target as Element | null;
      if (!target?.closest?.('.text-layer')) return;

      window.setTimeout(() => {
        const container = scrollRef.current;
        if (!container) return;
        const selection = readPageTextSelection(container);
        if (!selection) {
          if (tool === 'select') setSelectionMenu(null);
          return;
        }
        if (tool === 'select') {
          setSelectionMenu(selection);
          return;
        }
        setSelectionMenu(null);
        void createAnnotation({
          type: tool,
          page: selection.page,
          color,
          rects: selection.rects,
          text: selection.text,
        });
        window.getSelection()?.removeAllRanges();
      }, 0);
    }
    window.document.addEventListener('mouseup', onMouseUp);
    return () => window.document.removeEventListener('mouseup', onMouseUp);
  }, [tool, color, createAnnotation]);

  useEffect(() => {
    if (!selectionMenu) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest('.selection-menu')) return;
      setSelectionMenu(null);
    }
    window.document.addEventListener('pointerdown', onPointerDown, true);
    return () => window.document.removeEventListener('pointerdown', onPointerDown, true);
  }, [selectionMenu]);

  function applySelection(type: 'highlight' | 'underline') {
    const selection = selectionMenu;
    if (!selection) return;
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    void createAnnotation({
      type,
      page: selection.page,
      color,
      rects: selection.rects,
      text: selection.text,
    });
  }

  // Keyboard shortcuts for tools.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (TOOL_KEYS[key]) {
        setTool(TOOL_KEYS[key]);
        event.preventDefault();
      } else if (key === 'escape') {
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function createAnnotation(draft: AnnotationDraft) {
    try {
      await onCreateAnnotation(draft);
      // Return to selection mode so the new annotation can be clicked or
      // double-clicked immediately (Zotero-like behaviour).
      setTool('select');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not save annotation.');
    }
  }

  function openNote(id: string) {
    setSelectedId(id);
    setOpenNoteIds((current) => (current.includes(id) ? current : [...current, id]));
    if (!notesOpen) onToggleNotes(true);
    setNoteFocus({ id, nonce: Date.now() });
  }

  function clearNote(id: string) {
    setOpenNoteIds((current) => current.filter((value) => value !== id));
    void onSaveNote(id, '');
  }

  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.page === currentPage),
    [annotations, currentPage],
  );

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverLabel(null);
  }, []);

  const hoverAnnotation = useCallback(
    (annotation: Annotation, event: React.MouseEvent) => {
      hoverPoint.current = { x: event.clientX, y: event.clientY };
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      setHoverLabel(null);
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        setHoverLabel({
          label: annotation.label,
          page: annotation.page,
          color: annotation.color,
          x: hoverPoint.current.x,
          y: hoverPoint.current.y,
        });
      }, 500);
    },
    [],
  );

  const moveAnnotation = useCallback((event: React.MouseEvent) => {
    hoverPoint.current = { x: event.clientX, y: event.clientY };
    setHoverLabel((current) =>
      current ? { ...current, x: event.clientX, y: event.clientY } : current,
    );
  }, []);

  const leaveAnnotation = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverLabel(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  // Clicking anywhere outside an annotation clears the blue selection ring and
  // dismisses any hover tooltip.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target?.closest?.('.annotation')) setSelectedId(null);
      clearHover();
    }
    window.document.addEventListener('pointerdown', onPointerDown, true);
    return () => window.document.removeEventListener('pointerdown', onPointerDown, true);
  }, [clearHover]);

  const totalPages = docPages(document);
  const zoomLabel = `${Math.round(scale * 100)}%`;

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="paper-heading">
          <span className="title" title={paper.title}>
            {paper.title}
          </span>
          <span className="sub">
            {paper.pages} PAGES · {annotations.length} ANNOTATIONS
          </span>
        </div>

        <div className="tool-group" title="Annotation tools (V / H / U / B)">
          <button
            className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
            onClick={() => setTool('select')}
            title="Select text / drag citations (V)"
          >
            <MousePointer2 size={13} />
          </button>
          <button
            className={`tool-btn ${tool === 'highlight' ? 'active' : ''}`}
            onClick={() => setTool('highlight')}
            title="Highlight selected text (H)"
          >
            <Highlighter size={13} />
          </button>
          <button
            className={`tool-btn ${tool === 'underline' ? 'active' : ''}`}
            onClick={() => setTool('underline')}
            title="Underline selected text (U)"
          >
            <Underline size={13} />
          </button>
          <button
            className={`tool-btn ${tool === 'box' ? 'active' : ''}`}
            onClick={() => setTool('box')}
            title="Draw a box around a figure or equation (B)"
          >
            <SquareDashed size={13} />
          </button>
        </div>

        <div className="color-group">
          {ANNOTATION_COLORS.map((option) => (
            <button
              key={option.value}
              className={`color-dot ${color === option.value ? 'active' : ''}`}
              style={{ background: option.value }}
              title={option.name}
              onClick={() => setColor(option.value)}
            />
          ))}
        </div>

        <div className="tool-sep" />

        <div className="zoom-group">
          <button className="icon-btn" onClick={() => setZoom((value) => Math.max(0.4, value / 1.1))} title="Zoom out">
            <Minus size={13} />
          </button>
          <span className="zoom-value">{zoomLabel}</span>
          <button className="icon-btn" onClick={() => setZoom((value) => Math.min(3, value * 1.1))} title="Zoom in">
            <Plus size={13} />
          </button>
          <button className="icon-btn" onClick={() => setZoom(1)} title="Fit width">
            <Maximize2 size={12} />
          </button>
        </div>

        <div className="tool-sep" />

        <div className="page-nav">
          <button className="icon-btn" onClick={() => goToPage(currentPage - 1)} title="Previous page">
            <ChevronLeft size={13} />
          </button>
          <input
            className="page-input"
            value={pageInput}
            inputMode="numeric"
            onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToPage(Number(pageInput) || currentPage);
            }}
            onBlur={() => goToPage(Number(pageInput) || currentPage)}
            aria-label="Page number"
          />
          <span className="page-total">/ {totalPages}</span>
          <button className="icon-btn" onClick={() => goToPage(currentPage + 1)} title="Next page">
            <ChevronRight size={13} />
          </button>
        </div>

        <div className="reader-spacer" />

        <button
          className={`icon-btn ${notesOpen ? 'active' : ''}`}
          onClick={() => onToggleNotes(!notesOpen)}
          title="Toggle notes rail"
        >
          <StickyNote size={14} />
        </button>
        <button
          className={`icon-btn ${chatOpen ? 'active' : ''}`}
          onClick={onToggleChat}
          title="Toggle AI assistant"
        >
          <Sparkles size={14} />
        </button>
      </div>

      <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
        {loading && (
          <div className="loading-panel">
            <span className="spinner" /> LOADING PDF…
          </div>
        )}
        {loadError && (
          <div className="loading-panel" style={{ color: 'var(--danger)' }}>
            {loadError}
          </div>
        )}

        {document && (
          <div className="pages-row">
            <div className="pages-col">
              {pageSizes.map((size, index) => (
                <PdfPage
                  key={index + 1}
                  document={document}
                  pageNumber={index + 1}
                  scale={scale}
                  width={size.width}
                  height={size.height}
                  tool={tool}
                  color={color}
                  annotations={annotations.filter((annotation) => annotation.page === index + 1)}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onCreate={(draft) => void createAnnotation(draft)}
                  onDelete={(id) => void onDeleteAnnotation(id)}
                  onUpdateColor={(id, value) => void onUpdateColor(id, value)}
                  onOpenNote={openNote}
                  onHoverAnnotation={hoverAnnotation}
                  onMoveAnnotation={moveAnnotation}
                  onLeaveAnnotation={leaveAnnotation}
                  registerPage={registerPage}
                />
              ))}
            </div>

            {notesOpen && !isNarrow && (
              <NotesRail
                annotations={annotations}
                pageSizes={pageSizes}
                openIds={openNoteIds}
                focus={noteFocus}
                onSaveNote={(id, note) => void onSaveNote(id, note)}
                onClearNote={clearNote}
                onCloseEmpty={(id) =>
                  setOpenNoteIds((current) => current.filter((value) => value !== id))
                }
                onSelect={setSelectedId}
                onScrollTo={(annotation) => {
                  setSelectedId(annotation.id);
                  openNote(annotation.id);
                  scrollToAnnotation(annotation.label);
                }}
              />
            )}
          </div>
        )}
      </div>

      {tool !== 'select' && (
        <div className="tool-hint">
          {tool === 'box'
            ? 'DRAG ON THE PAGE TO BOX · ESC TO DESELECT'
            : `SELECT TEXT TO ${tool.toUpperCase()} · ESC TO DESELECT`}
        </div>
      )}

      {hoverLabel && (
        <div
          className="annotation-hover"
          style={{
            left: Math.max(8, Math.min(hoverLabel.x + 14, window.innerWidth - 190)),
            top: Math.min(hoverLabel.y + 16, window.innerHeight - 36),
          }}
        >
          <span className="annotation-hover-dot" style={{ background: hoverLabel.color }} />
          @{hoverLabel.page}:{hoverLabel.label}
        </div>
      )}

      {selectionMenu && (
        <div
          className="selection-menu"
          style={{
            left: Math.max(8, Math.min(selectionMenu.anchor.x - 78, window.innerWidth - 236)),
            top: Math.min(selectionMenu.anchor.y + 8, window.innerHeight - 58),
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span className="selection-colors">
            {ANNOTATION_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`color-dot ${color === option.value ? 'active' : ''}`}
                style={{ background: option.value }}
                title={option.name}
                onClick={() => setColor(option.value)}
              />
            ))}
          </span>
          <span className="selection-sep" />
          <button type="button" className="selection-action" onClick={() => applySelection('highlight')}>
            <Highlighter size={11} /> HIGHLIGHT
          </button>
          <button type="button" className="selection-action" onClick={() => applySelection('underline')}>
            <Underline size={11} /> UNDERLINE
          </button>
        </div>
      )}
      <span className="sr-only">{pageAnnotations.length} annotations on the current page</span>
    </div>
  );
}

function docPages(document: PDFDocumentProxy | null): number {
  return document?.numPages ?? 0;
}
