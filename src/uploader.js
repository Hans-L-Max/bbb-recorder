'use strict';

/**
 * Phase 4 – PeerTube upload.
 *
 * Authenticates against the PeerTube REST API and uploads the finished
 * recording as a new video.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('./logger');

/**
 * Obtain a PeerTube OAuth2 access token.
 *
 * @param {string} baseUrl   PeerTube instance base URL.
 * @param {string} username  PeerTube username.
 * @param {string} password  PeerTube password.
 * @returns {Promise<string>}  Access token.
 */
async function authenticate(baseUrl, username, password) {
  logger.info('[Uploader] Fetching PeerTube OAuth client credentials…');

  // Step 1: get client_id / client_secret
  const clientRes = await axios.get(`${baseUrl}/api/v1/oauth-clients/local`);
  const { client_id, client_secret } = clientRes.data;

  // Step 2: get access token
  logger.info('[Uploader] Authenticating with PeerTube…');
  const tokenRes = await axios.post(
    `${baseUrl}/api/v1/users/token`,
    new URLSearchParams({
      client_id,
      client_secret,
      grant_type: 'password',
      response_type: 'code',
      username,
      password,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  return tokenRes.data.access_token;
}

/**
 * Upload a video file to PeerTube.
 *
 * @param {object} opts
 * @param {string}  opts.baseUrl    PeerTube instance base URL.
 * @param {string}  opts.username   PeerTube username.
 * @param {string}  opts.password   PeerTube password.
 * @param {number}  opts.channelId  Numeric channel id.
 * @param {string}  opts.filePath   Absolute path to the MP4 file.
 * @param {string}  [opts.title]    Video title (defaults to filename).
 * @returns {Promise<string>}  URL of the uploaded video.
 */
async function uploadToPeerTube({ baseUrl, username, password, channelId, filePath, title }) {
  if (!baseUrl || !username || !password) {
    throw new Error('PeerTube baseUrl, username and password must all be set for upload.');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Recording file not found: ${filePath}`);
  }

  const accessToken = await authenticate(baseUrl, username, password);

  const videoTitle = title || path.basename(filePath, path.extname(filePath));
  logger.info(`[Uploader] Uploading "${videoTitle}" to ${baseUrl}…`);

  const form = new FormData();
  form.append('videofile', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'video/mp4',
  });
  form.append('channelId', String(channelId));
  form.append('name', videoTitle);
  form.append('privacy', '1'); // 1 = Public

  const uploadRes = await axios.post(`${baseUrl}/api/v1/videos/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 3600000, // 1 hour – allow large files while still failing on hangs
  });

  const videoUrl = `${baseUrl}/videos/watch/${uploadRes.data.video.uuid}`;
  logger.info(`[Uploader] Upload complete: ${videoUrl}`);
  return videoUrl;
}

module.exports = { uploadToPeerTube };
