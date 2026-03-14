'use strict';

/**
 * Phase 1 – Waiting-room watcher.
 *
 * Polls the public BBB room URL at a configurable interval.  Returns as soon
 * as the join / guest-name form is visible (i.e. the meeting is open).
 *
 * Detects "waiting for moderator" state by checking for known BBB / Greenlight
 * strings in the page HTML.
 */

const axios = require('axios');
const logger = require('./logger');

/**
 * Strings that indicate the room is NOT yet open.
 * BBB / Greenlight uses these in various locales; add more as needed.
 */
const WAITING_PATTERNS = [
  /waiting for moderator/i,
  /warten auf moderator/i,
  /wait for the moderator/i,
  /en attente du mod/i,
  /esperando al moderador/i,
];

/**
 * Strings that indicate the join form / name input is visible and we can proceed.
 */
const JOIN_PATTERNS = [
  /type="text"[^>]*name/i,      // generic name input
  /id="guest-name"/i,
  /name="guest_name"/i,
  /join-meeting/i,
  /btn-join/i,
  /joinButton/i,
];

/**
 * Poll `url` until the meeting is open.
 *
 * @param {string} url            BBB room URL to poll.
 * @param {number} intervalMs     Polling interval in milliseconds.
 * @param {object} [axiosConfig]  Optional axios request config (timeouts, headers, …).
 * @returns {Promise<void>}       Resolves when the meeting is open.
 */
async function waitForMeetingOpen(url, intervalMs, axiosConfig = {}) {
  logger.info(`[Watcher] Starting to poll: ${url}`);
  logger.info(`[Watcher] Poll interval: ${intervalMs / 1000}s`);

  for (;;) {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        validateStatus: () => true, // don't throw on 4xx/5xx
        ...axiosConfig,
      });

      const html = typeof response.data === 'string' ? response.data : '';

      const isWaiting = WAITING_PATTERNS.some((re) => re.test(html));
      const isOpen = JOIN_PATTERNS.some((re) => re.test(html));

      if (isWaiting) {
        logger.info('[Watcher] Room not yet open (waiting for moderator). Retrying…');
      } else if (isOpen) {
        logger.info('[Watcher] Meeting is open – proceeding to join.');
        return;
      } else {
        // Unexpected page state – log and keep polling
        logger.warn(
          `[Watcher] Unknown page state (HTTP ${response.status}). ` +
            'Could not detect waiting or join patterns. Retrying…'
        );
      }
    } catch (err) {
      logger.error(`[Watcher] HTTP request failed: ${err.message}. Retrying…`);
    }

    await sleep(intervalMs);
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { waitForMeetingOpen };
