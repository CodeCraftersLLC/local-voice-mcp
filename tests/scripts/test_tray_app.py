"""Unit tests for scripts/tray_app.py locking and error-handling behavior."""

from __future__ import annotations

import errno
import importlib.util
import os
import sys
import tempfile
import types
import unittest
from unittest import mock


def _load_tray_module():
    """Load scripts/tray_app.py with lightweight stubs if pystray/PIL are unavailable."""
    script_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../scripts/tray_app.py")
    )
    stubbed: dict[str, types.ModuleType | None] = {}
    for mod_name in ("pystray", "PIL", "PIL.Image", "PIL.ImageDraw"):
        if mod_name not in sys.modules:
            try:
                __import__(mod_name)
            except ImportError:
                stub = types.ModuleType(mod_name)
                if mod_name == "PIL":
                    stub.Image = types.ModuleType("PIL.Image")  # type: ignore[attr-defined]
                    stub.ImageDraw = types.ModuleType("PIL.ImageDraw")  # type: ignore[attr-defined]
                elif mod_name == "PIL.Image":
                    stub.Image = object  # type: ignore[attr-defined]
                sys.modules[mod_name] = stub
                stubbed[mod_name] = stub

    spec = importlib.util.spec_from_file_location("tray_app_under_test", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tray_app = _load_tray_module()


class TestTrayLocking(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.orig_config_dir = tray_app.CONFIG_DIR
        self.orig_config_file = tray_app.CONFIG_FILE
        self.orig_pid_file = tray_app.PID_FILE
        self.orig_lock_file = tray_app.LOCK_FILE
        self.orig_config_lock_file = tray_app.CONFIG_LOCK_FILE
        self.orig_handle = tray_app._lock_file_handle

        tray_app.CONFIG_DIR = self.tmpdir.name
        tray_app.CONFIG_FILE = os.path.join(self.tmpdir.name, "config.json")
        tray_app.PID_FILE = os.path.join(self.tmpdir.name, "tray.pid")
        tray_app.LOCK_FILE = os.path.join(self.tmpdir.name, "tray.lock")
        tray_app.CONFIG_LOCK_FILE = f"{tray_app.CONFIG_FILE}.lock"
        tray_app._lock_file_handle = None
        tray_app._last_lock_error = None

    def tearDown(self):
        if tray_app._lock_file_handle is not None:
            tray_app._release_os_lock(tray_app._lock_file_handle)
            tray_app._lock_file_handle = None
        tray_app.CONFIG_DIR = self.orig_config_dir
        tray_app.CONFIG_FILE = self.orig_config_file
        tray_app.PID_FILE = self.orig_pid_file
        tray_app.LOCK_FILE = self.orig_lock_file
        tray_app.CONFIG_LOCK_FILE = self.orig_config_lock_file
        tray_app._lock_file_handle = self.orig_handle
        self.tmpdir.cleanup()

    def test_try_acquire_os_lock_acquired_and_locked_posix(self):
        if sys.platform == "win32":
            self.skipTest("POSIX flock test")

        status1, handle1 = tray_app._try_acquire_os_lock()
        self.assertEqual(status1, "acquired")
        self.assertIsNotNone(handle1)
        try:
            status2, handle2 = tray_app._try_acquire_os_lock()
            self.assertEqual(status2, "locked")
            self.assertIsNone(handle2)
        finally:
            tray_app._release_os_lock(handle1)

    def test_try_acquire_os_lock_maps_posix_eacces_and_eagain_to_locked(self):
        fake_fcntl = types.SimpleNamespace(
            LOCK_EX=2,
            LOCK_NB=4,
            flock=mock.Mock(),
        )
        for err_no in (errno.EACCES, errno.EAGAIN, errno.EWOULDBLOCK):
            fake_fcntl.flock.side_effect = OSError(err_no, "lock held")
            with mock.patch.object(sys, "platform", "linux"), mock.patch.dict(
                sys.modules, {"fcntl": fake_fcntl}
            ):
                status, val = tray_app._try_acquire_os_lock()
                self.assertEqual(status, "locked")
                self.assertIsNone(val)

    def test_try_acquire_os_lock_maps_posix_io_error_to_error(self):
        fake_fcntl = types.SimpleNamespace(
            LOCK_EX=2,
            LOCK_NB=4,
            flock=mock.Mock(side_effect=OSError(errno.EIO, "io failure")),
        )
        with mock.patch.object(sys, "platform", "linux"), mock.patch.dict(
            sys.modules, {"fcntl": fake_fcntl}
        ):
            status, val = tray_app._try_acquire_os_lock()
            self.assertEqual(status, "error")
            self.assertIsInstance(val, OSError)

    def test_try_acquire_os_lock_maps_windows_eacces_and_edeadlk_to_locked(self):
        fake_msvcrt = types.SimpleNamespace(
            LK_NBLCK=2,
            locking=mock.Mock(),
        )
        for err_no in (errno.EACCES, errno.EDEADLK):
            fake_msvcrt.locking.side_effect = OSError(err_no, "locked")
            with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(
                sys.modules, {"msvcrt": fake_msvcrt}
            ):
                status, val = tray_app._try_acquire_os_lock()
                self.assertEqual(status, "locked")
                self.assertIsNone(val)

        fake_msvcrt.locking.side_effect = OSError(errno.EIO, "io error")
        with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(
            sys.modules, {"msvcrt": fake_msvcrt}
        ):
            status, val = tray_app._try_acquire_os_lock()
            self.assertEqual(status, "error")
            self.assertIsInstance(val, OSError)

    def test_try_acquire_os_lock_returns_error_on_open_failure(self):
        with mock.patch("builtins.open", side_effect=PermissionError("read-only")):
            status, val = tray_app._try_acquire_os_lock()
            self.assertEqual(status, "error")
            self.assertIsInstance(val, PermissionError)

    def test_acquire_single_instance_lock_error_populates_last_lock_error(self):
        with mock.patch.object(
            tray_app,
            "_try_acquire_os_lock",
            return_value=("error", PermissionError("read-only dir")),
        ):
            result = tray_app.acquire_single_instance_lock(force=False)
            self.assertEqual(result, "error")
            self.assertIsNotNone(tray_app._last_lock_error)
            self.assertIn("read-only dir", tray_app._last_lock_error or "")

    def test_acquire_single_instance_lock_already_running(self):
        with mock.patch.object(
            tray_app, "_try_acquire_os_lock", return_value=("locked", None)
        ):
            result = tray_app.acquire_single_instance_lock(force=False)
            self.assertEqual(result, "already_running")

    def test_acquire_single_instance_lock_force_timeout(self):
        monotonic_values = [0.0, 10.0]
        with mock.patch.object(
            tray_app, "_try_acquire_os_lock", return_value=("locked", None)
        ), mock.patch.object(
            tray_app, "read_recorded_pid_info", return_value=(None, None)
        ), mock.patch.object(
            tray_app.time, "monotonic", side_effect=monotonic_values
        ):
            result = tray_app.acquire_single_instance_lock(force=True)
            self.assertEqual(result, "timeout")
            self.assertIn("Timed out", tray_app._last_lock_error or "")


if __name__ == "__main__":
    unittest.main()
