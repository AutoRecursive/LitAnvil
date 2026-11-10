export const API = "http://localhost:8787/api";
export async function api(path: string, init?: RequestInit) {
  const response = await fetch(API + path, init);
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
