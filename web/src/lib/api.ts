import type {
  Annotation,
  ChatMessage,
  Citation,
  Collection,
  Model,
  Paper,
  Settings,
  Skill,
  ToolTrace,
} from './types';

const TOKEN_KEY = 'paper-reader-token';

let unauthorizedHandler: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: headers(init.headers as Record<string, string> | undefined),
  });
  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep fallback
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  login: (token: string) =>
    request<{ ok: boolean; token: string }>('/api/auth/login', json('POST', { token })),

  me: () => request<{ ok: boolean }>('/api/auth/me'),

  collections: () =>
    request<{ collections: Collection[]; uncategorized: number }>('/api/collections'),

  createCollection: (name: string, parentId: string | null = null) =>
    request<Collection>('/api/collections', json('POST', { name, parent_id: parentId })),

  updateCollection: (id: string, patch: { name?: string; parent_id?: string | null }) =>
    request<{ id: string; name: string; parent_id: string | null }>(
      `/api/collections/${id}`,
      json('PATCH', patch),
    ),

  renameCollection: (id: string, name: string) =>
    request<{ id: string; name: string; parent_id: string | null }>(
      `/api/collections/${id}`,
      json('PATCH', { name }),
    ),

  moveCollection: (id: string, parentId: string | null) =>
    request<{ id: string; name: string; parent_id: string | null }>(
      `/api/collections/${id}`,
      json('PATCH', { parent_id: parentId }),
    ),

  deleteCollection: (id: string) =>
    request<{ ok: boolean }>(`/api/collections/${id}`, { method: 'DELETE' }),

  papers: (params: { collectionId?: string; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.collectionId) query.set('collection_id', params.collectionId);
    if (params.q) query.set('q', params.q);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{ papers: Paper[] }>(`/api/papers${suffix}`);
  },

  uploadPapers: (files: File[], collectionId: string | null) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    if (collectionId) form.append('collection_id', collectionId);
    return request<{ papers: Paper[] }>('/api/papers', { method: 'POST', body: form });
  },

  updatePaper: (id: string, patch: { title?: string; collection_id?: string | null }) =>
    request<{ ok: boolean }>(`/api/papers/${id}`, json('PATCH', patch)),

  deletePaper: (id: string) => request<{ ok: boolean }>(`/api/papers/${id}`, { method: 'DELETE' }),

  annotations: (paperId: string) =>
    request<{ annotations: Annotation[] }>(`/api/papers/${paperId}/annotations`),

  createAnnotation: (payload: {
    paper_id: string;
    type: Annotation['type'];
    page: number;
    color: string;
    rects: Annotation['rects'];
    text?: string;
    note?: string;
    image_data_url?: string;
  }) => request<{ annotation: Annotation }>('/api/annotations', json('POST', payload)),

  updateAnnotation: (id: string, patch: { note?: string; color?: string }) =>
    request<{ annotation: Annotation }>(`/api/annotations/${id}`, json('PATCH', patch)),

  deleteAnnotation: (id: string) =>
    request<{ ok: boolean }>(`/api/annotations/${id}`, { method: 'DELETE' }),

  settings: () =>
    request<{ settings: Settings; languages: string[] }>('/api/settings'),

  updateSettings: (patch: Partial<Record<keyof Settings, string>>) =>
    request<{ settings: Settings }>('/api/settings', json('PUT', patch)),

  models: () => request<{ models: Model[] }>('/api/models'),

  createModel: (payload: {
    name: string;
    base_url: string;
    api_key: string;
    model_name: string;
  }) => request<{ model: Model }>('/api/models', json('POST', payload)),

  updateModel: (
    id: string,
    patch: Partial<{
      name: string;
      base_url: string;
      api_key: string;
      model_name: string;
      enabled: boolean;
    }>,
  ) => request<{ model: Model }>(`/api/models/${id}`, json('PATCH', patch)),

  moveModel: (id: string, direction: 'up' | 'down') =>
    request<{ models: Model[] }>(`/api/models/${id}/move`, json('POST', { direction })),

  deleteModel: (id: string) => request<{ ok: boolean }>(`/api/models/${id}`, { method: 'DELETE' }),

  testModel: (id: string) =>
    request<{ ok: boolean; latency_ms: number; reply: string }>(
      `/api/models/${id}/test`,
      { method: 'POST' },
    ),

  skills: () => request<{ skills: Skill[] }>('/api/skills'),

  uploadSkill: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ skill: Skill; files: string[] }>('/api/skills', {
      method: 'POST',
      body: form,
    });
  },

  deleteSkill: (id: string) => request<{ ok: boolean }>(`/api/skills/${id}`, { method: 'DELETE' }),

  messages: (paperId: string) =>
    request<{ messages: ChatMessage[] }>(`/api/papers/${paperId}/messages`),

  clearMessages: (paperId: string) =>
    request<{ ok: boolean }>(`/api/papers/${paperId}/messages`, { method: 'DELETE' }),

  annotationImageUrl: (annotationId: string) =>
    `/api/annotations/${annotationId}/image?token=${encodeURIComponent(getToken())}`,
};

export type StreamHandlers = {
  onMeta?: (data: { model: string; modelName: string; attempt: number; total: number }) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (tool: ToolTrace) => void;
  onToolResult?: (data: { id: string; name: string; ok: boolean; summary: string }) => void;
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
  onDone?: (data: {
    userMessageId: string;
    assistantMessageId: string;
    model: string;
    error: string | null;
    aborted: boolean;
  }) => void;
};

type SseBlock = { event: string; data: string };

function parseBlock(block: string): SseBlock | null {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}

export async function streamChat(
  payload: { paper_id: string; message: string; citation_ids: string[] },
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    handlers.onError?.((error as Error).message);
    return;
  }

  if (response.status === 401) {
    unauthorizedHandler?.();
    handlers.onError?.('Your session has expired. Please sign in again.');
    return;
  }
  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    handlers.onError?.(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.search(/\r?\n\r?\n/);
      while (index !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer[index] === '\r' ? 4 : 2));
        const block = parseBlock(raw);
        if (block) dispatch(block, handlers);
        index = buffer.search(/\r?\n\r?\n/);
      }
    }
    const tail = parseBlock(buffer.trim());
    if (tail) dispatch(tail, handlers);
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      handlers.onError?.((error as Error).message);
    }
  }
}

function dispatch(block: SseBlock, handlers: StreamHandlers): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(block.data) as Record<string, unknown>;
  } catch {
    return;
  }
  switch (block.event) {
    case 'meta':
      handlers.onMeta?.(data as never);
      break;
    case 'delta':
      if (typeof data.text === 'string') handlers.onDelta?.(data.text);
      break;
    case 'tool_call':
      handlers.onToolCall?.(data as unknown as ToolTrace);
      break;
    case 'tool_result':
      handlers.onToolResult?.(data as never);
      break;
    case 'warning':
      handlers.onWarning?.(String(data.message ?? ''));
      break;
    case 'error':
      handlers.onError?.(String(data.message ?? 'Generation failed.'));
      break;
    case 'done':
      handlers.onDone?.(data as never);
      break;
    default:
      break;
  }
}

export type { Citation };
