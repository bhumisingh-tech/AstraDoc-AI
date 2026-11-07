import { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { CitationChip } from '../citations/CitationCards';
import type { Source } from '../../lib/api';

/** Transform citation text nodes, never code blocks, into semantic links. */
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };
function citations() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type)) return;
      const result: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && child.value) {
          const pattern = /\[Source\s+(\d+)\]/gi;
          let last = 0; let match: RegExpExecArray | null;
          while ((match = pattern.exec(child.value)) !== null) {
            if (match.index > last) result.push({type:'text',value:child.value.slice(last, match.index)});
            result.push({type:'link',url:`citation:${match[1]}`,children:[{type:'text',value:match[0]}]});
            last = match.index + match[0].length;
          }
          if (last === 0) result.push(child);
          else if (last < child.value.length) result.push({type:'text',value:child.value.slice(last)});
        } else { walk(child); result.push(child); }
      }
      node.children = result;
    };
    walk(tree);
  };
}
/** Markdown is parsed, not dangerously injected; raw HTML is not enabled. */
export function MarkdownAnswer({ content, sources = [], onOpenSource }: { content: string; sources?: Source[]; onOpenSource?: (source: Source) => void }) {
  return <div className="markdown-answer"><ReactMarkdown remarkPlugins={[remarkGfm, citations]} urlTransform={url => url.startsWith('citation:') ? url : defaultUrlTransform(url)} components={{
    code({ className, children, ...props }) {
      const text = String(children).replace(/\n$/, '');
      const block = Boolean(className?.includes('language-') || text.includes('\n'));
      return block ? <CodeSnippet code={text} language={className?.replace('language-', '')}/> : <code className="inline-code" {...props}>{children}</code>;
    },
    a({ href, children }) { if (href?.startsWith('citation:')) { const number = Number(href.slice(9)); const source = sources.find(src => src.citation === number); return <CitationChip number={number} source={source} onOpen={onOpenSource || (() => {})}/>; } return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>; },
  }}>{content}</ReactMarkdown></div>;
}
function CodeSnippet({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  return <div className="code-panel"><div className="code-toolbar"><span>{language || 'code'}</span><button type="button" onClick={() => void copy()} aria-label="Copy code" className="flex items-center gap-1">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? 'Copied' : 'Copy'}</button></div><pre><code>{code}</code></pre></div>;
}
