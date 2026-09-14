import "@expo/metro-runtime";
import TrackPlayer from "@rntp/player";

const BACKGROUND_HANDLER_KEY = "__auricRntpBackgroundHandlerRegistered";

if (!globalThis[BACKGROUND_HANDLER_KEY]) {
  TrackPlayer.registerBackgroundEventHandler(() => async (event) => {
    const {
      handleBackgroundPlaybackEvent,
    } = require("./src/services/audio/playbackSession");
    await handleBackgroundPlaybackEvent(event);
  });
  globalThis[BACKGROUND_HANDLER_KEY] = true;
}

require("expo-router/entry");
