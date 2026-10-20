import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareQuote, Trash2, X } from 'lucide-react';
import type { Annotation } from '../lib/types';
import { useConfirm } from './DialogProvider';

export type PageSize = { width: number; height: number };

type Props = {
  annotations: Annotation[];
  pageSizes: PageSize[];
  openIds: string[];
  focus: { id: string; nonce: number } | null;
  onSaveNote: (id: string, note: string) => void;
  onClearNote: (id: string) => void;
  onCloseEmpty: (id: string) => void;
  onSelect: (id: string) => void;
  onScrollTo: (annotation: Annotation) => void;
};

const PAGE_GAP = 22;

export function NotesRail({
  annotations,
  pageSizes,
  openIds,
  focus,
  onSaveNote,
  onClearNote,
  onCloseEmpty,
  onSelect,
  onScrollTo,
}: Props) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const elements = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);

  const setCardRef = useCallback((id: string) => {
    return (element: HTMLElement | null) => {
      const map = elements.current;
      const previous = map.get(id);
      if (previous && previous !== element) {
        observer.current?.unobserve(previous);
        map.delete(id);
      }
      if (element) {
        map.set(id, element);
        observer.current?.observe(element);
      }
    };
  }, []);

  useEffect(() => {
    const resize = new ResizeObserver((entries) => {
      setHeights((current) => {
        const next = { ...current };
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.noteId;
          if (!id) continue;
          const height = entry.contentRect.height;
          if (Math.abs((next[id] ?? 0) - height) > 0.5) {
            next[id] = height;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    observer.current = resize;
    elements.current.forEach((element) => resize.observe(element));
    return () => {
      resize.disconnect();
      observer.current = null;
    };
  }, []);

  const pageTops = useMemo(() => {
    const tops: number[] = [];
    let top = 0;
    for (const size of pageSizes) {
      tops.push(top);
      top += size.height + PAGE_GAP;
    }
    return tops;
  }, [pageSizes]);

  const totalHeight = pageTops.length
    ? pageTops[pageTops.length - 1] + (pageSizes[pageSizes.length - 1]?.height ?? 0)
    : 0;

  const cards = useMemo(() => {
    return annotations
      .filter((annotation) => annotation.note.trim().length > 0 || openIds.includes(annotation.id))
      .map((annotation) => {
        const pageHeight = pageSizes[annotation.page - 1]?.height ?? 0;
        const pageTop = pageTops[annotation.page - 1] ?? 0;
        const rect = annotation.rects[0];
        const anchor = pageTop + (rect ? rect.y * pageHeight : 0);
        return { annotation, anchor };
      })
      .sort((a, b) => a.anchor - b.anchor);
  }, [annotations, openIds, pageSizes, pageTops]);

  const positions = useMemo(() => {
    const result: Record<string, number> = {};
    let cursor = 24;
    for (const card of cards) {
      const top = Math.max(card.anchor, cursor);
      result[card.annotation.id] = top;
      cursor = top + (heights[card.annotation.id] ?? 96) + 7;
    }
    return result;
  }, [cards, heights]);

  return (
    <div className="notes-rail" style={{ minHeight: Math.max(totalHeight, 300) }}>
      <div className="notes-rail-head">
        <span>NOTES</span>
        <span>{cards.length}</span>
      </div>

      {cards.length === 0 && (
        <div className="notes-rail-empty">
          Double-click any highlight, underline or box to pin a note here. Notes align with their
          annotation.
        </div>
      )}

      {cards.map(({ annotation }) => (
        <NoteSticker
          key={annotation.id}
          annotation={annotation}
          top={positions[annotation.id] ?? 0}
          focusNonce={focus?.id === annotation.id ? focus.nonce : 0}
          setRef={setCardRef(annotation.id)}
          onSaveNote={onSaveNote}
          onClearNote={onClearNote}
          onCloseEmpty={onCloseEmpty}
          onSelect={onSelect}
          onScrollTo={onScrollTo}
        />
      ))}
    </div>
  );
}

type StickerProps = {
  annotation: Annotation;
  top: number;
  focusNonce: number;
  setRef: (element: HTMLElement | null) => void;
  onSaveNote: (id: string, note: string) => void;
  onClearNote: (id: string) => void;
  onCloseEmpty: (id: string) => void;
  onSelect: (id: string) => void;
  onScrollTo: (annotation: Annotation) => void;
};

function NoteSticker({
  annotation,
  top,
  focusNonce,
  setRef,
  onSaveNote,
  onClearNote,
  onCloseEmpty,
  onSelect,
  onScrollTo,
}: StickerProps) {
  const [value, setValue] = useState(annotation.note);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(annotation.note);
  const confirm = useConfirm();

  useEffect(() => {
    setValue(annotation.note);
    savedRef.current = annotation.note;
  }, [annotation.note]);

  useEffect(() => {
    if (value === savedRef.current) return;
    const timer = window.setTimeout(() => {
      savedRef.current = value;
      onSaveNote(annotation.id, value);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [value, annotation.id, onSaveNote]);

  useEffect(() => {
    if (!focusNonce) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    element.closest('.note-sticker')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusNonce]);

  const empty = annotation.note.trim().length === 0 && value.trim().length === 0;

  return (
    <div
      className="note-sticker"
      style={
        {
          top,
          '--note-color': annotation.color,
        } as React.CSSProperties
      }
      data-note-id={annotation.id}
      ref={setRef}
      onMouseDown={() => onSelect(annotation.id)}
    >
      <div className="note-head">
        <a
          className="note-label"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onScrollTo(annotation);
          }}
          title={`Jump to @${annotation.page}:${annotation.label}`}
        >
          @{annotation.page}:{annotation.label}
        </a>
        <span className="note-spacer" />
        {empty ? (
          <button title="Dismiss" onClick={() => onCloseEmpty(annotation.id)}>
            <X size={10} />
          </button>
        ) : (
          <button
            title="Clear note"
            onClick={async () => {
              const ok = await confirm({
                title: 'Clear note',
                message: 'Clear this note?',
                confirmLabel: 'CLEAR',
                danger: true,
              });
              if (ok) onClearNote(annotation.id);
            }}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {annotation.text && (
        <div className="note-quote" title={annotation.text}>
          {annotation.text}
        </div>
      )}

      <textarea
        ref={textarea}
        className="note-textarea"
        value={value}
        placeholder="Write a note…"
        spellCheck={false}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value !== savedRef.current) {
            savedRef.current = value;
            onSaveNote(annotation.id, value);
          }
        }}
      />
      <div className="note-foot">
        {value.trim() && value === savedRef.current ? (
          <span>
            <MessageSquareQuote size={8} style={{ verticalAlign: '-1px' }} /> saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
