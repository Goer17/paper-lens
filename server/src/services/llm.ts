import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { Response } from 'express';
import { config, newId, now } from '../config.js';
import { db, getSetting, type AnnotationRow, type ModelRow, type PaperRow } from '../db.js';
import { getPageTexts } from './pdf.js';
import {
  listSkills,
  getSkillByName,
  readSkillInstructions,
  readSkillFile,
  listSkillFiles,
} from './skills.js';

type CitationSnapshot = {
  id: string;
  label: string;
  page: number;
  type: string;
  text: string;
  note: string;
  imageName: string | null;
};

type ToolTrace = {
  id: string;
  name: string;
  args: string;
  ok?: boolean;
  summary?: string;
};

type StreamContext = {
  res: Response;
  send: (event: string, data: unknown) => void;
  paper: PaperRow;
  citations: CitationSnapshot[];
  signal: AbortSignal;
  traces: ToolTrace[];
  emittedText: { value: boolean };
  fullText: { value: string };
};

function sse(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  return (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

export function getEnabledModels(): ModelRow[] {
  return db.prepare('SELECT * FROM models WHERE enabled = 1 ORDER BY sort_order ASC').all() as ModelRow[];
}

function language(): string {
  return getSetting('ai_language', 'English');
}

function languageLabel(): string {
  const value = language();
  const labels: Record<string, string> = {
    Chinese: 'Simplified Chinese (中文)',
    Japanese: 'Japanese (日本語)',
    Korean: 'Korean (한국어)',
    Spanish: 'Spanish (Español)',
    French: 'French (Français)',
    German: 'German (Deutsch)',
  };
  return labels[value] || value;
}

function systemPrompt(paper: PaperRow): string {
  const skills = listSkills();
  const skillBlock = skills.length
    ? `\nAvailable skills (load one with the use_skill tool before following its instructions):\n${skills
        .map((skill) => `- ${skill.name}: ${skill.description || 'no description'}`)
        .join('\n')}`
    : '';

  return `You are PaperLens, a precise research assistant embedded in a PDF reader.
The user is reading the paper "${paper.title}" (${paper.pages} pages).
Today's date is ${new Date().toISOString().slice(0, 10)}.

Rules:
1. LANGUAGE (hard requirement): write every answer in ${languageLabel()}. Even when the question, the paper, or earlier messages use another language, keep your answer in ${languageLabel()}. Only switch if the user explicitly asks you to use a different language in this message.
2. Use the provided tools to find evidence in the paper. Never invent quotes, page numbers, or findings. If the paper text does not contain the answer, say so.
3. The user can attach annotations as citations. Each citation is labelled like @3:underline_1 (page 3, annotation underline_1). When you use the attached material, cite it inline with the exact label, e.g. [@3:underline_1]. Do not cite labels that were not provided or discovered through tools.
4. For box annotations, the quoted text is the text captured inside the box; if an image is attached, inspect it.
5. Format your final answer strictly in GitHub-flavoured Markdown: headings, lists, tables, code fences, and LaTeX math. Always wrap inline math in $...$ and display math in $$...$$ on its own lines (never \(...\) or \[...\], and never inside code fences). Keep answers focused and well structured.
6. Use tools silently while thinking; do not describe the tool protocol in the final answer.
7. TOOL BUDGET (hard requirement): you get a limited number of tool rounds, and the last round does not allow tools. Never repeat a tool call with identical arguments. If two or three searches or page reads do not surface the evidence you need, stop searching and answer with what you already have, saying explicitly what the paper does not contain. A final answer in prose is always expected; tool calls alone are not an answer.${skillBlock}`;
}

function paperTools(): ChatCompletionTool[] {
  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'search_paper',
        description:
          'Search the full text of the current paper. Returns the most relevant pages with snippets. Use this before answering questions about the paper contents.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keywords or a question to search for.' },
            limit: { type: 'number', description: 'Maximum number of results (default 6).' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_page',
        description: 'Read the complete extracted text of one page of the paper.',
        parameters: {
          type: 'object',
          properties: {
            page: { type: 'number', description: '1-based page number.' },
          },
          required: ['page'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_pages',
        description: 'Read a contiguous range of pages (max 6 pages per call).',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'number', description: 'First page (1-based).' },
            to: { type: 'number', description: 'Last page (inclusive).' },
          },
          required: ['from', 'to'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_annotations',
        description: 'List all highlights, underlines, and boxes the user created in this paper.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_annotation',
        description: 'Read the full text and note of a specific annotation by its label.',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Annotation label, e.g. underline_2.' },
          },
          required: ['label'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_paper_info',
        description: 'Get bibliographic basics about the current paper (title, page count).',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];

  if (listSkills().length) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'list_skills',
          description: 'List the installed skills available to the agent.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'use_skill',
          description:
            'Load the full instructions (SKILL.md) of an installed skill. Use it when the task matches the skill description.',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Skill name.' } },
            required: ['name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_skill_file',
          description:
            'Read a supporting text file that belongs to an installed skill (scripts, templates, reference data).',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Skill name.' },
              path: { type: 'string', description: 'Relative path inside the skill folder.' },
            },
            required: ['name', 'path'],
          },
        },
      },
    );
  }

  return tools;
}

function snippetAround(text: string, query: string): string {
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  let index = -1;
  for (const term of terms) {
    index = lower.indexOf(term);
    if (index !== -1) break;
  }
  if (index === -1) return text.slice(0, 360).replace(/\s+/g, ' ');
  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + 300);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

function annotations(paperId: string): AnnotationRow[] {
  return db
    .prepare('SELECT * FROM annotations WHERE paper_id = ? ORDER BY page ASC, created_at ASC')
    .all(paperId) as AnnotationRow[];
}

async function executeTool(
  context: StreamContext,
  name: string,
  rawArgs: string,
): Promise<unknown> {
  const paper = context.paper;
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { error: 'Invalid JSON arguments.' };
  }

  switch (name) {
    case 'get_paper_info':
      return { title: paper.title, pages: paper.pages, added: paper.created_at };
    case 'search_paper': {
      const query = String(args.query ?? '').trim();
      if (!query) return { error: 'query is required.' };
      const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 12);
      const pages = await getPageTexts(paper);
      const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      const results = pages
        .map((text, index) => {
          const lower = text.toLowerCase();
          let score = 0;
          for (const term of terms) {
            let pos = lower.indexOf(term);
            while (pos !== -1 && score < 50) {
              score += 1;
              pos = lower.indexOf(term, pos + term.length);
            }
          }
          return { page: index + 1, score, snippet: score ? snippetAround(text, query) : '' };
        })
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return results.length ? { query, results } : { query, results: [], note: 'No matches found.' };
    }
    case 'read_page': {
      const page = Math.round(Number(args.page));
      const pages = await getPageTexts(paper);
      if (!Number.isFinite(page) || page < 1 || page > pages.length) {
        return { error: `Page must be between 1 and ${pages.length}.` };
      }
      return { page, text: pages[page - 1] };
    }
    case 'read_pages': {
      const pages = await getPageTexts(paper);
      const from = Math.max(1, Math.round(Number(args.from)) || 1);
      const to = Math.min(pages.length, Math.round(Number(args.to)) || from, from + 5);
      if (from > pages.length) return { error: `Page must be between 1 and ${pages.length}.` };
      return {
        pages: pages.slice(from - 1, to).map((text, index) => ({ page: from + index, text })),
      };
    }
    case 'list_annotations':
      return {
        annotations: annotations(paper.id).map((row) => ({
          label: row.label,
          type: row.type,
          page: row.page,
          text: row.text.slice(0, 500),
          note: row.note,
        })),
      };
    case 'read_annotation': {
      const label = String(args.label ?? '');
      const row = annotations(paper.id).find((item) => item.label === label);
      if (!row) return { error: `No annotation labelled ${label}.` };
      return {
        label: row.label,
        type: row.type,
        page: row.page,
        text: row.text,
        note: row.note,
        has_image: Boolean(row.image_name),
      };
    }
    case 'list_skills':
      return {
        skills: listSkills().map((skill) => ({
          name: skill.name,
          description: skill.description,
          files: listSkillFiles(skill),
        })),
      };
    case 'use_skill': {
      const skill = getSkillByName(String(args.name ?? ''));
      if (!skill) return { error: 'Skill not found.' };
      return { name: skill.name, instructions: readSkillInstructions(skill) };
    }
    case 'read_skill_file': {
      const skill = getSkillByName(String(args.name ?? ''));
      if (!skill) return { error: 'Skill not found.' };
      return { path: args.path, content: readSkillFile(skill, String(args.path ?? '')) };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function citationBlock(citations: CitationSnapshot[]): string {
  if (!citations.length) return '';
  const blocks = citations.map((citation) => {
    const body = citation.text || citation.note || '(no extracted text)';
    const note = citation.note && citation.note !== body ? `\nUser note: ${citation.note}` : '';
    return `<citation label="@${citation.page}:${citation.label}" type="${citation.type}" page="${citation.page}">\n${body}${note}\n</citation>`;
  });
  return `\n\nThe user attached these annotations as citations:\n${blocks.join('\n')}`;
}

function loadCitationSnapshots(paperId: string, ids: string[]): CitationSnapshot[] {
  if (!ids.length) return [];
  const rows = annotations(paperId);
  const wanted = new Set(ids);
  return rows
    .filter((row) => wanted.has(row.id))
    .map((row) => ({
      id: row.id,
      label: row.label,
      page: row.page,
      type: row.type,
      text: row.text,
      note: row.note,
      imageName: row.image_name,
    }));
}

type HistoryRow = {
  role: string;
  content: string;
  citations: string;
};

function loadHistory(paperId: string): ChatCompletionMessageParam[] {
  const rows = db
    .prepare(
      'SELECT role, content, citations FROM messages WHERE paper_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 16',
    )
    .all(paperId) as HistoryRow[];
  return rows
    .reverse()
    .map((row) => {
      let suffix = '';
      try {
        const citations = JSON.parse(row.citations) as CitationSnapshot[];
        suffix = citationBlock(citations);
      } catch {
        suffix = '';
      }
      return {
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.content + suffix,
      } as ChatCompletionMessageParam;
    })
    .filter((message) => typeof message.content === 'string' && message.content.length > 0);
}

type PendingCall = { id: string; name: string; arguments: string };

function visionErrorHint(message: string, hasImages: boolean): string {
  if (!hasImages) return '';
  if (!/image|vision|multimodal|image_url|content.?type|invalid.*content/i.test(message)) return '';
  return ' This model does not support image input (vision). Remove the box citation or use a vision-capable model.';
}

async function runModel(
  model: ModelRow,
  context: StreamContext,
  baseMessages: ChatCompletionMessageParam[],
): Promise<{ content: string; modelLabel: string }> {
  const client = new OpenAI({
    apiKey: model.api_key,
    baseURL: model.base_url,
    timeout: 180_000,
    maxRetries: 0,
  });

  const messages = [...baseMessages];
  const tools = paperTools();

  // Content is briefly buffered: models sometimes narrate a tool call
  // ("Let me look that up…") before calling a tool. Short preambles are
  // dropped so the final answer contains only the real response.
  const flush = (text: string) => {
    if (!text) return;
    context.fullText.value += text;
    context.emittedText.value = true;
    context.send('delta', { text });
  };

  // Total provider calls for one attempt: tool rounds plus a final answer-only
  // round. Without that last round a model that keeps calling tools (or runs
  // out of steps right after a useful result) returns no text at all.
  const MAX_STEPS = 6;
  const seenCalls = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const forceAnswer = step === MAX_STEPS - 1;
    let stream: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      stream = await client.chat.completions.create(
        {
          model: model.model_name,
          messages,
          tools,
          tool_choice: forceAnswer ? 'none' : 'auto',
          stream: true,
          temperature: 0.2,
        },
        { signal: context.signal },
      );
    } catch (error) {
      // Some OpenAI-compatible providers reject `tool_choice: 'none'`.
      // Sending no tool definitions at all also forces a text answer.
      if (!forceAnswer || context.signal.aborted) throw error;
      stream = await client.chat.completions.create(
        {
          model: model.model_name,
          messages,
          stream: true,
          temperature: 0.2,
        },
        { signal: context.signal },
      );
    }

    let stepText = '';
    let pendingText = '';
    const pending = new Map<number, PendingCall>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        stepText += delta.content;
        pendingText += delta.content;
        if (pendingText.length >= 240) {
          flush(pendingText);
          pendingText = '';
        }
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const slot = pending.get(index) ?? { id: '', name: '', arguments: '' };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.arguments += call.function.arguments;
        pending.set(index, slot);
      }
    }

    const calls = [...pending.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value)
      .filter((call) => call.name)
      .map((call) => ({ ...call, id: call.id || newId() }));

    if (!calls.length || forceAnswer) {
      // The final round cannot call tools: whatever text it produced is the answer.
      flush(pendingText);
      pendingText = '';
      break;
    }
    // A tool call follows: drop the short narration preceding it.
    pendingText = '';

    messages.push({
      role: 'assistant',
      content: stepText || null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments || '{}' },
      })),
    });

    for (const call of calls) {
      const args = call.arguments || '{}';
      const signature = `${call.name}\u0000${args}`;
      if (seenCalls.has(signature)) {
        // Repeating an identical call returns identical data and only burns
        // the remaining tool rounds. Tell the model to answer instead.
        const trace: ToolTrace = {
          id: call.id,
          name: call.name,
          args,
          ok: false,
          summary: 'Duplicate call skipped. Use the earlier result and answer now.',
        };
        context.traces.push(trace);
        context.send('tool_call', { id: trace.id, name: trace.name, args: trace.args });
        context.send('tool_result', {
          id: trace.id,
          name: trace.name,
          ok: false,
          summary: trace.summary as string,
        });
        messages.push({
          role: 'tool',
          tool_call_id: trace.id,
          content: JSON.stringify({
            duplicate: true,
            note: trace.summary,
          }),
        });
        continue;
      }
      seenCalls.add(signature);

      const trace: ToolTrace = { id: call.id, name: call.name, args };
      context.traces.push(trace);
      context.send('tool_call', { id: trace.id, name: trace.name, args: trace.args });
      try {
        const result = await executeTool(context, call.name, call.arguments);
        const summary = JSON.stringify(result);
        trace.ok = true;
        trace.summary = summary.slice(0, 600);
        context.send('tool_result', {
          id: trace.id,
          name: trace.name,
          ok: true,
          summary: summary.slice(0, 900),
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: summary.slice(0, 24_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed.';
        trace.ok = false;
        trace.summary = message;
        context.send('tool_result', { id: trace.id, name: trace.name, ok: false, summary: message });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: message }),
        });
      }
    }
  }

  return { content: context.fullText.value, modelLabel: model.name };
}

export type ChatPayload = {
  paperId: string;
  message: string;
  citationIds: string[];
  signal: AbortSignal;
};

export async function streamChat(res: Response, payload: ChatPayload): Promise<void> {
  const send = sse(res);
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(payload.paperId) as
    | PaperRow
    | undefined;
  if (!paper) {
    send('error', { message: 'Paper not found.' });
    res.end();
    return;
  }

  const citations = loadCitationSnapshots(paper.id, payload.citationIds);
  const traces: ToolTrace[] = [];
  const emittedText = { value: false };
  const context: StreamContext = {
    res,
    send,
    paper,
    citations,
    signal: payload.signal,
    traces,
    emittedText,
    fullText: { value: '' },
  };

  const history = loadHistory(paper.id);
  const userMessageId = newId();
  const createdAt = now();
  db.prepare(
    'INSERT INTO messages (id, paper_id, role, content, citations, tools, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    userMessageId,
    paper.id,
    'user',
    payload.message,
    JSON.stringify(citations),
    '[]',
    null,
    createdAt,
  );

  const images = citations
    .filter((citation) => citation.type === 'box' && citation.imageName)
    .slice(0, 4);
  const imageParts: { type: 'image_url'; image_url: { url: string } }[] = images.flatMap(
    (citation) => {
      try {
        const file = path.join(config.annotationDir, citation.imageName as string);
        if (!fs.existsSync(file)) return [];
        const base64 = fs.readFileSync(file).toString('base64');
        return [
          {
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${base64}` },
          },
        ];
      } catch {
        return [];
      }
    },
  );

  const text = payload.message + citationBlock(citations);
  const userContent: ChatCompletionMessageParam['content'] = imageParts.length
    ? [{ type: 'text', text }, ...imageParts]
    : text;

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(paper) },
    ...history,
    { role: 'user', content: userContent },
  ];

  const models = getEnabledModels();
  if (!models.length) {
    send('error', {
      message:
        'No AI model is enabled. Open Settings → Models to add a provider (base URL, API key, model name).',
    });
    res.end();
    return;
  }

  let finalModel = '';
  let errorMessage = '';

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      send('meta', {
        model: model.name,
        modelName: model.model_name,
        attempt: index + 1,
        total: models.length,
      });
      const result = await runModel(model, context, baseMessages);
      finalModel = result.modelLabel;
      errorMessage = '';
      break;
    } catch (error) {
      if (payload.signal.aborted) {
        errorMessage = 'Generation stopped.';
        break;
      }
      const message = error instanceof Error ? error.message : 'Model request failed.';
      const imageHint = visionErrorHint(message, imageParts.length > 0);
      if (emittedText.value || traces.some((trace) => trace.ok)) {
        errorMessage = `${model.name} failed: ${message}${imageHint}`;
        break;
      }
      context.send('warning', {
        message: `${model.name} failed (${message}).${imageHint} Trying the next model…`,
      });
      errorMessage = `All models failed. Last error from ${model.name}: ${message}${imageHint}`;
      if (index === models.length - 1) break;
    }
  }

  if (context.fullText.value.trim()) {
    const assistantId = newId();
    db.prepare(
      'INSERT INTO messages (id, paper_id, role, content, citations, tools, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      assistantId,
      paper.id,
      'assistant',
      context.fullText.value,
      '[]',
      JSON.stringify(traces),
      finalModel || null,
      now(),
    );
    send('done', {
      userMessageId,
      assistantMessageId: assistantId,
      model: finalModel,
      error: errorMessage || null,
      aborted: payload.signal.aborted,
    });
  } else {
    // Never persist an assistant row without text: it would replay as an empty
    // bubble and the user cannot tell that the model never answered.
    send('error', {
      message:
        errorMessage ||
        'The model used all of its tool calls without writing an answer. Ask again or rephrase the question.',
    });
  }
  res.end();
}
