function normalizeSearch(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

module.exports = { normalizeSearch };
