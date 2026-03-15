'use strict';

/**
 * Main orchestrator.
 *
 * Ties together the four phases:
 *   1. Wait for the BBB waiting room to open.
 *   2. Join the meeting via Puppeteer.
 *   3. Start FFmpeg recording / restreaming.
 *   4. Wait for meeting end, stop FFmpeg, close browser, upload to PeerTube.
 */

const config = require('./config');
const logger = require('./logger');
const { waitForMeetingOpen } = require('./watcher');
const { joinMeeting, waitForMeetingEnd } = require('./joiner');
const { startRecording, stopRecording } = require('./recorder');
const { uploadToPeerTube } = require('./uploader');

async function main() {
  logger.info('=== BBB Recorder starting ===');
  logger.info(`Room URL : ${config.bbbRoomUrl}`);
  logger.info(`Bot name : ${config.botName}`);
  logger.info(`Display  : ${config.display}`);

  // ── Phase 1: Wait until the meeting is open ──────────────────────────────
  await waitForMeetingOpen(config.bbbRoomUrl, config.pollIntervalMs);

  // ── Phase 2: Join the meeting ─────────────────────────────────────────────
  const { browser, page } = await joinMeeting(
    config.bbbRoomUrl,
    config.botName,
    config.display,
    config.accessCode,
    config.captureResolution
  );

  // ── Phase 3: Start recording / streaming ─────────────────────────────────
  const { process: ffmpegProcess, outputPath } = startRecording({
    display: config.display,
    pulseSource: config.pulseSource,
    recordingsDir: config.recordingsDir,
    rtmpUrl: config.rtmpUrl || undefined,
    framerate: config.captureFramerate,
    resolution: config.captureResolution,
  });

  // ── Phase 4: Monitor for meeting end ─────────────────────────────────────
  try {
    await waitForMeetingEnd(page);
  } finally {
    logger.info('=== Meeting ended – cleaning up ===');

    // Stop FFmpeg gracefully so the MP4 container is properly finalised
    await stopRecording(ffmpegProcess);

    // Close the browser
    try {
      await browser.close();
      logger.info('[Main] Browser closed.');
    } catch (err) {
      logger.warn(`[Main] Browser close error: ${err.message}`);
    }
  }

  // ── Upload to PeerTube (if configured) ───────────────────────────────────
  if (config.peertubeUrl && config.peertubeUsername && config.peertubePassword) {
    try {
      const videoUrl = await uploadToPeerTube({
        baseUrl: config.peertubeUrl,
        username: config.peertubeUsername,
        password: config.peertubePassword,
        channelId: config.peertubeChannelId,
        filePath: outputPath,
      });
      logger.info(`[Main] Video available at: ${videoUrl}`);
    } catch (err) {
      logger.error(`[Main] PeerTube upload failed: ${err.message}`);
    }
  } else {
    logger.info('[Main] PeerTube upload skipped (credentials not configured).');
  }

  logger.info('=== BBB Recorder finished ===');
}

main().catch((err) => {
  logger.error(`[Main] Fatal error: ${err.message}`, err);
  process.exit(1);
});
