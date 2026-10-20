import OpenAI from 'openai';
import { getEnabledModels } from './llm.js';

export type TitleDetectionInput = {
  firstPageText: string;
  metaTitle: string | null;
  filename: string;
};

function cleanTitle(value: string, fallback: string): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';

  let title = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^\*{0,2}\s*title\s*[:：-]\s*\*{0,2}\s*/i, '')
    .replace(/^\*+\s*/, '')
    .replace(/\*+\s*$/, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (title.length < 3 || title.length > 300) return fallback;
  if (/^(unknown|untitled|n\/?a|none|sorry|i (?:cannot|can't|am unable))/i.test(title)) {
    return fallback;
  }
  return title;
}

/**
 * Asks the highest-priority enabled model to identify the paper title from the
 * first page. Returns null when no model is configured or the call fails, so
 * callers can keep the metadata/filename fallback.
 */
export async function detectPaperTitle(input: TitleDetectionInput): Promise<string | null> {
  const model = getEnabledModels()[0];
  if (!model) return null;

  const fallback = input.metaTitle
    ? cleanTitle(input.metaTitle, input.filename)
    : input.filename;

  const text = input.firstPageText.trim();
  if (!text && !input.metaTitle) return null;

  const client = new OpenAI({
    apiKey: model.api_key,
    baseURL: model.base_url,
    timeout: 20_000,
    maxRetries: 0,
  });

  try {
    const completion = await client.chat.completions.create({
      model: model.model_name,
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: 'system',
          content:
            'You identify the exact title of a research paper from its PDF. Return ONLY the title text, with no authors, venue, year, quotes, Markdown, prefix, or explanation. Preserve the original language and capitalization. If the title cannot be identified, return the metadata title; if that is empty, return the filename without the .pdf extension. Never invent a title.',
        },
        {
          role: 'user',
          content: `Filename: ${input.filename}\nMetadata title: ${input.metaTitle || '(none)'}\n\n--- first page text ---\n${text || '(no extractable text)'}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? '';
    const title = cleanTitle(raw, fallback);
    return title || null;
  } catch {
    return null;
  }
}
