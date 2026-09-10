import { Platform } from "react-native";
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { musicService } from "../musicService";

const { ExpoAudioEngineCore } = require("./ExpoAudioEngineCore.cjs");

export class ExpoAudioEngine extends ExpoAudioEngineCore {
  constructor() {
    super({
      audio: {
        createAudioPlayer,
        requestNotificationPermissionsAsync,
        setAudioModeAsync,
      },
      platformOS: Platform.OS,
      createSource: (track) => musicService.getStreamSource(track),
    });
  }
}

export default ExpoAudioEngine;
