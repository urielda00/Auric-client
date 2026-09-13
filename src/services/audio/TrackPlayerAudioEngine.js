import TrackPlayer, { PlayerCommand } from "@rntp/player";
import { PermissionsAndroid, Platform } from "react-native";
import { authSession } from "../authSession";
import { musicService } from "../musicService";
import { serverApi } from "../serverApi";

const {
  TrackPlayerAudioEngineCore,
} = require("./TrackPlayerAudioEngineCore.cjs");

export class TrackPlayerAudioEngine extends TrackPlayerAudioEngineCore {
  constructor() {
    super({
      player: {
        ...TrackPlayer,
        commands: PlayerCommand,
      },
      createSource: (track) => musicService.getStreamSource(track),
      onAuthenticationFailure: (failedToken) => {
        if (failedToken) return authSession.clearIfCurrent(failedToken);
        return false;
      },
      onSourceFailure: async ({ trackId, failedToken }) => {
        if (!trackId || !failedToken || !serverApi) return false;
        try {
          await serverApi.get(`/api/v1/tracks/${encodeURIComponent(trackId)}`);
          return false;
        } catch (error) {
          return error?.status === 401 || error?.status === 403;
        }
      },
    });
    this.notificationPermissionRequested = false;
  }

  play() {
    const result = super.play();
    this._requestNotificationPermissionAfterPlaybackStarts();
    return result;
  }

  _requestNotificationPermissionAfterPlaybackStarts() {
    if (
      this.notificationPermissionRequested ||
      Platform.OS !== "android" ||
      Number(Platform.Version) < 33
    ) {
      return;
    }
    this.notificationPermissionRequested = true;
    void PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ).catch(() => {});
  }
}

export default TrackPlayerAudioEngine;
