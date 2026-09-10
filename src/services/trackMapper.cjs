function mapTrackDto(dto) {
  if (
    !dto ||
    typeof dto !== "object" ||
    typeof dto.id !== "string" ||
    typeof dto.title !== "string"
  ) {
    throw new Error("Invalid Track response");
  }
  if (
    !Array.isArray(dto.artists) ||
    dto.artists.some((artist) => typeof artist !== "string")
  ) {
    throw new Error("Invalid Track artists response");
  }
  const validNullableString = (value) =>
    value === null || typeof value === "string";
  const validNullableNumber = (value) =>
    value === null || (typeof value === "number" && Number.isFinite(value));
  if (
    !validNullableString(dto.version) ||
    !validNullableString(dto.album) ||
    !validNullableString(dto.genre) ||
    !validNullableNumber(dto.release_year) ||
    !validNullableNumber(dto.duration_ms) ||
    typeof dto.has_media !== "boolean"
  ) {
    throw new Error("Invalid Track metadata response");
  }
  return {
    id: dto.id,
    title: dto.title,
    artists: [...dto.artists],
    version: dto.version ?? null,
    album: dto.album ?? null,
    releaseYear: dto.release_year ?? null,
    genre: dto.genre ?? null,
    durationMs: dto.duration_ms ?? null,
    hasMedia: dto.has_media === true,
    visualSeed: dto.id,
    aliases: [],
  };
}

function isTrackPlayable(track) {
  return track?.hasMedia === true;
}

module.exports = { isTrackPlayable, mapTrackDto };
