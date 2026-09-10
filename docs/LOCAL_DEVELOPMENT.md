# Local Auric API configuration

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_AURIC_API_URL` to the origin of
Auric-server. Expo embeds `EXPO_PUBLIC_` variables in the client bundle.

- Android emulator: use `http://10.0.2.2:3000` for a server listening on the host.
- Physical Android phone: use the development PC's LAN address, such as
  `http://192.168.1.20:3000`; `localhost` points to the phone itself. The server must
  listen on a LAN-accessible host and the firewall must permit the port.
- Set `EXPO_PUBLIC_AURIC_USE_MOCKS=true`, or omit the API URL, to retain the mock
  search/library behavior for isolated UI development.

Restart Expo after changing environment variables. Streaming is intentionally not
configured here; Task 7 will connect ready Tracks to real audio playback.
