import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type MdNode = {
  type?: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

function walk(node: MdNode): void {
  if (!node.children) return;
  const output: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('@')) {
      const parts = child.value.split(/(@\d+:[a-z]+_\d+)/g);
      for (const part of parts) {
        if (!part) continue;
        const match = part.match(/^@(\d+):([a-z]+_\d+)$/);
        if (match) {
          output.push({
            type: 'link',
            url: `#cite:${match[1]}:${match[2]}`,
            children: [{ type: 'text', value: part }],
          });
        } else {
          output.push({ type: 'text', value: part });
        }
      }
    } else {
      walk(child);
      output.push(child);
    }
  }
  node.children = output;
}

function remarkCitations() {
  return (tree: MdNode) => {
    walk(tree);
  };
}

/** Converts \(...\) / \[...\] into the dollar delimiters understood by remark-math. */
const CODE_SPAN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function normalizeLatexDelimiters(markdown: string): string {
  return markdown
    .split(CODE_SPAN)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);
    })
    .join('');
}

type Props = {
  children: string;
  onCitationClick?: (label: string, page: number) => void;
};

export function Markdown({ children, onCitationClick }: Props) {
  const source = useMemo(() => normalizeLatexDelimiters(children), [children]);

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCitations as never]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          a: ({ href, children: linkChildren }) => {
            if (href?.startsWith('#cite:')) {
              const [, page, label] = href.split(':');
              return (
                <a
                  className="cite-link"
                  href={href}
                  title={`Jump to @${page}:${label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onCitationClick?.(label, Number(page));
                  }}
                >
                  {linkChildren}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            );
          },
          img: ({ src, alt }) => <img src={src} alt={alt ?? ''} loading="lazy" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
