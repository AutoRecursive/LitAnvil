import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {Markdown} from '../src/Markdown';

it('renders annotation markdown, inline math and display equations together',()=>{
  const source = '**重点**：$E=mc^2$\n\n$$\n\\mathcal{L}=\\frac{1}{N}\\sum_{i=1}^{N} (y_i-\\hat y_i)^2\n$$\n\n- 第一项\n- 第二项\n\n| 项目 | 数值 |\n| --- | --- |\n| A | 1 |';
  const html=renderToStaticMarkup(<Markdown className="annotation-content">{source}</Markdown>);
  expect(html).toContain('<strong>重点</strong>');expect(html).toContain('katex-display');expect(html).toContain('katex-mathml');expect(html).toContain('<li>第一项</li>');expect(html).toContain('<table>');
  expect(html).not.toContain('katex-error');
});

it('keeps raw HTML inert and preserves invalid formula source without crashing',()=>{
  const html=renderToStaticMarkup(<Markdown>{'<script>alert(1)</script>\n\n$\\frac{1}{$'}</Markdown>);
  expect(html).not.toContain('<script>');expect(html).toContain('katex-error');expect(html).toContain('frac');
});

it('accepts common LaTeX delimiters emitted by agents while leaving fenced code untouched',()=>{
  const source = String.raw`Inline \(x^2\) and display:
\[
E = mc^2
\]

` + "```text\n\\(keep raw\\)\n```";
  const html=renderToStaticMarkup(<Markdown>{source}</Markdown>);
  expect(html).toContain('katex-display');expect(html).toContain('x^2');expect(html).toContain('\\(keep raw\\)');
});
