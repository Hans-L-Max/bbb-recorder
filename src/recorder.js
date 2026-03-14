'use strict';

/**
 * Phase 3 – Recording and restreaming via FFmpeg.
 *
 * Captures:
 *   - Video: X11 display (Xvfb) via the x11grab input device.
 *   - Audio: PulseAudio monitor source via the pulse input device.
 *
 * Sends the stream to:
 *   - An RTMP URL for live streaming (optional).
 *   - A local MP4 file for archiving.
 *
 * Uses the FFmpeg tee muxer when both outputs are configured, otherwise
 * writes only to the file.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

/**
 * Build the output filename with the current timestamp.
 *
 * @param {string} dir  Directory for recordings.
 * @returns {string}    Absolute path to the output file.
 */
function buildOutputPath(dir) {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return path.join(dir, `stream_${stamp}.mp4`);
}

/**
 * Start FFmpeg recording.
 *
 * @param {object} opts
 * @param {string}  opts.display        X display string (e.g. ":99").
 * @param {string}  opts.pulseSource    PulseAudio source name.
 * @param {string}  opts.recordingsDir  Directory for the output file.
 * @param {string}  [opts.rtmpUrl]      Optional RTMP destination URL.
 * @param {number}  [opts.framerate]    Capture framerate (default 25).
 * @param {string}  [opts.resolution]   Capture resolution, e.g. "1280x720".
 * @returns {{ process: import('child_process').ChildProcess, outputPath: string }}
 */
function startRecording({ display, pulseSource, recordingsDir, rtmpUrl, framerate = 25, resolution = '1280x720' }) {
  // Ensure output directory exists
  fs.mkdirSync(recordingsDir, { recursive: true });

  const outputPath = buildOutputPath(recordingsDir);
  logger.info(`[Recorder] Output file: ${outputPath}`);

  const ffmpegArgs = buildFfmpegArgs({ display, pulseSource, outputPath, rtmpUrl, framerate, resolution });
  logger.info(`[Recorder] Starting FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);

  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  ffmpegProcess.stdout.on('data', (data) => {
    logger.debug(`[FFmpeg] ${data.toString().trim()}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    // FFmpeg writes progress to stderr
    logger.debug(`[FFmpeg] ${data.toString().trim()}`);
  });

  ffmpegProcess.on('error', (err) => {
    logger.error(`[Recorder] FFmpeg process error: ${err.message}`);
  });

  ffmpegProcess.on('exit', (code, signal) => {
    logger.info(`[Recorder] FFmpeg exited with code=${code} signal=${signal}`);
  });

  logger.info('[Recorder] FFmpeg started.');
  return { process: ffmpegProcess, outputPath };
}

/**
 * Gracefully stop the FFmpeg process by sending SIGINT so it finalises
 * the MP4 container before exiting.
 *
 * @param {import('child_process').ChildProcess} ffmpegProcess
 * @returns {Promise<void>}  Resolves when FFmpeg has exited.
 */
function stopRecording(ffmpegProcess) {
  return new Promise((resolve) => {
    if (!ffmpegProcess || ffmpegProcess.exitCode !== null) {
      resolve();
      return;
    }

    ffmpegProcess.once('exit', () => resolve());

    logger.info('[Recorder] Sending SIGINT to FFmpeg for graceful shutdown…');
    ffmpegProcess.kill('SIGINT');

    // Safety timeout: if FFmpeg does not exit in 30 s, force-kill it
    setTimeout(() => {
      if (ffmpegProcess.exitCode === null) {
        logger.warn('[Recorder] FFmpeg did not stop in time – sending SIGTERM.');
        ffmpegProcess.kill('SIGTERM');
      }
    }, 30000);
  });
}

/**
 * Build the FFmpeg argument list.
 *
 * @param {object} opts
 * @returns {string[]}
 */
function buildFfmpegArgs({ display, pulseSource, outputPath, rtmpUrl, framerate = 25, resolution = '1280x720' }) {
  // Common input / encode settings
  const args = [
    '-loglevel', 'warning',

    // Video input: X11 display
    '-f', 'x11grab',
    '-framerate', String(framerate),
    '-video_size', resolution,
    '-i', display,

    // Audio input: PulseAudio
    '-f', 'pulse',
    '-i', pulseSource,

    // Video codec
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',

    // Audio codec
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
  ];

  if (rtmpUrl) {
    // Tee muxer: send to both RTMP and local file simultaneously
    // Format: [select=...]<destination>
    args.push(
      '-f', 'tee',
      '-map', '0:v',
      '-map', '1:a',
      `[f=flv]${rtmpUrl}|[f=mp4]${outputPath}`
    );
  } else {
    // Only local file
    args.push(
      '-map', '0:v',
      '-map', '1:a',
      '-f', 'mp4',
      outputPath
    );
  }

  return args;
}

module.exports = { startRecording, stopRecording, buildOutputPath };
