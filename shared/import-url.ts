/** A complete supported arXiv URL can be imported independently of agent availability. */
export function arxivLink(raw: string): string | undefined {
  try {
    const url = new URL(raw.trim());
    if (!['http:','https:'].includes(url.protocol) || !/^(www\.|export\.)?arxiv\.org$/i.test(url.hostname)) return;
    const match=url.pathname.match(/^\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z.-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?\/?$/i);
    return match ? `https://arxiv.org/pdf/${match[1]}` : undefined;
  } catch { return; }
}
