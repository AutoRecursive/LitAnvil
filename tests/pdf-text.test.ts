// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findPdfText, pdfSelectionLocation, rectsFromTextRanges, paintPdfPreview, repaintPdfPreviews, finishPdfTextSelection } from '../src/pdf-text';
let reader: HTMLElement;
function box(left: number, top: number, width: number, height: number) {
  return {left,top,right:left+width,bottom:top+height,width,height} as DOMRect;
}
function page(number: number, lines: {text:string;x:number;y:number}[]) {
  const page = document.createElement('section'); page.className='pdf-page'; page.dataset.page=String(number); page.dataset.ready='true';
  page.getBoundingClientRect = () => box(100,200,500,800);
  const layer = document.createElement('div'); layer.className='textLayer'; page.append(layer);
  lines.forEach(line => { const span=document.createElement('span'); span.textContent=line.text; span.getBoundingClientRect=()=>box(line.x,line.y,line.text.length*5,10); layer.append(span); });
  reader.append(page); return page;
}
beforeEach(() => {
  reader=document.createElement('article'); document.body.append(reader);
  Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(this: Range) {
    expect(this.startContainer).toBe(this.endContainer);
    const rect = this.startContainer.parentElement!.getBoundingClientRect();
    if (!rect.height) return [];
    return [box(rect.left+this.startOffset*5,rect.top,(this.endOffset-this.startOffset)*5,10)];
  }});
});
afterEach(() => { window.getSelection()?.removeAllRanges(); reader.remove(); delete (Range.prototype as any).getClientRects; vi.restoreAllMocks(); });
it('matches across text spans and multiple lines without highlighting their whole bounding boxes', () => {
  page(1,[{text:'The Trans',x:120,y:220},{text:'former connects',x:165,y:220},{text:'input and output.',x:120,y:240}]);
  const found=findPdfText(reader,'Transformer connects input and output');
  expect(found).toHaveLength(1);
  expect(found[0].rects).toHaveLength(3);
  expect(found[0].rects[0]).toMatchObject({page:1,x:0.08,y:0.025,w:0.05,h:0.0125});
  expect(found[0].rects[2].y).toBe(0.05);
});
it('maps ligatures, composed accents and repeated occurrences to their actual original glyph offsets', () => {
  page(1,[{text:'ﬁnd café, find cafe\u0301',x:100,y:200}]);
  const found=findPdfText(reader,'FIND CAFÉ');
  expect(found).toHaveLength(2);
  expect(found[0].rects[0]).toMatchObject({x:0,w:0.08});
  expect(found[1].rects[0].w).toBe(0.1);
});
it('ignores line-break hyphenation while preserving same-line compound hyphens', () => {
  page(1,[{text:'inter-',x:120,y:220},{text:'active real-',x:120,y:240},{text:'time',x:180,y:240}]);
  expect(findPdfText(reader,'interactive real-time')).toHaveLength(1);
  expect(findPdfText(reader,'inter-\nactive')).toHaveLength(1);
  expect(findPdfText(reader,'interactive realtime')).toHaveLength(0);
});
it('restricts matches by page and never stitches unrelated text across PDF pages', () => {
  page(1,[{text:'alpha repeated',x:120,y:220}]);
  page(2,[{text:'beta repeated',x:120,y:220}]);
  expect(findPdfText(reader,'repeated')).toHaveLength(2);
  expect(findPdfText(reader,'repeated',2)[0].rects[0].page).toBe(2);
  expect(findPdfText(reader,'repeated beta')).toHaveLength(0);
  expect(findPdfText(reader,'   ')).toHaveLength(0);
});
it('clips glyph rectangles to the PDF page and ignores zero-size text', () => {
  page(1,[{text:'boundary',x:90,y:200}]);
  expect(findPdfText(reader,'boundary')[0].rects[0]).toMatchObject({x:0,w:0.06});
  const span=reader.querySelector('span')!;
  span.getBoundingClientRect=()=>box(90,200,0,0);
  expect(findPdfText(reader,'boundary')).toHaveLength(0);
});

it('captures precise selection offsets across spans and pages, independently of whole-element range boxes', () => {
  const first=page(1,[{text:'prefix selected',x:120,y:220}]);
  const second=page(2,[{text:'continued suffix',x:120,y:240}]);
  const range=document.createRange();
  range.setStart(first.querySelector('span')!.firstChild!,7);
  range.setEnd(second.querySelector('span')!.firstChild!,9);
  const location=pdfSelectionLocation(reader,range);
  expect(location.version).toBe(2);
  expect(location.textRanges).toEqual([{page:1,node:0,start:7,end:15},{page:2,node:0,start:0,end:9}]);
  expect(location.rects).toHaveLength(2);
  expect(location.rects[0].w).toBe(0.08);
});
it('reanchors temporary previews to new text metrics after PDF font rounding changes', () => {
  const document=page(1,[{text:'precise text',x:120,y:220}]);
  const match=findPdfText(reader,'precise text')[0];
  paintPdfPreview(reader,match.rects,match.textRanges,'#ec489955','preview');
  expect((document.querySelector('.agent-preview') as HTMLElement).style.top).toBe('2.5%');
  document.querySelector('span')!.getBoundingClientRect=()=>box(122,223,60,12);
  repaintPdfPreviews(document);
  expect(document.querySelectorAll('.agent-preview')).toHaveLength(1);
  const mark=document.querySelector('.agent-preview') as HTMLElement;
  expect(parseFloat(mark.style.left)).toBeCloseTo(4.4);
  expect(mark.style.top).toBe('2.875%');
  expect(mark.dataset.previewId).toBe('preview');
  expect(rectsFromTextRanges(reader,match.textRanges)[0].y).toBe(0.02875);
});
it('uses no stale glyph geometry while a page is rerendering and tolerates missing legacy text anchors', () => {
  const document=page(1,[{text:'precise text',x:120,y:220}]);
  const match=findPdfText(reader,'precise text')[0];
  document.dataset.ready='false';
  expect(rectsFromTextRanges(reader,match.textRanges)).toEqual([]);
  expect(rectsFromTextRanges(reader,undefined as any)).toEqual([]);
  document.dataset.ready='true';
  expect(rectsFromTextRanges(reader,[{page:1,node:99,start:0,end:2}])).toEqual([]);
});
it('finishes a whitespace drag at the text line edge instead of an unrelated following author block',()=>{
 const document=page(1,[{text:'Paper title',x:120,y:220},{text:'Unrelated authors',x:100,y:260}]);
 const nodes=document.querySelectorAll('span');const selection=window.getSelection()!;
 selection.setBaseAndExtent(nodes[0].firstChild!,0,nodes[1].firstChild!,5);
 finishPdfTextSelection(reader,document.querySelector('.textLayer'),200,225);
 expect(selection.toString()).toBe('Paper title');
 expect(pdfSelectionLocation(reader,selection.getRangeAt(0)).textRanges).toEqual([{page:1,node:0,start:0,end:11}]);
});
it('preserves reverse selections and leaves real text targets and paragraph gaps to the browser',()=>{
 const document=page(1,[{text:'Paper title',x:120,y:220},{text:'Authors',x:100,y:260}]);
 const title=document.querySelector('span')!;const selection=window.getSelection()!;
 selection.setBaseAndExtent(title.firstChild!,11,title.firstChild!,3);
 finishPdfTextSelection(reader,document.querySelector('.textLayer'),110,225);
 expect(selection.toString()).toBe('Paper title');expect(selection.anchorOffset).toBe(11);
 selection.setBaseAndExtent(title.firstChild!,0,title.firstChild!,5);
 finishPdfTextSelection(reader,title,200,225);expect(selection.toString()).toBe('Paper');
 finishPdfTextSelection(reader,document.querySelector('.textLayer'),200,245);expect(selection.toString()).toBe('Paper');
});
