/** Resolve all queue mutation against stable entry IDs and the latest queue snapshot. */
function moveEntryRelative(entries, entryId, targetEntryId, placement) {
  const from = entries.findIndex((entry) => entry.id === entryId);
  const target = entries.findIndex((entry) => entry.id === targetEntryId);
  if (
    from < 0 ||
    target < 0 ||
    entryId === targetEntryId ||
    !["before", "after"].includes(placement)
  ) {
    return { entries, changed: false };
  }

  const next = [...entries];
  const [dragged] = next.splice(from, 1);
  const latestTarget = next.findIndex((entry) => entry.id === targetEntryId);
  const insertionIndex = latestTarget + (placement === "after" ? 1 : 0);
  next.splice(insertionIndex, 0, dragged);

  const changed = next.some((entry, index) => entry !== entries[index]);
  return { entries: changed ? next : entries, changed };
}

function removeEntryById(entries, entryId) {
  if (!entries.some((entry) => entry.id === entryId)) {
    return { entries, changed: false };
  }
  return {
    entries: entries.filter((entry) => entry.id !== entryId),
    changed: true,
  };
}

module.exports = {
  moveEntryRelative,
  removeEntryById,
};
