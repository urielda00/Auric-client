import { MockAudioEngine } from "./MockAudioEngine";
import { TrackPlayerAudioEngine } from "./TrackPlayerAudioEngine";
import { apiConfig } from "../apiConfig";

const { selectAudioEngine } = require("./engineSelection.cjs");

/**
 * Active engine singleton. Native-player details remain behind AudioEngine.
 */
export const audioEngine = selectAudioEngine({
  useServer: apiConfig.useServer,
  createMock: () => new MockAudioEngine(),
  createNative: () => new TrackPlayerAudioEngine(),
});

export default audioEngine;
