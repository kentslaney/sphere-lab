"""Local-only lifecycle tests: no SSH, builds, or login credentials."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import io
import contextlib

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/run_remote.py'
spec = importlib.util.spec_from_file_location('run_remote', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class LifecycleTests(unittest.TestCase):
    def test_shutdown_reaps_child(self):
        supervisor = module.Supervisor()
        child = supervisor.start('dummy', [sys.executable, '-c', 'import time; time.sleep(60)'])
        supervisor.shutdown(grace=0.2)
        self.assertIsNotNone(child.poll())
        self.assertEqual(supervisor.processes, [])

    def test_stubborn_child_is_killed(self):
        supervisor = module.Supervisor()
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / 'ready'
            child = supervisor.start('stubborn', [sys.executable, '-c', f'import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path({str(ready)!r}).touch(); time.sleep(60)'])
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists())
                supervisor.shutdown(grace=0.1)
                self.assertEqual(child.returncode, -signal.SIGKILL)
            finally:
                supervisor.shutdown(grace=0)

    def test_failed_service_is_reported(self):
        supervisor = module.Supervisor()
        child = supervisor.start('failure', [sys.executable, '-c', 'raise SystemExit(7)'])
        child.wait()
        try:
            with self.assertRaisesRegex(RuntimeError, 'failure.*7'):
                supervisor.check()
        finally:
            supervisor.shutdown(grace=0)

    def test_second_interrupt_exits_without_waiting(self):
        code = f'''import runpy,signal
m=runpy.run_path({str(SCRIPT)!r})
s=m['Supervisor']()
s.interrupt(signal.SIGINT,None)
assert s.stopping
s.interrupt(signal.SIGINT,None)
raise AssertionError('second interrupt returned')
'''
        result = subprocess.run([sys.executable, '-c', code], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 130)
        self.assertIn(b'without waiting', result.stderr)

class StartupRegressionTests(unittest.TestCase):
    def test_client_waits_until_socket_accepts_connections(self):
        supervisor = module.Supervisor()
        with patch.object(module.socket, 'socket') as factory:
            probe = factory.return_value.__enter__.return_value
            probe.connect.side_effect = [ConnectionRefusedError(), None]
            supervisor.wait_client(timeout=2)
            self.assertEqual(probe.connect.call_count, 2)
        supervisor.stopping = True
        with self.assertRaises(InterruptedError):
            supervisor.wait_client()

    def test_ssh_output_normalizes_carriage_returns(self):
        supervisor = module.Supervisor()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            child = supervisor.start('output', [sys.executable, '-c',
                "import os; os.write(1, b'first\\r\\r\\nsecond\\r\\n')"],
                stdin=subprocess.DEVNULL, normalize_output=True)
            child.wait(timeout=5)
            supervisor.shutdown(grace=0)
        self.assertIn('first\nsecond\n', output.getvalue())
        self.assertNotIn('\r', output.getvalue())

class WebSocketReadinessTests(unittest.TestCase):
    def test_tcp_and_http_are_not_enough(self):
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            valid = False
            def log_message(self, *args): pass
            def do_GET(self):
                if not self.valid:
                    self.send_response(200)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                self.send_response(426)
                self.send_header('Upgrade', 'websocket')
                self.send_header('Content-Length', '0')
                self.end_headers()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            self.assertFalse(module.websocket_ready(server.server_port))
            Handler.valid = True
            self.assertTrue(module.websocket_ready(server.server_port))
        finally:
            server.shutdown()
            server.server_close()

    def test_wait_retries_and_observes_interrupt(self):
        supervisor = module.Supervisor()
        with patch.object(module, 'websocket_ready', side_effect=[False, False, True]) as probe:
            supervisor.wait_websocket(8001, timeout=2)
            self.assertEqual(probe.call_count, 3)
        with patch.object(module, 'websocket_ready', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Timed out'):
                supervisor.wait_websocket(8001, timeout=0.1)
        supervisor.stopping = True
        with self.assertRaises(InterruptedError):
            supervisor.wait_websocket(8001)

if __name__ == '__main__':
    unittest.main()
