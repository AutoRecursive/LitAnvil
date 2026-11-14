import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {parsePaperReference,type PaperReference} from '../shared/paper-reference';

function normalizeMathDelimiters(source: string) {
  return source.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `$$${body}$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`)
      .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_match, body: string) => `$$${body}$$`);
  }).join('');
}

export function Markdown({children, className = '',onReference}: {children: string; className?: string; onReference?:(reference:PaperReference)=>void}) {
  return <div className={`markdown-content ${className}`}><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, {trust: false, strict: 'ignore'}]]}
    components={onReference?{a:({node,...props})=><a {...props} onClick={event=>{const ref=parsePaperReference(props.href||'');if(ref){event.preventDefault();onReference(ref)}}}/ >}:undefined}
  >{normalizeMathDelimiters(children)}</ReactMarkdown></div>;
}
