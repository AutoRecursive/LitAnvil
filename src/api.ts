export const API = "http://localhost:8787/api";
export async function api(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const upstream = init?.signal;
  const abort = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) abort();
    else upstream.addEventListener("abort", abort, { once: true });
  }
  let response: Response;
  try {
    response = await fetch(API + path, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("请求超时或已取消，请检查网络后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
    upstream?.removeEventListener("abort", abort);
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {}
    throw new Error(message);
  }
  const result = await response.json();
  if (typeof result?.warning === "string")
    window.dispatchEvent(
      new CustomEvent("litanvil-warning", { detail: result.warning }),
    );
  return result;
}

export function assetUrl(fileUrl: string) {
  return new URL(fileUrl, API.replace(/\/api$/, "") + "/").href;
}
