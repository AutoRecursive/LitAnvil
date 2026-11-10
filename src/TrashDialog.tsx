import React, { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { api } from "./api";
type Trash = {
  documents: { id: string; title: string; deletedAt: string }[];
  annotations: {
    id: string;
    quote: string;
    note: string;
    documentTitle: string;
    deletedAt: string;
  }[];
};
export function TrashDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: (id:string) => Promise<void>;
}) {
  const [data, setData] = useState<Trash>({ documents: [], annotations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api("/trash")
      .then((data) => {
        if (active) setData(data);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function restore(kind: "documents" | "annotations", id: string) {
    setPending(id);
    setError("");
    try {
      await api(`/${kind}/${id}/restore`, { method: "POST" });
      setData(await api("/trash"));
      await onRestored(id);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(null);
    }
  }
  return (
    <Dialog title="回收站" onClose={onClose}>
      {error && (
        <p className="trash-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="trash-empty">加载中…</p>
      ) : (
        <>
          {data.documents.length > 0 && (
            <section className="trash-section">
              <h3>文档</h3>
              {data.documents.map((document) => (
                <div className="trash-row" key={document.id}>
                  <div>
                    <b>{document.title}</b>
                    <small>
                      {new Date(document.deletedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <button
                    disabled={!!pending}
                    onClick={() => restore("documents", document.id)}
                  >
                    {pending === document.id ? "恢复中…" : "恢复文档"}
                  </button>
                </div>
              ))}
            </section>
          )}
          {data.annotations.length > 0 && (
            <section className="trash-section">
              <h3>批注</h3>
              {data.annotations.map((annotation) => (
                <div className="trash-row" key={annotation.id}>
                  <div>
                    <b>{annotation.quote}</b>
                    <small>{annotation.documentTitle}</small>
                  </div>
                  <button
                    disabled={!!pending}
                    onClick={() => restore("annotations", annotation.id)}
                  >
                    {pending === annotation.id ? "恢复中…" : "恢复批注"}
                  </button>
                </div>
              ))}
            </section>
          )}
          {!data.documents.length && !data.annotations.length && (
            <p className="trash-empty">回收站为空</p>
          )}
        </>
      )}
    </Dialog>
  );
}
