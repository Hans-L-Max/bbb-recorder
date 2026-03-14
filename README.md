# bbb-recorder

Automated BigBlueButton (BBB) recording and live-streaming bot.

The bot joins a BBB room as a silent guest, records everything via FFmpeg,
optionally live-streams to an RTMP endpoint (e.g. PeerTube Live), and uploads
the finished recording to PeerTube when the meeting ends.

## How it works

| Phase | Description |
|-------|-------------|
| **1 – Watcher** | Polls the public BBB room URL every 60 s until the join form appears (meeting is open). |
| **2 – Joiner** | Uses Puppeteer to enter a guest name, click *Join*, and select *Listen Only* audio. |
| **3 – Recorder** | Starts FFmpeg to capture the virtual X11 display and PulseAudio stream. Sends the feed to an RTMP URL and/or a local MP4 file simultaneously. |
| **4 – Cleaner** | Detects the meeting-end banner, gracefully stops FFmpeg (SIGINT), closes the browser, and uploads the recording to PeerTube. |

## Quick start with Docker (recommended)

```bash
# 1. Copy and edit the environment file
cp .env.example .env
$EDITOR .env   # fill in BBB_ROOM_URL at minimum

# 2. Build the image
docker build -t bbb-recorder .

# 3. Run
docker run --rm --env-file .env \
  -v "$(pwd)/recordings:/app/recordings" \
  bbb-recorder
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BBB_ROOM_URL` | ✅ | – | Full Greenlight / BBB room URL |
| `BOT_NAME` | | `Stream-Bot` | Display name used when joining |
| `POLL_INTERVAL_MS` | | `60000` | Waiting-room poll interval (ms) |
| `RTMP_URL` | | *(empty)* | RTMP stream destination; leave empty for recording only |
| `RECORDINGS_DIR` | | `/app/recordings` | Directory for output files |
| `PEERTUBE_URL` | | *(empty)* | PeerTube instance base URL |
| `PEERTUBE_USERNAME` | | *(empty)* | PeerTube username |
| `PEERTUBE_PASSWORD` | | *(empty)* | PeerTube password |
| `PEERTUBE_CHANNEL_ID` | | `1` | PeerTube channel id for uploads |
| `DISPLAY` | | `:99` | X display used by Xvfb / Puppeteer |
| `PULSE_SOURCE` | | `virtual_sink.monitor` | PulseAudio source for FFmpeg |
| `LOG_LEVEL` | | `info` | Winston log level |

## Running without Docker

Requires: Node.js ≥ 18, FFmpeg, Chromium, Xvfb, PulseAudio.

```bash
npm install
BBB_ROOM_URL=https://… node src/index.js
```

## Project structure

```
bbb-recorder/
├── src/
│   ├── index.js      – Main orchestrator
│   ├── config.js     – Environment-variable configuration
│   ├── logger.js     – Winston logger
│   ├── watcher.js    – Phase 1: waiting-room poller
│   ├── joiner.js     – Phase 2: Puppeteer automation
│   ├── recorder.js   – Phase 3: FFmpeg wrapper
│   └── uploader.js   – Phase 4: PeerTube upload
├── Dockerfile
├── entrypoint.sh     – Starts Xvfb + PulseAudio, then Node.js
├── .env.example
└── package.json
```