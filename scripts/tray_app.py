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
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time

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
LOCK_FILE = os.path.join(CONFIG_DIR, "tray.lock")
SCRIPT_REALPATH = os.path.realpath(__file__)
PYTHON_BIN_PATTERN = re.compile(r"^(python(\d+(\.\d+)*)?w?|py)(\.exe)?$", re.IGNORECASE)

DEFAULT_CONFIG = {
    "quietMode": False,
    "quietUntil": None,
    "volume": None,
    "useMaleVoice": None,
}

# Keep lock file handle open for the process lifetime so the OS releases it automatically on exit
_lock_file_handle = None


def ensure_config_dir():
    os.makedirs(CONFIG_DIR, exist_ok=True)


def is_pid_running(pid: int) -> bool:
    """Cross-platform process liveness check without terminating Windows processes."""
    if pid <= 0:
        return False

    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        ERROR_ACCESS_DENIED = 5

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if not handle:
            return kernel32.GetLastError() == ERROR_ACCESS_DENIED
        try:
            exit_code = ctypes.c_ulong()
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return exit_code.value == STILL_ACTIVE
            return False
        finally:
            kernel32.CloseHandle(handle)

    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _normalize_path_for_compare(p: str) -> str:
    try:
        resolved = os.path.realpath(p)
    except Exception:
        resolved = os.path.abspath(p)
    return os.path.normcase(resolved)


def _argv_matches_tray(argv: list[str], expected_script_path: str | None) -> bool:
    """Verify exact argv tokens represent a Python interpreter running the tray script."""
    if len(argv) < 2:
        return False
    exe_name = os.path.basename(argv[0].strip('"').strip("'"))
    if not PYTHON_BIN_PATTERN.match(exe_name):
        return False

    expected_norm = _normalize_path_for_compare(expected_script_path or SCRIPT_REALPATH)
    for token in argv[1:]:
        cleaned = token.strip('"').strip("'")
        if not cleaned or cleaned.startswith("-"):
            continue
        if _normalize_path_for_compare(cleaned) == expected_norm:
            return True
    return False


def _raw_args_contains_script_path(raw_args: str, expected_script_path: str | None) -> bool:
    """
    Space-safe check against unquoted POSIX `ps -o args=` output.
    Matches the full expected script path (or its realpath) bounded by whitespace/EOL.
    """
    if not raw_args:
        return False
    candidates = {SCRIPT_REALPATH, os.path.abspath(__file__)}
    if expected_script_path:
        candidates.add(expected_script_path)
        candidates.add(os.path.realpath(expected_script_path))

    for candidate in candidates:
        if not candidate:
            continue
        pattern = r"(?:^|\s)" + re.escape(candidate) + r"(?:\s|$)"
        if re.search(pattern, raw_args):
            return True
    return False


def _command_line_matches_tray(
    cmdline: str, expected_script_path: str | None, comm: str | None = None
) -> bool:
    """Verify interpreter + script path, preserving paths that contain spaces."""
    if not cmdline or not cmdline.strip():
        return False

    # If comm (exact executable path/name) is provided (macOS/POSIX `ps -o comm=`),
    # validate the interpreter via comm and match the script path without splitting on spaces.
    if comm is not None:
        exe_name = os.path.basename(comm.strip())
        if not PYTHON_BIN_PATTERN.match(exe_name):
            return False
        return _raw_args_contains_script_path(cmdline, expected_script_path)

    try:
        tokens = shlex.split(cmdline, posix=(sys.platform != "win32"))
    except ValueError:
        tokens = cmdline.split()
    return _argv_matches_tray(tokens, expected_script_path)


def is_tray_process(pid: int, expected_script_path: str | None = None) -> bool:
    """Verify that a live PID is a Python interpreter executing this tray_app.py script."""
    if not is_pid_running(pid):
        return False

    try:
        if sys.platform == "win32":
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if result.returncode != 0:
                return False
            return _command_line_matches_tray(result.stdout or "", expected_script_path)

        # On Linux, /proc/<pid>/cmdline provides exact NUL-separated argv tokens (handles spaces)
        proc_cmdline = f"/proc/{int(pid)}/cmdline"
        if os.path.exists(proc_cmdline):
            try:
                with open(proc_cmdline, "rb") as f:
                    raw = f.read()
                argv = [
                    part.decode("utf-8", errors="replace")
                    for part in raw.split(b"\x00")
                    if part
                ]
                if argv:
                    return _argv_matches_tray(argv, expected_script_path)
            except OSError:
                pass

        # On macOS / BSD, query `comm=` for exact interpreter (preserves spaces in exe path)
        # and `args=` for space-safe script path verification
        comm_res = subprocess.run(
            ["ps", "-p", str(int(pid)), "-o", "comm="],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        args_res = subprocess.run(
            ["ps", "-p", str(int(pid)), "-o", "args="],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if comm_res.returncode != 0 or args_res.returncode != 0:
            return False
        return _command_line_matches_tray(
            args_res.stdout or "", expected_script_path, comm=comm_res.stdout or ""
        )
    except Exception:
        return False


def read_recorded_pid_info() -> tuple[int | None, str | None]:
    if not os.path.exists(PID_FILE):
        return None, None
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return None, None
        if raw.startswith("{"):
            data = json.loads(raw)
            pid = data.get("pid")
            script_path = data.get("scriptPath") if isinstance(data.get("scriptPath"), str) else None
            return (int(pid) if isinstance(pid, int) and pid > 0 else None), script_path
        pid = int(raw)
        return (pid if pid > 0 else None), None
    except Exception:
        return None, None


def write_pid_file(pid: int) -> None:
    ensure_config_dir()
    fd, tmp_path = tempfile.mkstemp(prefix=".tray-pid-", suffix=".json", dir=CONFIG_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            json.dump(
                {
                    "pid": pid,
                    "script": "tray_app.py",
                    "scriptPath": SCRIPT_REALPATH,
                    "executable": os.path.realpath(sys.executable),
                    "startedAt": datetime.now(timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z"),
                },
                tmp_file,
            )
            tmp_file.write("\n")
        os.replace(tmp_path, PID_FILE)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def terminate_process(pid: int, expected_script_path: str | None = None) -> bool:
    """Terminate an existing tray_app.py process safely across platforms."""
    if not is_tray_process(pid, expected_script_path):
        return False

    try:
        if sys.platform == "win32":
            import ctypes

            PROCESS_TERMINATE = 0x0001
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, int(pid))
            if not handle:
                return False
            try:
                return bool(kernel32.TerminateProcess(handle, 0))
            finally:
                kernel32.CloseHandle(handle)
        else:
            os.kill(pid, signal.SIGTERM)
            return True
    except OSError:
        return False


def _try_acquire_os_lock():
    """Atomically acquire a non-blocking exclusive OS file lock on LOCK_FILE."""
    ensure_config_dir()
    handle = open(LOCK_FILE, "a+", encoding="utf-8")
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            if handle.read(1) == "":
                handle.write("0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except OSError:
        handle.close()
        return None


def _release_os_lock(handle) -> None:
    if handle is None:
        return
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass
    try:
        handle.close()
    except OSError:
        pass


def acquire_single_instance_lock(force: bool = False) -> str:
    """
    Atomically acquire the single-instance lock.
    Returns:
      - "acquired": lock acquired by this process
      - "already_running": another instance holds the lock and force=False
      - "timeout": force=True failed to replace the existing instance before deadline
    """
    global _lock_file_handle
    ensure_config_dir()

    handle = _try_acquire_os_lock()
    if handle is None:
        existing_pid, recorded_script = read_recorded_pid_info()
        if not force:
            pid_msg = f" (PID {existing_pid})" if existing_pid else ""
            print(
                f"Local Voice MCP tray is already running{pid_msg}.",
                file=sys.stderr,
            )
            return "already_running"

        if existing_pid and existing_pid != os.getpid():
            terminate_process(existing_pid, recorded_script)

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            time.sleep(0.1)
            handle = _try_acquire_os_lock()
            if handle is not None:
                break

        if handle is None:
            print(
                "Timed out waiting for existing Local Voice MCP tray instance to exit.",
                file=sys.stderr,
            )
            return "timeout"

    _lock_file_handle = handle
    write_pid_file(os.getpid())

    def cleanup():
        global _lock_file_handle
        try:
            recorded_pid, _ = read_recorded_pid_info()
            if recorded_pid == os.getpid() and os.path.exists(PID_FILE):
                os.remove(PID_FILE)
        except Exception:
            pass
        _release_os_lock(_lock_file_handle)
        _lock_file_handle = None

    atexit.register(cleanup)
    return "acquired"


def load_config_strict() -> dict:
    """
    Read and parse CONFIG_FILE strictly for read-modify-write updates.
    Creates/returns defaults if missing, but raises on read/JSON/type errors so
    tray updates never silently overwrite a malformed user config file.
    """
    ensure_config_dir()
    if not os.path.exists(CONFIG_FILE):
        return dict(DEFAULT_CONFIG)
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        raw = f.read()
    if not raw.strip():
        return dict(DEFAULT_CONFIG)
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {CONFIG_FILE}")
    merged = dict(DEFAULT_CONFIG)
    merged.update(data)
    return merged


def load_config() -> dict:
    """Forgiving config reader for status display and icon rendering."""
    ensure_config_dir()
    if not os.path.exists(CONFIG_FILE):
        save_config(dict(DEFAULT_CONFIG))
        return dict(DEFAULT_CONFIG)
    try:
        return load_config_strict()
    except Exception:
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
        normalized = value.strip().replace("Z", "+00:00").replace("z", "+00:00")
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


def write_ready_marker(ready_file: str | None) -> None:
    if not ready_file:
        return
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(ready_file, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}\n")
    except OSError:
        pass


def build_tray_app(ready_file: str | None = None):
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

    def update_config(icon_obj, mutator):
        try:
            cfg = load_config_strict()
        except Exception as exc:
            print(
                f"Refusing to overwrite malformed/unreadable config at {CONFIG_FILE}: {exc}",
                file=sys.stderr,
            )
            return
        mutator(cfg)
        save_config(cfg)
        refresh_icon(icon_obj)

    def toggle_quiet_mode(icon_obj, _item):
        def _mutate(cfg):
            currently_quiet = is_quiet_active(cfg)
            cfg["quietMode"] = not currently_quiet
            cfg["quietUntil"] = None

        update_config(icon_obj, _mutate)

    def set_snooze_minutes(minutes: int):
        def _handler(icon_obj, _item):
            def _mutate(cfg):
                cfg["quietMode"] = False
                until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
                cfg["quietUntil"] = until.isoformat().replace("+00:00", "Z")

            update_config(icon_obj, _mutate)

        return _handler

    def resume_audio_now(icon_obj, _item):
        def _mutate(cfg):
            cfg["quietMode"] = False
            cfg["quietUntil"] = None

        update_config(icon_obj, _mutate)

    def set_volume_option(vol_value):
        def _handler(icon_obj, _item):
            def _mutate(cfg):
                cfg["volume"] = vol_value

            update_config(icon_obj, _mutate)

        return _handler

    def is_volume_checked(vol_value):
        def _check(_item):
            return load_config().get("volume") == vol_value

        return _check

    def set_voice_option(male_value):
        def _handler(icon_obj, _item):
            def _mutate(cfg):
                cfg["useMaleVoice"] = male_value

            update_config(icon_obj, _mutate)

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
        if not os.path.exists(CONFIG_FILE):
            save_config(dict(DEFAULT_CONFIG))
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
        # Honor SIGTERM received before pystray finished initializing
        if stop_event.is_set():
            icon_obj.stop()
            return

        if sys.platform == "darwin":
            try:
                import AppKit

                AppKit.NSApplication.sharedApplication().setActivationPolicy_(
                    AppKit.NSApplicationActivationPolicyAccessory
                )
            except Exception:
                pass

        icon_obj.visible = True
        write_ready_marker(ready_file)
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

    return tray_icon, setup, stop_event


def _parse_ready_file_arg(argv: list[str]) -> str | None:
    for idx, arg in enumerate(argv):
        if arg == "--ready-file" and idx + 1 < len(argv):
            return argv[idx + 1]
    return None


def main():
    force = "--force" in sys.argv
    ready_file = _parse_ready_file_arg(sys.argv[1:])

    lock_result = acquire_single_instance_lock(force=force)
    if lock_result == "already_running":
        sys.exit(0)
    if lock_result == "timeout":
        sys.exit(1)

    load_config()
    tray_icon, setup, stop_event = build_tray_app(ready_file=ready_file)

    def _handle_sigterm(_signum, _frame):
        stop_event.set()
        try:
            tray_icon.stop()
        except Exception:
            pass

    try:
        signal.signal(signal.SIGTERM, _handle_sigterm)
    except Exception:
        pass

    # If SIGTERM arrived before run() started, skip entering the GUI event loop
    if stop_event.is_set():
        sys.exit(0)

    tray_icon.run(setup=setup)


if __name__ == "__main__":
    main()
