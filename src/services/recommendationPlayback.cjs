function prepareRecommendationPlayback(tracks, mode) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  if (mode !== "smart" && mode !== "random")
    throw new Error("Invalid shuffle mode");
  const [first, ...upcoming] = tracks;
  return {
    first,
    upcoming,
    shuffleMode: mode,
    context: {
      type: mode === "smart" ? "smart_shuffle" : "random_shuffle",
      label: mode === "smart" ? "Smart Shuffle" : "Random Shuffle",
    },
  };
}

module.exports = { prepareRecommendationPlayback };
