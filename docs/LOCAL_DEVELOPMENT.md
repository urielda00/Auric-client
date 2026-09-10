# Local Auric API configuration

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_AURIC_API_URL` to the origin of
Auric-server. Expo embeds `EXPO_PUBLIC_` variables in the client bundle.

- Android emulator: use `http://10.0.2.2:3000` for a server listening on the host.
- Physical Android phone: use the development PC's LAN address, such as
  `http://192.168.1.20:3000`; `localhost` points to the phone itself. The server must
  listen on a LAN-accessible host and the firewall must permit the port.
- Set `EXPO_PUBLIC_AURIC_USE_MOCKS=true`, or omit the API URL, to retain mock
  library and `MockAudioEngine` behavior for isolated UI development.

Run the server with the canonical database and music directory configured. For the
read-only rehearsal copy, the equivalent PowerShell environment is:

```powershell
$env:AURIC_DATABASE_PATH = '<writable-copy-of-auric.sqlite>'
$env:AURIC_MUSIC_DIR = 'C:\path\to\Auric-server\var\rehearsal\final-library\music'
$env:HOST = '0.0.0.0' # LAN phone; keep 127.0.0.1 for emulator/adb reverse
npm run dev
```

Real background playback and Android media-session controls require a development
build; Expo Go does not contain Auric's generated foreground media service configuration.
After setting the environment variable, build and start with:

```sh
npx expo run:android
npx expo start --dev-client
```

For a USB-connected physical phone, `adb reverse tcp:3000 tcp:3000` permits
`EXPO_PUBLIC_AURIC_API_URL=http://127.0.0.1:3000`. Otherwise use the laptop LAN IP and
start Auric-server with `HOST=0.0.0.0`. The Android development build permits cleartext
HTTP for this local workflow; use HTTPS for any non-local endpoint.

On first real playback Android may ask for notification permission. Grant it to show
the media notification and sustain background playback. The installed `expo-audio`
57.0.4 media session supports system play/pause, timeline seeking, and 10-second
seek-back/seek-forward controls. It does not expose app callbacks for single-player
next/previous media buttons, so queue next/previous remain available in Auric's Mini
and Full Player UI.

Restart Expo after changing environment variables. The last track and position restore
paused; reopening the app never auto-starts audio.
