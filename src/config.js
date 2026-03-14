'use strict';

/**
 * Configuration loaded from environment variables.
 * Copy .env.example to .env and fill in the values before running.
 */

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable "${name}" is not set.`);
  }
  return value;
}

function optional(name, defaultValue) {
  return process.env[name] || defaultValue;
}

const config = {
  // BigBlueButton room URL (Greenlight link)
  bbbRoomUrl: required('BBB_ROOM_URL'),

  // Optional access code required to enter a protected BBB room
  accessCode: optional('BBB_ACCESS_CODE', ''),

  // Name shown in the conference when the bot joins
  botName: optional('BOT_NAME', 'Stream-Bot'),

  // How often (in milliseconds) to poll the waiting room
  pollIntervalMs: parseInt(optional('POLL_INTERVAL_MS', '60000'), 10),

  // RTMP target URL for the live stream (e.g. rtmp://peertube.example.com/live/streamkey)
  rtmpUrl: optional('RTMP_URL', ''),

  // Directory where recordings are stored
  recordingsDir: optional('RECORDINGS_DIR', '/app/recordings'),

  // Virtual display used by Xvfb / Puppeteer
  display: optional('DISPLAY', ':99'),

  // PulseAudio source name for FFmpeg audio capture
  pulseSource: optional('PULSE_SOURCE', 'virtual_sink.monitor'),

  // PeerTube instance base URL (e.g. https://peertube.example.com)
  peertubeUrl: optional('PEERTUBE_URL', ''),

  // PeerTube credentials
  peertubeUsername: optional('PEERTUBE_USERNAME', ''),
  peertubePassword: optional('PEERTUBE_PASSWORD', ''),

  // PeerTube channel id where the video will be uploaded
  peertubeChannelId: parseInt(optional('PEERTUBE_CHANNEL_ID', '1'), 10),

  // FFmpeg capture framerate
  captureFramerate: parseInt(optional('CAPTURE_FRAMERATE', '25'), 10),

  // Capture resolution (WxH)
  captureResolution: optional('CAPTURE_RESOLUTION', '1280x720'),
};

module.exports = config;
