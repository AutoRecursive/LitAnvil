export type Topic = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
};
export const topicColors = ["#6366f1", "#0d9488", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#64748b"];
export function topicDescendants(topics: Topic[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const topic of topics) if (topic.parentId && ids.has(topic.parentId) && !ids.has(topic.id)) {
      ids.add(topic.id);
      changed = true;
    }
  }
  return ids;
}
export function topicPath(topics: Topic[], id: string): string {
  const names: string[] = [], seen = new Set<string>();
  let topic = topics.find(topic => topic.id === id);
  while (topic && !seen.has(topic.id)) {
    seen.add(topic.id);
    names.unshift(topic.name);
    topic = topics.find(item => item.id === topic!.parentId);
  }
  return names.join(" / ");
}
