import { useEffect, useRef, useState } from 'react';
import {
  LoaderCircle,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { Annotation, ChatMessage, Citation, Paper, ToolTrace } from '../lib/types';
import { api, streamChat } from '../lib/api';
import { Markdown } from './Markdown';
import { useConfirm } from './DialogProvider';

type Props = {
  paper: Paper;
  annotations: Annotation[];
  onClose: () => void;
  onCitationClick: (label: string, page: number) => void;
  onNotice: (message: string) => void;
};

const SUGGESTIONS = [
  'Summarize this paper in five bullet points.',
  'What problem does this work solve, and how?',
  'Explain the method in simple terms.',
  'What are the limitations and open questions?',
];

function toCitation(annotation: Annotation): Citation {
  return {
    id: annotation.id,
    label: annotation.label,
    page: annotation.page,
    type: annotation.type,
    text: annotation.text,
    note: annotation.note,
    imageName: annotation.image_name,
  };
}

export function ChatPanel({ paper, annotations, onClose, onCitationClick, onNotice }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [modelLabel, setModelLabel] = useState('');
  const [warning, setWarning] = useState('');
  const [streamError, setStreamError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    setCitations([]);
    setInput('');
    setWarning('');
    setStreamError('');
    setMessages([]);
    api
      .messages(paper.id)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch((error) => {
        if (!cancelled) onNotice(error instanceof Error ? error.message : 'Could not load chat.');
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [messages]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  function addCitation(annotation: Annotation) {
    setCitations((current) =>
      current.some((citation) => citation.id === annotation.id)
        ? current
        : [...current, toCitation(annotation)].slice(0, 12),
    );
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    const raw = event.dataTransfer.getData('application/x-annotation');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { id: string };
      const annotation = annotations.find((item) => item.id === data.id);
      if (annotation) addCitation(annotation);
      else onNotice('That annotation is no longer available.');
    } catch {
      onNotice('Could not read the dropped annotation.');
    }
  }

  function updateAssistant(
    id: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? updater(message) : message)),
    );
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: text,
      citations: [...citations],
      tools: [],
      model: null,
      created_at: new Date().toISOString(),
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      citations: [],
      tools: [],
      model: null,
      created_at: new Date().toISOString(),
      streaming: true,
    };

    const citationIds = citations.map((citation) => citation.id);
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setCitations([]);
    setWarning('');
    setStreamError('');
    setStreaming(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;
    let receivedContent = false;

    await streamChat(
      { paper_id: paper.id, message: text, citation_ids: citationIds },
      {
        onMeta: (meta) => {
          setModelLabel(meta.model);
          updateAssistant(assistantId, (message) => ({ ...message, model: meta.model }));
        },
        onDelta: (delta) => {
          receivedContent = true;
          updateAssistant(assistantId, (message) => ({
            ...message,
            content: message.content + delta,
          }));
        },
        onToolCall: (tool: ToolTrace) => {
          updateAssistant(assistantId, (message) => ({
            ...message,
            tools: [...message.tools, { ...tool, ok: undefined, summary: '' }],
          }));
        },
        onToolResult: (result) => {
          updateAssistant(assistantId, (message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === result.id
                ? { ...tool, ok: result.ok, summary: result.summary }
                : tool,
            ),
          }));
        },
        onWarning: (message) => setWarning(message),
        onError: (message) => {
          setStreamError(message);
          setStreaming(false);
          if (!receivedContent) {
            setMessages((current) => current.filter((item) => item.id !== assistantId));
          } else {
            updateAssistant(assistantId, (message2) => ({ ...message2, streaming: false }));
          }
        },
        onDone: (done) => {
          setStreaming(false);
          abortRef.current = null;
          if (done.error) setStreamError(done.error);
          setMessages((current) => {
            const next = current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    id: done.assistantMessageId,
                    model: done.model || message.model,
                    streaming: false,
                  }
                : message,
            );
            return next.filter(
              (message) =>
                !(message.id === done.assistantMessageId && !message.content && !message.tools.length),
            );
          });
        },
      },
      controller.signal,
    );

    // Safety net: if the stream closed without a done event.
    setStreaming((value) => {
      if (value) abortRef.current = null;
      return false;
    });
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId && message.streaming ? { ...message, streaming: false } : message,
      ),
    );
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((current) =>
      current.map((message) => (message.streaming ? { ...message, streaming: false } : message)),
    );
  }

  async function clearChat() {
    const ok = await confirm({
      title: 'Clear conversation',
      message: 'Clear the whole AI conversation for this paper?',
      confirmLabel: 'CLEAR',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearMessages(paper.id);
      setMessages([]);
      setWarning('');
      setStreamError('');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not clear the conversation.');
    }
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <aside
      className={`chat-panel ${dragActive ? 'drop-active' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('application/x-annotation')) return;
        dragDepth.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-annotation')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragActive(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={(event) => {
        dragDepth.current = 0;
        onDrop(event);
      }}
    >
      <div className="chat-head">
        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
        <div className="chat-title">
          <span className="name">AI ASSISTANT</span>
          <span className="sub">
            {modelLabel ? `via ${modelLabel}` : 'Grounded in this paper'}
          </span>
        </div>
        {modelLabel && <span className="model-pill">{modelLabel}</span>}
        <button className="icon-btn" title="Clear conversation" onClick={() => void clearChat()}>
          <Trash2 size={13} />
        </button>
        <button className="icon-btn" title="Close assistant" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {loadingHistory && (
          <div className="loading-panel">
            <span className="spinner" /> LOADING THREAD…
          </div>
        )}

        {!loadingHistory && !messages.length && (
          <div className="chat-empty">
            <div className="big">Ask anything about this paper</div>
            The assistant can search the full text, read your annotations, and use installed
            skills. Drag a highlight or box from the page into this panel to cite it.
            <div className="chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  className="chat-suggestion"
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            message={message}
            onCitationClick={onCitationClick}
          />
        ))}

        {warning && <div className="chat-warning">{warning}</div>}
        {streamError && <div className="chat-error">{streamError}</div>}
      </div>

      <div className="chat-composer">
        {citations.length > 0 && (
          <div className="citation-strip">
            {citations.map((citation) => (
              <span className="citation-chip" key={citation.id}>
                <a
                  href="#"
                  className="cite-text"
                  title={citation.text || citation.note || citation.label}
                  onClick={(event) => {
                    event.preventDefault();
                    onCitationClick(citation.label, citation.page);
                  }}
                >
                  @{citation.page}:{citation.label}
                </a>
                <button
                  title="Remove citation"
                  onClick={() =>
                    setCitations((current) =>
                      current.filter((item) => item.id !== citation.id),
                    )
                  }
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={input}
            placeholder="Ask about this paper…"
            rows={2}
            onChange={(event) => {
              setInput(event.target.value);
              const element = event.currentTarget;
              element.style.height = 'auto';
              element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
            }}
            onKeyDown={onComposerKeyDown}
            disabled={streaming}
          />
          <div className="composer-actions">
            <span className="composer-hint">
              {streaming ? 'streaming…' : 'Enter to send · Shift+Enter newline'}
            </span>
            {streaming ? (
              <button className="send-btn stop" onClick={stop}>
                <Square size={10} /> STOP
              </button>
            ) : (
              <button className="send-btn" onClick={() => void send()} disabled={!input.trim()}>
                <Send size={10} /> SEND
              </button>
            )}
          </div>
        </div>
        <div className="drag-hint" style={{ marginTop: 5 }}>
          Drag a <b>highlight / underline / box</b> here to add it as a citation.
        </div>
      </div>
    </aside>
  );
}

type BubbleProps = {
  message: ChatMessage;
  onCitationClick: (label: string, page: number) => void;
};

function ChatBubble({ message, onCitationClick }: BubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="chat-msg user">
        <div className="msg-role">YOU</div>
        {message.citations.length > 0 && (
          <div className="chat-citations">
            {message.citations.map((citation) => (
              <a
                key={citation.id}
                className="citation-chip"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onCitationClick(citation.label, citation.page);
                }}
                title={citation.text || citation.label}
              >
                @{citation.page}:{citation.label}
              </a>
            ))}
          </div>
        )}
        <div className="msg-content-user">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="chat-msg assistant">
      <div className="msg-role">
        <Sparkles size={9} /> AI{message.model ? ` · ${message.model}` : ''}
      </div>

      {message.tools.length > 0 && (
        <details className="tool-trace" open>
          <summary>
            <Wrench size={10} /> TOOL TRACE · {message.tools.length}
            <span className="tool-summary">
              {message.tools.filter((tool) => tool.ok === false).length > 0
                ? 'some failed'
                : 'complete'}
            </span>
          </summary>
          <div className="tool-rows">
            {message.tools.map((tool) => (
              <div className="tool-row" key={tool.id} title={tool.summary || tool.args}>
                <span
                  className={`tool-status ${
                    tool.ok === undefined ? 'running' : tool.ok ? 'ok' : 'fail'
                  }`}
                />
                <span className="tool-name">{tool.name}</span>
                <span className="tool-args">{compactArgs(tool.args) || '—'}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {message.content ? (
        <div className="msg-content-assistant">
          <Markdown onCitationClick={onCitationClick}>{message.content}</Markdown>
          {message.streaming && <span className="thinking-caret" />}
        </div>
      ) : message.streaming ? (
        <div className="msg-content-assistant">
          <span className="tool-row">
            <span className="tool-status running" /> thinking
            <LoaderCircle size={10} className="spin-icon" style={{ marginLeft: 4 }} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function compactArgs(args: string): string {
  if (!args) return '';
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const entries = Object.entries(parsed).map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    });
    return entries.join(' ');
  } catch {
    return args.slice(0, 70);
  }
}
