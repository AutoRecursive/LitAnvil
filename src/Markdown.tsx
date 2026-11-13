import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

function normalizeMathDelimiters(source: string) {
  return source.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `$$${body}$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)
      .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_match, body: string) => `$$${body}$$`);
  }).join('');
}

export function Markdown({children, className = ''}: {children: string; className?: string}) {
  return <div className={`markdown-content ${className}`}><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, {trust: false, strict: 'ignore'}]]}
  >{normalizeMathDelimiters(children)}</ReactMarkdown></div>;
}
