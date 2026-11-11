import React, { useEffect, useState } from "react";
export function PageNavigation({ page, total, jump }: {
  page: number; total: number; jump: (page: number) => boolean;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  return <form className="page-navigation" aria-label="PDF 页码" onSubmit={event => {
    event.preventDefault();
    const next = Number(draft);
    if (!jump(next)) setDraft(String(page));
  }}>
    <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => jump(page - 1)}>‹</button>
    <input aria-label="当前页" type="text" inputMode="numeric" value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={() => setDraft(String(page))}
      onKeyDown={event => { if (event.key === "Escape") { setDraft(String(page)); event.currentTarget.blur(); } }}/>
    <span aria-label={`共 ${total} 页`}>/ {total}</span>
    <button type="button" aria-label="下一页" disabled={page >= total} onClick={() => jump(page + 1)}>›</button>
  </form>;
}
