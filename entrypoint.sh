#!/usr/bin/env bash
# entrypoint.sh
#
# Starts the required background services (Xvfb, PulseAudio) before launching
# the Node.js recorder application.
#
# Exit immediately on error so the container stops rather than running in a
# broken state.
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_RESOLUTION="${SCREEN_RESOLUTION:-1280x720x24}"
PULSE_SOURCE="${PULSE_SOURCE:-virtual_sink.monitor}"

# ── 1. Start Xvfb ─────────────────────────────────────────────────────────────
echo "[Entrypoint] Starting Xvfb on display ${DISPLAY} (${SCREEN_RESOLUTION})…"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_RESOLUTION}" -ac +extension GLX +render -noreset &
XVFB_PID=$!
echo "[Entrypoint] Xvfb PID: ${XVFB_PID}"

# Give Xvfb a moment to initialise
sleep 1

# ── 2. Start PulseAudio ───────────────────────────────────────────────────────
echo "[Entrypoint] Starting PulseAudio…"
# PULSE_SERVER is a *client* hint for connecting to an existing server.  When it
# is set in the environment, PulseAudio's own startup code interprets it as a
# configured server address and refuses to autospawn — especially as root.
# Strip it from the daemon's environment so the daemon starts unconditionally.
# When running as root, --system mode is required (PulseAudio rejects per-user
# daemon startup as root for security reasons).
if [ "$(id -u)" = "0" ]; then
  env -u PULSE_SERVER pulseaudio --system --exit-idle-time=-1 --daemonize=no &
else
  env -u PULSE_SERVER pulseaudio --exit-idle-time=-1 --daemonize=no &
fi
PULSE_PID=$!
echo "[Entrypoint] PulseAudio PID: ${PULSE_PID}"

# Wait for PulseAudio socket to appear (up to 10 s)
for i in $(seq 1 10); do
  if pactl info &>/dev/null; then
    echo "[Entrypoint] PulseAudio is ready."
    break
  fi
  echo "[Entrypoint] Waiting for PulseAudio… (${i}/10)"
  sleep 1
done

# ── 3. Create a virtual audio sink so FFmpeg has something to capture ──────────
echo "[Entrypoint] Loading virtual PulseAudio null sink…"
pactl load-module module-null-sink sink_name=virtual_sink sink_properties=device.description="Virtual Sink" || true
pactl set-default-sink virtual_sink || true
pactl set-default-source "${PULSE_SOURCE}" || true

# ── 4. Launch the Node.js application ────────────────────────────────────────
echo "[Entrypoint] Starting bbb-recorder…"
exec node /app/src/index.js
