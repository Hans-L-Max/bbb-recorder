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
SCREEN_RESOLUTION="${SCREEN_RESOLUTION:-1920x1080x24}"
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
#
# When running as root, --system mode is required (PulseAudio rejects per-user
# daemon startup as root for security reasons).
#
# We use -n (no default config) to skip loading system.pa, which attempts a
# D-Bus system-bus connection not available in Docker and loads the native
# protocol *without* anonymous auth.  Instead we load only the two modules we
# need and enable anonymous authentication so that clients (pactl, FFmpeg) can
# connect without a cookie file.
if [ "$(id -u)" = "0" ]; then
  # Ensure the directory for the system-mode socket exists
  install -d -m 755 /run/pulse
  env -u PULSE_SERVER pulseaudio \
    --system \
    --daemonize=no \
    --exit-idle-time=-1 \
    -n \
    --load="module-null-sink sink_name=virtual_sink sink_properties=device.description=Virtual_Sink" \
    --load="module-native-protocol-unix auth-anonymous=1" &
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

# ── 3. Configure the virtual audio sink ───────────────────────────────────────
if [ "$(id -u)" != "0" ]; then
  # In non-root (user) mode the null-sink is not pre-loaded; create it now.
  echo "[Entrypoint] Loading virtual PulseAudio null sink…"
  pactl load-module module-null-sink sink_name=virtual_sink \
    sink_properties=device.description=Virtual_Sink || true
fi
echo "[Entrypoint] Configuring virtual PulseAudio sink as default…"
pactl set-default-sink virtual_sink || true
pactl set-default-source "${PULSE_SOURCE}" || true

# Export PULSE_SERVER so that Node.js and Chromium connect to the correct
# PulseAudio socket.  In system (root) mode the socket lives at
# /run/pulse/native; in user mode the default discovery path is used.
if [ "$(id -u)" = "0" ]; then
  export PULSE_SERVER="unix:/run/pulse/native"
  echo "[Entrypoint] PULSE_SERVER set to ${PULSE_SERVER}"
fi

# ── 4. Launch the Node.js application ────────────────────────────────────────
echo "[Entrypoint] Starting bbb-recorder…"
exec node /app/src/index.js
