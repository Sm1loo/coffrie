export function groupByRoot(entries) {
  const roots = new Map();
  for (const entry of entries) {
    const hasCategory = entry.categoryId !== null;
    const rootId = hasCategory ? (entry.parentId ?? entry.categoryId) : null;
    const rootName = !hasCategory ? null : entry.parentId === null ? entry.name : entry.parentName;
    const group = roots.get(rootId) ?? { rootId, name: rootName, total: 0, own: 0, children: [] };
    group.total += entry.total;
    if (entry.parentId === null || !hasCategory) group.own += entry.total;
    else group.children.push({ categoryId: entry.categoryId, name: entry.name, total: entry.total });
    roots.set(rootId, group);
  }
  const groups = [...roots.values()];
  for (const group of groups) group.children.sort((a, b) => b.total - a.total);
  return groups.sort((a, b) => b.total - a.total);
}
