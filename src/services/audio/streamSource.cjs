function createTrackStreamSource(baseUrl, trackId, headers = {}) {
  const origin =
    typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  if (!origin) throw new Error("Auric API base URL is not configured");
  if (typeof trackId !== "string" || !trackId)
    throw new Error("Track ID is required");
  return {
    uri: `${origin}/api/v1/tracks/${encodeURIComponent(trackId)}/stream`,
    headers: { Accept: "audio/mp4", ...headers },
  };
}

module.exports = { createTrackStreamSource };
