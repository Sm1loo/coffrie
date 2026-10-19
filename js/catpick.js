export function categoryOptions(ledger, kind, { selected = null, noneLabel = null, exclude = new Set() } = {}) {
  const options = noneLabel ? [{ value: null, label: noneLabel, level: 0 }] : [];
  for (const { category, children } of ledger.categoryTree(kind, { includeArchived: true })) {
    const showParent = (!category.archived || category.id === selected) && !exclude.has(category.id);
    const shownChildren = children
      .filter((child) => (!child.archived && !category.archived) || child.id === selected)
      .filter((child) => !exclude.has(child.id));
    if (!showParent && shownChildren.length === 0) continue;
    options.push({ value: category.id, label: category.name, level: 0, disabled: !showParent });
    for (const child of shownChildren) {
      options.push({ value: child.id, label: child.name, fullLabel: `${category.name} › ${child.name}`, level: 1 });
    }
  }
  return options;
}
