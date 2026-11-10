import {describe,it,expect} from 'vitest';
import {canonicalUrl} from '../server/import-utils';
describe('arxiv identity',()=>{
 it('unifies abstract, PDF and export links',()=>{const expected='https://arxiv.org/pdf/1706.03762';for(const url of ['http://arxiv.org/abs/1706.03762','https://arxiv.org/pdf/1706.03762.pdf#page=2','https://export.arxiv.org/abs/1706.03762'])expect(canonicalUrl(url)).toBe(expected)});
 it('preserves explicit versions and unrelated hosts',()=>{expect(canonicalUrl('https://arxiv.org/abs/1706.03762v7')).toContain('v7');expect(canonicalUrl('https://example.com/abs/1706.03762')).toBe('https://example.com/abs/1706.03762')});
});
it('only routes complete HTTP arXiv links into the import queue', async () => {
 const {arxivLink}=await import('../shared/import-url');
 expect(arxivLink('https://export.arxiv.org/abs/1706.03762v7')).toBe('https://arxiv.org/pdf/1706.03762v7');
 expect(arxivLink('https://arxiv.org/pdf/hep-th/9901001.pdf')).toBe('https://arxiv.org/pdf/hep-th/9901001');
 expect(arxivLink('ftp://arxiv.org/abs/1706.03762')).toBeUndefined();
 expect(arxivLink('https://arxiv.org/abs/not-a-paper')).toBeUndefined();
 expect(arxivLink('https://arxiv.org.evil.test/abs/1706.03762')).toBeUndefined();
});
