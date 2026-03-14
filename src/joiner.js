'use strict';

/**
 * Phase 2 – Automated BBB joiner.
 *
 * Uses Puppeteer (headless Chromium) to:
 *   1. Navigate to the BBB room URL.
 *   2. If the room has an access code, enter it on the first page and submit.
 *   3. Enter a guest name on the (now visible) name-entry page and click Join.
 *   4. Wait for the audio dialog and click "Listen Only".
 *   5. Verify that the main conference view is loaded.
 *
 * Returns the open Puppeteer browser and page so the caller can keep watching
 * for the meeting-end event.
 */

const puppeteer = require('puppeteer-core');
const logger = require('./logger');

// Default path to Chromium inside the Docker image
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

/**
 * Selectors used to navigate the BBB Greenlight / HTML5 client.
 * Adjust these if your BBB version uses different class names / aria-labels.
 */
const SELECTORS = {
  // Greenlight "join as guest" page + BBB HTML5 client guest-join form.
  // Ordered from most specific to most generic; extend as BBB versions evolve.
  nameInput: [
    'input#name',
    'input[name="name"]',
    'input[id="guest-name"]',
    'input[placeholder*="ame"]',          // "Name", "Ihr Name", "Your name", …
    'input[data-test="name"]',             // BBB HTML5 client
    'input[data-test="inputField"]',       // BBB HTML5 (alternate)
    'input[aria-label*="name" i]',         // Accessibility-based label
  ].join(', '),

  // Access code / room password (present only when the room owner has set one)
  accessCodeInput: [
    'input#access-code',
    'input[name="access_code"]',
    'input[id="access_code"]',
    'input[name="room_access_code"]',
    'input[placeholder*="access" i]',
    'input[placeholder*="code" i]',
    'input[placeholder*="password" i]',
  ].join(', '),

  joinButton: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button.btn-primary',
    '#room-join',
    '[data-test="joinButton"]',            // BBB HTML5 client
    'button[data-test="join"]',            // BBB HTML5 (alternate)
  ].join(', '),

  // BBB HTML5 client – audio modal
  // BBB shows a modal with "Microphone" and "Listen Only" buttons
  listenOnlyButton: [
    '[data-test="listenOnlyButton"]',      // BBB HTML5 client (primary)
    'button[aria-label="Listen only"]',
    'button[aria-label="Nur zuhören"]',
    'button[aria-label="Nur Zuhören"]',
    '#listenOnlyBtn',
    '.listen-only',
    'button.connectBtn',
  ].join(', '),

  // Generic close/dismiss buttons for any modal that might appear after
  // joining (e.g. cookie notice, browser-support banners, overlay prompts).
  genericCloseButton: [
    'button[aria-label="Close"]',
    'button[aria-label="Schließen"]',
    'button[aria-label="close"]',
    '[data-test="closeModal"]',
    '[data-test="modalDismissButton"]',
    '.modal-close',
    '.close-btn',
    'button.close',
  ].join(', '),

  // Confirmation that we are inside the meeting
  meetingConfirm: [
    '#whiteboard-paper',
    '.presentation-area',
    '.chat-area',
    '[data-test="presentationContainer"]',
    '[data-test="chatMessageList"]',
    '.ReactModal__Overlay', // audio modal itself counts
  ].join(', '),

  // End-of-meeting indicators
  meetingEnded: [
    '[data-test="meetingEndedModal"]',
    '.meeting-ended',
    '#meeting-ended',
  ].join(', '),

  meetingEndedText: 'This meeting has ended',
};

/**
 * Launch Puppeteer, join the BBB room, and select "Listen Only" audio.
 *
 * @param {string} url         BBB room URL.
 * @param {string} botName     Display name for the bot.
 * @param {string} display     X display string (e.g. ":99").
 * @param {string} [accessCode] Optional access code for protected rooms.
 * @returns {Promise<{browser: import('puppeteer-core').Browser, page: import('puppeteer-core').Page}>}
 */
async function joinMeeting(url, botName, display, accessCode = '') {
  logger.info('[Joiner] Launching Chromium…');

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: false, // must be false so Xvfb captures the window
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-features=IsolateOrigins,site-per-process',
      `--display=${display}`,
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      // Ensure the browser window fills the entire virtual display so FFmpeg
      // captures a full 1920×1080 frame without black bars.
      '--window-position=0,0',
      '--window-size=1920,1080',
      '--start-maximized',
    ],
    env: {
      ...process.env,
      DISPLAY: display,
    },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Navigate to the room / Greenlight join page
  logger.info(`[Joiner] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // ── Step 1: Access code page (shown BEFORE the name-entry page) ───────────
  // BBB/Greenlight shows an access-code form first when the room is protected.
  // Only attempt this when an access code was configured.
  if (accessCode) {
    logger.info('[Joiner] Access code configured – checking for access code page…');
    try {
      await page.waitForSelector(SELECTORS.accessCodeInput, { timeout: 10000 });
      logger.info('[Joiner] Access code page detected – entering code…');
      await page.$eval(SELECTORS.accessCodeInput, (el, value) => {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, accessCode);

      // Submit the access-code form and wait for the name-entry page to load.
      // waitForNavigation is best-effort: some BBB variants update the page via
      // AJAX without a full navigation, so a TimeoutError here is not fatal.
      await page.waitForSelector(SELECTORS.joinButton, { timeout: 5000 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch((navErr) => {
          logger.warn(`[Joiner] Navigation after access code submit did not complete: ${navErr.message}`);
        }),
        page.click(SELECTORS.joinButton),
      ]);
      logger.info('[Joiner] Access code submitted – proceeding to name-entry page.');
    } catch (err) {
      logger.warn(`[Joiner] Access code page not found or could not be submitted: ${err.message}`);
    }
  }

  // ── Step 2: Name-entry page ───────────────────────────────────────────────
  logger.info(`[Joiner] Entering bot name: ${botName}`);
  try {
    await page.waitForSelector(SELECTORS.nameInput, { timeout: 30000 });
  } catch (err) {
    // Log page URL and title to aid debugging, then re-throw
    try {
      const title = await page.title();
      const currentUrl = page.url();
      logger.error(`[Joiner] Name input not found. Page: "${title}" at ${currentUrl}`);
      await page.screenshot({ path: '/tmp/bbb-joiner-debug.png', fullPage: true });
      logger.error('[Joiner] Debug screenshot saved to /tmp/bbb-joiner-debug.png');
    } catch (screenshotErr) {
      logger.warn(`[Joiner] Could not capture debug screenshot: ${screenshotErr.message}`);
    }
    throw err;
  }
  await page.$eval(SELECTORS.nameInput, (el, value) => {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, botName);

  // Click Join
  logger.info('[Joiner] Clicking Join button…');
  await page.waitForSelector(SELECTORS.joinButton, { timeout: 10000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.click(SELECTORS.joinButton),
  ]);

  // Wait for BBB HTML5 client to load (audio modal or main view)
  logger.info('[Joiner] Waiting for BBB HTML5 client to load…');
  await page.waitForSelector(SELECTORS.meetingConfirm, { timeout: 90000 });

  // Click "Listen Only" if the audio modal is visible
  try {
    logger.info('[Joiner] Waiting for audio dialog…');
    await page.waitForSelector(SELECTORS.listenOnlyButton, { timeout: 15000 });
    logger.info('[Joiner] Audio dialog detected – clicking "Listen Only"…');
    await page.click(SELECTORS.listenOnlyButton);
    // Wait for the dialog to close before proceeding
    await page
      .waitForSelector(SELECTORS.listenOnlyButton, { hidden: true, timeout: 10000 })
      .catch(() => {
        logger.warn('[Joiner] Audio dialog did not disappear within 10 s – continuing anyway.');
      });
    logger.info('[Joiner] Audio dialog dismissed.');
  } catch (err) {
    logger.warn(`[Joiner] Could not dismiss audio dialog: ${err.message}`);
  }

  // Dismiss any remaining overlay modals (e.g. cookie notices, banners) that
  // could block the recording view.
  await dismissRemainingModals(page);

  // Verify we are in the main meeting view
  await verifyInMeeting(page);

  logger.info('[Joiner] Successfully joined the meeting.');
  return { browser, page };
}

/**
 * Try to dismiss any modal dialogs that may still be open after the audio
 * selection step.  These include generic close buttons, overlay banners, and
 * any other BBB UI element that sits in front of the presentation view.
 * Loops until no more dismissible modals are found (up to maxAttempts).
 *
 * @param {import('puppeteer-core').Page} page
 * @param {number} [maxAttempts=5]
 */
async function dismissRemainingModals(page, maxAttempts = 5) {
  logger.info('[Joiner] Checking for remaining modal dialogs…');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const closeBtn = await page.$(SELECTORS.genericCloseButton);
      if (!closeBtn) {
        logger.info('[Joiner] No remaining modals detected.');
        break;
      }
      logger.info(`[Joiner] Found a remaining modal (attempt ${attempt}) – clicking close button…`);
      await closeBtn.click();
      // Wait for the clicked element to be removed from the DOM before checking again
      await page
        .waitForSelector(SELECTORS.genericCloseButton, { hidden: true, timeout: 5000 })
        .catch(() => {
          logger.warn('[Joiner] Modal did not disappear within 5 s – continuing.');
        });
    } catch (err) {
      logger.warn(`[Joiner] Could not dismiss remaining modal: ${err.message}`);
      break;
    }
  }
}

/**
 * Wait until the meeting is confirmed as active (presentation / chat visible).
 *
 * @param {import('puppeteer-core').Page} page
 */
async function verifyInMeeting(page) {
  logger.info('[Joiner] Verifying main meeting view is loaded…');
  try {
    await page.waitForSelector(SELECTORS.meetingConfirm, { timeout: 30000 });
    logger.info('[Joiner] Main meeting view confirmed.');
  } catch {
    logger.warn('[Joiner] Could not confirm main meeting view – continuing anyway.');
  }
}

/**
 * Wait until BBB shows a "meeting ended" indication on `page`.
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<void>}  Resolves when the meeting has ended.
 */
async function waitForMeetingEnd(page) {
  logger.info('[Joiner] Monitoring for meeting-end event…');

  return new Promise((resolve) => {
    // Poll every 5 seconds
    const interval = setInterval(async () => {
      try {
        const ended = await page.evaluate((endedSelector, endedText) => {
          // Check for explicit "meeting ended" modal
          if (document.querySelector(endedSelector)) return true;
          // Check for the disconnect / ended text anywhere on the page
          return document.body.innerText.includes(endedText);
        }, SELECTORS.meetingEnded, SELECTORS.meetingEndedText);

        if (ended) {
          clearInterval(interval);
          logger.info('[Joiner] Meeting-end event detected.');
          resolve();
        }
      } catch (err) {
        // Page might be navigating / closed
        if (err.message.includes('Session closed') || err.message.includes('detached')) {
          clearInterval(interval);
          logger.info('[Joiner] Page session closed – treating as meeting end.');
          resolve();
        }
      }
    }, 5000);
  });
}

module.exports = { joinMeeting, waitForMeetingEnd };
