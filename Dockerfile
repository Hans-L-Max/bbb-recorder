# ──────────────────────────────────────────────────────────────────────────────
# BBB Recorder Docker image
#
# Builds a container that runs Puppeteer (headless Chromium) on a virtual X11
# display (Xvfb) with virtual audio (PulseAudio), and captures the stream
# via FFmpeg.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# ── System dependencies ───────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display
    xvfb \
    # Audio
    pulseaudio \
    pulseaudio-utils \
    # Media capture & encoding
    ffmpeg \
    # Chromium and its runtime dependencies
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    # Utilities used in entrypoint.sh
    dbus-x11 \
    procps \
  && rm -rf /var/lib/apt/lists/*

# ── Application ───────────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Directory for recordings
RUN mkdir -p /app/recordings

# ── Environment defaults ──────────────────────────────────────────────────────
ENV DISPLAY=:99 \
    CHROMIUM_PATH=/usr/bin/chromium \
    PULSE_SERVER=unix:/run/pulse/native \
    RECORDINGS_DIR=/app/recordings \
    NODE_ENV=production

# ── Entrypoint ────────────────────────────────────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
