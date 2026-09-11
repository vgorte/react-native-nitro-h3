#!/usr/bin/env bash
# Captures one screen recording per act of the showcase, on the booted iPhone simulator or on an
# attached Android device. The acts are driven from the outside while a take runs, so this script
# only opens and closes the capture:
#
#   scripts/record-takes.sh ios-start atlas   # begins takes/atlas-ios.mp4
#   ... drive the act ...
#   scripts/record-takes.sh ios-stop          # ends it
#
#   scripts/record-takes.sh android atlas 20  # records 20 seconds on the attached device
#
# The simulator's clock and status icons are frozen first, so no take carries a live battery or a
# changing time.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
takes="$root/takes"
pidfile="$takes/.recording.pid"
mkdir -p "$takes"

case "${1:-}" in
  status-bar)
    xcrun simctl status_bar booted override \
      --time '9:41' \
      --dataNetwork wifi --wifiMode active --wifiBars 3 \
      --cellularMode notSupported \
      --batteryState charged --batteryLevel 100
    ;;
  ios-start)
    act="${2:?act name}"
    nohup xcrun simctl io booted recordVideo --codec h264 --mask ignored \
      -f "$takes/$act-ios.mp4" >"$takes/$act-ios.log" 2>&1 &
    echo $! >"$pidfile"
    echo "recording $takes/$act-ios.mp4"
    ;;
  ios-stop)
    kill -INT "$(cat "$pidfile")"
    rm -f "$pidfile"
    ;;
  android)
    # a device serial belongs to whoever records, so the script asks for one rather than carrying it
    serial="${ANDROID_SERIAL:?set ANDROID_SERIAL to the device to record on}"
    act="${2:?act name}"
    seconds="${3:-20}"
    adb -s "$serial" shell screenrecord --bit-rate 16000000 --time-limit "$seconds" \
      "/sdcard/$act.mp4"
    adb -s "$serial" pull "/sdcard/$act.mp4" "$takes/$act-android.mp4"
    adb -s "$serial" shell rm "/sdcard/$act.mp4"
    ;;
  *)
    echo "usage: record-takes.sh status-bar | ios-start <act> | ios-stop | android <act> [seconds]"
    exit 2
    ;;
esac
