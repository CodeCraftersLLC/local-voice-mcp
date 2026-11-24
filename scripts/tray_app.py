#!/usr/bin/env python3
"""
Cross-platform system tray / menu bar controller for Local Voice MCP.
Supports macOS, Windows, and Linux (Ubuntu).
"""
from __future__ import annotations

import atexit
from datetime import datetime, timedelta, timezone
import json
import os
import subprocess
import sys
import tempfile
import threading

# Hide macOS Dock icon before initializing GUI event loop so this acts as a pure menu bar app
if sys.platform == "darwin":
    try:
        import AppKit  # Provided via pyobjc (installed automatically with pystray on macOS)

        AppKit.NSApplication.sharedApplication().setActivationPolicy_(
            AppKit.NSApplicationActivationPolicyAccessory
        )
    except Exception:
        pass

import pystray
from PIL import Image, ImageDraw

CONFIG_PATH_ENV = os.environ.get("LOCAL_VOICE_MCP_CONFIG")
if CONFIG_PATH_ENV:
    CONFIG_FILE = os.path.abspath(os.path.expanduser(CONFIG_PATH_ENV))
    CONFIG_DIR = os.path.dirname(CONFIG_FILE)
else:
    CONFIG_DIR = os.path.expanduser("~/.local-voice-mcp")
    CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

PID_FILE = os.path.join(CONFIG_DIR, "tray.pid")

DEFAULT_CONFIG = {
    "quietMode": False,
    "quietUntil": None,
    "volume": None,
    "useMaleVoice": None,
}


def ensure_config_dir():
    os.makedirs(CONFIG_DIR, exist_ok=True)


def is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def acquire_single_instance_lock(force: bool = False) -> bool:
    ensure_config_dir()
    if not force and os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r", encoding="utf-8") as f:
                existing_pid = int(f.read().strip())
            if existing_pid != os.getpid() and is_pid_running(existing_pid):
                print(
                    f"Local Voice MCP tray is already running (PID {existing_pid}).",
                    file=sys.stderr,
                )
                return False
        except Exception:
            pass

    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass

    def cleanup_pid():
        try:
            if os.path.exists(PID_FILE):
                with open(PID_FILE, "r", encoding="utf-8") as f:
                    recorded = int(f.read().strip())
                if recorded == os.getpid():
                    os.remove(PID_FILE)
        except Exception:
            pass

    atexit.register(cleanup_pid)
    return True


def load_config() -> dict:
    ensure_config_dir()
    if not os.path.exists(CONFIG_FILE):
        save_config(dict(DEFAULT_CONFIG))
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            merged = dict(DEFAULT_CONFIG)
            merged.update(data)
            return merged
    except Exception:
        pass
    return dict(DEFAULT_CONFIG)


def save_config(config: dict) -> None:
    ensure_config_dir()
    fd, tmp_path = tempfile.mkstemp(prefix=".config-", suffix=".json", dir=CONFIG_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            json.dump(config, tmp_file, indent=2)
            tmp_file.write("\n")
        os.replace(tmp_path, CONFIG_FILE)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def parse_iso_utc(value) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        normalized = value.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def is_quiet_active(config: dict | None = None) -> bool:
    cfg = config if config is not None else load_config()
    if cfg.get("quietMode") is True:
        return True
    until_dt = parse_iso_utc(cfg.get("quietUntil"))
    if until_dt and until_dt > datetime.now(timezone.utc):
        return True
    return False


def create_speaker_icon(muted: bool) -> Image.Image:
    """Draw a high-contrast 64x64 RGBA speaker icon visible on both dark and light bars."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Subtle rounded pill backdrop for cross-theme contrast on macOS/Windows/Linux
    draw.rounded_rectangle(
        (4, 4, 60, 60),
        radius=14,
        fill=(30, 34, 42, 220) if not muted else (60, 24, 28, 230),
        outline=(220, 225, 235, 200) if not muted else (240, 100, 100, 220),
        width=2,
    )

    # Speaker cone
    cone = [(14, 25), (23, 25), (34, 15), (34, 49), (23, 39), (14, 39)]
    draw.polygon(cone, fill=(245, 247, 250, 255))

    if not muted:
        # Sound waves
        draw.arc((32, 20, 45, 44), start=-55, end=55, fill=(110, 231, 183, 255), width=3)
        draw.arc((36, 13, 54, 51), start=-55, end=55, fill=(110, 231, 183, 255), width=3)
    else:
        # Mute X mark
        draw.line((40, 23, 53, 41), fill=(248, 113, 113, 255), width=4)
        draw.line((40, 41, 53, 23), fill=(248, 113, 113, 255), width=4)

    return img


def build_tray_app():
    stop_event = threading.Event()

    def refresh_icon(icon_obj):
        cfg = load_config()
        muted = is_quiet_active(cfg)
        icon_obj.icon = create_speaker_icon(muted)
        icon_obj.title = (
            "Local Voice MCP — Quiet Mode ON"
            if muted
            else "Local Voice MCP — Active"
        )
        icon_obj.update_menu()

    def toggle_quiet_mode(icon_obj, _item):
        cfg = load_config()
        currently_quiet = is_quiet_active(cfg)
        cfg["quietMode"] = not currently_quiet
        cfg["quietUntil"] = None
        save_config(cfg)
        refresh_icon(icon_obj)

    def set_snooze_minutes(minutes: int):
        def _handler(icon_obj, _item):
            cfg = load_config()
            cfg["quietMode"] = False
            until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
            cfg["quietUntil"] = until.isoformat().replace("+00:00", "Z")
            save_config(cfg)
            refresh_icon(icon_obj)

        return _handler

    def resume_audio_now(icon_obj, _item):
        cfg = load_config()
        cfg["quietMode"] = False
        cfg["quietUntil"] = None
        save_config(cfg)
        refresh_icon(icon_obj)

    def set_volume_option(vol_value):
        def _handler(icon_obj, _item):
            cfg = load_config()
            cfg["volume"] = vol_value
            save_config(cfg)
            refresh_icon(icon_obj)

        return _handler

    def is_volume_checked(vol_value):
        def _check(_item):
            return load_config().get("volume") == vol_value

        return _check

    def set_voice_option(male_value):
        def _handler(icon_obj, _item):
            cfg = load_config()
            cfg["useMaleVoice"] = male_value
            save_config(cfg)
            refresh_icon(icon_obj)

        return _handler

    def is_voice_checked(male_value):
        def _check(_item):
            return load_config().get("useMaleVoice") == male_value

        return _check

    def get_status_label(_item):
        cfg = load_config()
        if cfg.get("quietMode") is True:
            return "Status: Muted (Quiet Mode)"
        until_dt = parse_iso_utc(cfg.get("quietUntil"))
        if until_dt and until_dt > datetime.now(timezone.utc):
            local_time = until_dt.astimezone().strftime("%H:%M")
            return f"Status: Paused until {local_time}"
        return "Status: Audio Active"

    def open_config_file(_icon_obj, _item):
        load_config()  # Ensure file exists
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", CONFIG_FILE])
            elif sys.platform == "win32":
                os.startfile(CONFIG_FILE)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", CONFIG_FILE])
        except Exception as exc:
            print(f"Failed to open config file: {exc}", file=sys.stderr)

    def exit_app(icon_obj, _item):
        stop_event.set()
        icon_obj.stop()

    menu = pystray.Menu(
        pystray.MenuItem(get_status_label, None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "Quiet Mode",
            toggle_quiet_mode,
            checked=lambda _item: is_quiet_active(),
        ),
        pystray.MenuItem(
            "Disable Temporarily",
            pystray.Menu(
                pystray.MenuItem("For 15 Minutes", set_snooze_minutes(15)),
                pystray.MenuItem("For 30 Minutes", set_snooze_minutes(30)),
                pystray.MenuItem("For 1 Hour", set_snooze_minutes(60)),
                pystray.MenuItem("For 2 Hours", set_snooze_minutes(120)),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Resume Audio Now", resume_audio_now),
            ),
        ),
        pystray.MenuItem(
            "Playback Volume",
            pystray.Menu(
                pystray.MenuItem(
                    "Default (Env / 50%)",
                    set_volume_option(None),
                    checked=is_volume_checked(None),
                    radio=True,
                ),
                pystray.MenuItem(
                    "25%",
                    set_volume_option(25),
                    checked=is_volume_checked(25),
                    radio=True,
                ),
                pystray.MenuItem(
                    "50%",
                    set_volume_option(50),
                    checked=is_volume_checked(50),
                    radio=True,
                ),
                pystray.MenuItem(
                    "75%",
                    set_volume_option(75),
                    checked=is_volume_checked(75),
                    radio=True,
                ),
                pystray.MenuItem(
                    "100%",
                    set_volume_option(100),
                    checked=is_volume_checked(100),
                    radio=True,
                ),
            ),
        ),
        pystray.MenuItem(
            "Chatterbox Voice",
            pystray.Menu(
                pystray.MenuItem(
                    "Default (Env)",
                    set_voice_option(None),
                    checked=is_voice_checked(None),
                    radio=True,
                ),
                pystray.MenuItem(
                    "Female Voice",
                    set_voice_option(False),
                    checked=is_voice_checked(False),
                    radio=True,
                ),
                pystray.MenuItem(
                    "Male Voice",
                    set_voice_option(True),
                    checked=is_voice_checked(True),
                    radio=True,
                ),
            ),
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Open Config File...", open_config_file),
        pystray.MenuItem("Quit Tray", exit_app),
    )

    initial_quiet = is_quiet_active()
    tray_icon = pystray.Icon(
        "LocalVoiceMCP",
        create_speaker_icon(initial_quiet),
        "Local Voice MCP — Quiet Mode ON"
        if initial_quiet
        else "Local Voice MCP — Active",
        menu=menu,
    )

    def setup(icon_obj):
        if sys.platform == "darwin":
            try:
                import AppKit

                AppKit.NSApplication.sharedApplication().setActivationPolicy_(
                    AppKit.NSApplicationActivationPolicyAccessory
                )
            except Exception:
                pass

        icon_obj.visible = True
        last_state = is_quiet_active()

        def watch_loop():
            nonlocal last_state
            while not stop_event.wait(2.0):
                current_state = is_quiet_active()
                if current_state != last_state:
                    last_state = current_state
                    refresh_icon(icon_obj)

        watcher = threading.Thread(target=watch_loop, daemon=True)
        watcher.start()

    return tray_icon, setup


def main():
    force = "--force" in sys.argv
    if not acquire_single_instance_lock(force=force):
        sys.exit(0)

    load_config()
    tray_icon, setup = build_tray_app()
    tray_icon.run(setup=setup)


if __name__ == "__main__":
    main()
