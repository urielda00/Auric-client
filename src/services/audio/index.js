import { MockAudioEngine } from "./MockAudioEngine";
import { ExpoAudioEngine } from "./ExpoAudioEngine";
import { apiConfig } from "../apiConfig";

const { selectAudioEngine } = require("./engineSelection.cjs");

/**
 * Active engine singleton. Swapping mock-for-real later is one line:
 *   import { ExpoAudioEngine } from './ExpoAudioEngine';
 *   export const audioEngine = new ExpoAudioEngine();
 */
export const audioEngine = selectAudioEngine({
  useServer: apiConfig.useServer,
  createMock: () => new MockAudioEngine(),
  createExpo: () => new ExpoAudioEngine(),
});

export default audioEngine;
