import { dispositionFilename, exportFormats, type ExportFormat } from "../shared/document-export.js";
/** MCP library operations reuse the same validated, serialized HTTP routes as the UI. */
export const libraryTools = [
  {name: "list_topics", description: "List recursive library topics with parentId and color. Null parentId means library root.", inputSchema: {type: "object", properties: {}}},
  {name: "manage_topic", description: "Create, update (rename, recolor, reparent), or delete a library topic. Deleting a topic moves its papers and child topics to its parent; papers are retained. Cyclic moves are rejected.", inputSchema: {type: "object", properties: {operation: {type: "string", enum: ["create", "update", "delete"]}, topicId: {type: "string"}, name: {type: "string"}, color: {type: "string"}, parentId: {type: ["string", "null"]}}, required: ["operation"]}},
  { name: "list_documents", description: "List active imported documents and their IDs.", inputSchema: { type: "object", properties: {} } },
  { name: "get_document", description: "Read a document's extracted text, metadata and annotations.", inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"] } },
  { name: "get_annotations", description: "Read editable annotations. A highlight is an annotation with an empty note. Notes support Markdown and math.", inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"] } },
  { name:"export_document",description:"Read an authoritative JSON or Markdown annotation export with a download URL. Does not save a file on the user's computer; control_reader download_annotations requests the browser download.",inputSchema:{type:"object",properties:{documentId:{type:"string"},format:{type:"string",enum:["json","markdown"]}},required:["documentId","format"]}},
  { name: "get_trash", description: "List recoverable deleted documents and annotations.", inputSchema: { type: "object", properties: {} } },
  { name: "manage_document", description: "Import a URL (cached; arXiv/PDF/web), move a paper to topicId (null = unfiled), rename a document, move it to recoverable trash or restore it. Never permanently deletes files. UI tabs update automatically. Use control_reader to open the returned document ID.", inputSchema: { type: "object", properties: {
    operation: { type: "string", enum: ["import", "rename", "move", "delete", "restore"] }, documentId: { type: "string" }, url: { type: "string" }, title: { type: "string" }, topicId: {type: ["string", "null"]},
  }, required: ["operation"] } },
  { name: "manage_annotation", description: "Create, update, delete or restore editable annotations. Empty note means highlight; note accepts Markdown/math. For anchored PDF annotations, use the location returned by control_reader preview_text, preserving normalized rectangles. preview_text alone never saves a record. Deletion is recoverable. All tabs update automatically.", inputSchema: { type: "object", properties: {
    operation: { type: "string", enum: ["create", "update", "delete", "restore"] }, annotationId: { type: "string" }, documentId: { type: "string" }, quote: { type: "string" }, note: { type: "string" }, location: { type: "string" }, color: { type: "string" },
  }, required: ["operation"] } },
];

export const qmdTools = [
  { name: "search_knowledge", description: "Read-only QMD search across all imported papers in the project notes index. Use this for cross-paper concepts, prior annotations and evidence. Set semantic=true when embeddings are available; otherwise the tool uses stable keyword search. Results include document IDs, scores, source lines and snippets; call get_document before relying on a result.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 }, semantic: { type: "boolean" } }, required: ["query"] } },
  { name: "find_similar_papers", description: "Read-only similarity search for the current paper across other imported papers. It uses QMD vectors when available and falls back to keyword retrieval when this machine has no embeddings. Excludes the current document. Use returned document IDs with get_document for comparison.", inputSchema: { type: "object", properties: { documentId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["documentId"] } },
];
export async function callLibraryTool(name: string, args: Record<string, unknown>, port: number) {
  const required = (key: string) => {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}`);
    return value;
  };
  const identifier = (key: string) => encodeURIComponent(required(key));
  if (name === "export_document") {
    if (args.format!=="json" && args.format!=="markdown") throw new Error("导出格式仅支持 json 或 markdown");
    const format:ExportFormat=args.format;
    const id=identifier("documentId");
    const url=`http://127.0.0.1:${port}/api/documents/${id}/export.${exportFormats[format].extension}`;
    const exported=await fetch(url);if(!exported.ok)throw new Error((await exported.json()).error);
    return {filename:dispositionFilename(exported.headers.get("Content-Disposition")) || `annotations.${exportFormats[format].extension}`,mimeType:exportFormats[format].mimeType,downloadUrl:url,content:await exported.text()};
  }
  let route: string;
  let method = "GET";
  let body: Record<string, unknown> | undefined;
  switch (name) {
    case "list_topics": route = "/topics"; break;
    case "manage_topic":
      if (args.operation === "create") { route = "/topics"; method = "POST"; body = {name: required("name")}; }
      else if (args.operation === "update") {route = `/topics/${identifier("topicId")}`; method = "PATCH"; body = {};}
      else if (args.operation === "delete") {route = `/topics/${identifier("topicId")}`; method = "DELETE";}
      else throw new Error("Invalid topic operation");
      if (body) for (const key of ["name", "color", "parentId"]) if (args[key] !== undefined) body[key] = args[key];
      break;
    case "list_documents": route = "/documents"; break;
    case "get_document": route = `/documents/${identifier("documentId")}`; break;
    case "get_annotations": route = `/documents/${identifier("documentId")}/annotations`; break;
    case "get_trash": route = "/trash"; break;
    case "manage_document":
      switch (args.operation) {
        case "import": route = "/import/url"; method = "POST"; body = { url: required("url"), ...(args.topicId !== undefined ? {topicId: args.topicId} : {}) }; break;
        case "move":
          if (args.topicId === undefined) throw new Error("Missing topicId (use null for unfiled)");
          route = `/documents/${identifier("documentId")}`; method = "PATCH"; body = {topicId: args.topicId}; break;
        case "rename": route = `/documents/${identifier("documentId")}`; method = "PATCH"; body = { title: required("title") }; break;
        case "delete": route = `/documents/${identifier("documentId")}`; method = "DELETE"; break;
        case "restore": route = `/documents/${identifier("documentId")}/restore`; method = "POST"; break;
        default: throw new Error("Invalid document operation");
      }
      break;
    case "manage_annotation":
      switch (args.operation) {
        case "create": route = "/annotations"; method = "POST"; body = { documentId: required("documentId"), quote: required("quote") }; break;
        case "update": route = `/annotations/${identifier("annotationId")}`; method = "PATCH"; body = {}; break;
        case "delete": route = `/annotations/${identifier("annotationId")}`; method = "DELETE"; break;
        case "restore": route = `/annotations/${identifier("annotationId")}/restore`; method = "POST"; break;
        default: throw new Error("Invalid annotation operation");
      }
      if (body) for (const key of ["quote", "note", "location", "color"]) {
        if (args[key] !== undefined) {
          if (typeof args[key] !== "string") throw new Error(`Invalid ${key}`);
          body[key] = args[key];
        }
      }
      break;
    default: throw new Error("Unknown tool");
  }
  const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
    method, headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Library operation failed (${response.status})`);
  return name === "list_documents" ? result.map(({ id, title, source, sourceType, progress, topicId }: any) => ({ id, title, source, sourceType, progress, topicId: topicId ?? null })) : result;
}
