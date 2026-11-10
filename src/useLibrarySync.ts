import { subscribeLive } from "./live";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { api } from "./api";

type Document = { id: string; progress: number };
/** Library changes can originate in another tab or an agent, without changing the open reader. */
export function useLibrarySync<T extends Document, A>({ selected, setDocuments, setSelected, setAnnotations }: {
  selected: T | null;
  setDocuments: Dispatch<SetStateAction<T[]>>;
  setSelected: Dispatch<SetStateAction<T | null>>;
  setAnnotations: Dispatch<SetStateAction<A[]>>;
}) {
  const current = useRef(selected);
  current.current = selected;
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    let retry = 1000;
    const refresh = async (request: number) => {
      const documentId = current.current?.id;
      try {
        const documents: T[] = await api("/documents");
        const exists = documents.some(document => document.id === documentId);
        const annotations: A[] | undefined = documentId && exists
          ? await api(`/documents/${documentId}/annotations`) : undefined;
        if (disposed || request !== revision) return;
        retry = 1000;
        setDocuments(documents);
        // An old request must never reopen a reader the user closed or switched.
        if (current.current?.id !== documentId) return;
        setSelected(previous => {
          if (!previous || previous.id !== documentId) return previous;
          const next = documents.find(document => document.id === previous.id);
          if (!next) {
            sessionStorage.removeItem("litanvil-open-document");
            return null;
          }
          return { ...next, progress: previous.progress };
        });
        if (documentId) setAnnotations(annotations || []);
      } catch (error) {
        if (disposed || request !== revision) return;
        console.warn("[Library] live sync failed; retrying", error);
        timer = setTimeout(() => void refresh(request), retry);
        retry = Math.min(15000, retry * 2);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      const request = ++revision;
      timer = setTimeout(() => void refresh(request), 80);
    };
    const unsubscribe = subscribeLive("library", schedule);
    // Every reconnect receives a fresh event, recovering changes made while offline.
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }, [setDocuments, setSelected, setAnnotations]);
}
