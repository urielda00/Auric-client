import { MockAudioEngine } from './MockAudioEngine';

/**
 * Active engine singleton. Swapping mock-for-real later is one line:
 *   import { ExpoAudioEngine } from './ExpoAudioEngine';
 *   export const audioEngine = new ExpoAudioEngine();
 */
export const audioEngine = new MockAudioEngine();

export default audioEngine;
