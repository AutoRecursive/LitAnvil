import {describe,it,expect} from 'vitest';
import {canonicalUrl} from '../server/import-utils';
describe('arxiv identity',()=>{
 it('unifies abstract, PDF and export links',()=>{const expected='https://arxiv.org/pdf/1706.03762';for(const url of ['http://arxiv.org/abs/1706.03762','https://arxiv.org/pdf/1706.03762.pdf#page=2','https://export.arxiv.org/abs/1706.03762'])expect(canonicalUrl(url)).toBe(expected)});
 it('preserves explicit versions and unrelated hosts',()=>{expect(canonicalUrl('https://arxiv.org/abs/1706.03762v7')).toContain('v7');expect(canonicalUrl('https://example.com/abs/1706.03762')).toBe('https://example.com/abs/1706.03762')});
});
