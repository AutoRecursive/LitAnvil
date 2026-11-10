import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export function Markdown({children, className = ''}: {children: string; className?: string}) {
  return <div className={`markdown-content ${className}`}><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, {trust: false, strict: 'ignore'}]]}
  >{children}</ReactMarkdown></div>;
}
