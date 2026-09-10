#!/usr/bin/env python3
"""Prepare and supervise the remote-auth stack. Run from any directory."""
import http.client
import argparse
import hashlib
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import threading

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / '.venv/bin/python'
STAMP = ROOT / '.build-deps/remote-build.sha256'
OUTPUTS = [
    'web/pkg/cube_renderer.js', 'web/pkg/cube_renderer_bg.wasm',
    'models/depth-anything-v2-small.onnx', 'models/sphere-detector.vmfb',
    'models/example.jpg', 'runtime/generated/sphere_runtime.mjs',
    'runtime/generated/sphere_runtime.wasm',
    'node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs',
    'tests/generated/detector-reference.json',
]


def build_digest():
    digest = hashlib.sha256()
    paths = [ROOT / name for name in ('package.json', 'package-lock.json')]
    for directory in ('scripts', 'renderer', 'runtime', 'patches', 'web', 'tests', 'sphere-detector'):
        for folder, directories, files in os.walk(ROOT / directory):
            directories[:] = [d for d in directories if not d.startswith('.') and d not in
                              ('target', 'generated', '__pycache__', 'pkg', 'vendor', 'models', 'assets', 'run')]
            for name in files:
                p = Path(folder) / name
                if p.name in ('run_remote.py', 'remote_auth.py', 'serve_https.py', 'test_remote_launcher.py'):
                    continue
                if p.suffix in ('.py', '.sh', '.js', '.json', '.toml', '.lock', '.rs', '.wgsl', '.c', '.h', '.txt', '.patch'):
                    paths.append(p)
    for p in sorted(set(paths)):
        digest.update(str(p.relative_to(ROOT)).encode())
        digest.update(p.read_bytes())
    return digest.hexdigest()


def websocket_ready(port, timeout=1):
    """Wait for the WebSocket server's upgrade-required HTTP response."""
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        # An ordinary HTTP request gets websockets' 426 response without entering
        # the login message handler. Opening and immediately closing a WebSocket
        # instead produces a misleading ConnectionClosedOK traceback remotely.
        connection.request('GET', '/', headers={'Connection': 'close'})
        response = connection.getresponse()
        return response.status == 426 and response.getheader('Upgrade', '').lower() == 'websocket'
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


class Supervisor:
    def __init__(self):
        self.processes = []
        self.stopping = False
        self.interrupts = 0
        self.readers = []

    def interrupt(self, signum, frame):
        self.interrupts += 1
        if self.interrupts > 1:
            os.write(2, b'\nSecond signal: exiting immediately without waiting for cleanup.\n')
            os._exit(130)
        self.stopping = True
        print('\nStopping; press Ctrl-C again to exit immediately.', flush=True)

    def start(self, name, args, *, stdin=None, normalize_output=False):
        if self.stopping:
            raise InterruptedError()
        print(f'Starting {name}...', flush=True)
        # A separate session lets cleanup reach shells and their descendants too.
        child = subprocess.Popen(args, cwd=ROOT, start_new_session=True, stdin=stdin,
                                 stdout=subprocess.PIPE if normalize_output else None,
                                 stderr=subprocess.STDOUT if normalize_output else None)
        if normalize_output:
            def relay():
                with child.stdout:
                    for line in iter(child.stdout.readline, b''):
                        print(line.rstrip(b'\r\n').decode(errors='replace'), flush=True)
            reader = threading.Thread(target=relay, daemon=True)
            reader.start()
            self.readers.append(reader)
        self.processes.append((name, child))
        return child

    def check(self):
        if self.stopping:
            raise InterruptedError()
        for name, child in self.processes:
            if child.poll() is not None:
                raise RuntimeError(f'{name} exited unexpectedly ({child.returncode}).')

    def run(self, name, args):
        child = self.start(name, args)
        while child.poll() is None:
            if self.stopping:
                raise InterruptedError()
            time.sleep(0.1)
        if child.returncode:
            raise RuntimeError(f'{name} failed ({child.returncode}).')
        self.processes.remove((name, child))

    def wait_port(self, port, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check()
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError(f'Timed out waiting for localhost:{port}.')

    def wait_client(self, timeout=60):
        path = ROOT / 'login/run/client.sock'
        print('Waiting for the pubsub client socket...', flush=True)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.2)
                try:
                    probe.connect(str(path))
                    print('Pubsub client socket is ready.', flush=True)
                    return
                except OSError:
                    time.sleep(0.1)
        raise RuntimeError('Timed out waiting for the pubsub client socket.')

    def wait_websocket(self, port, timeout=60):
        print(f'Waiting for WebSocket server on localhost:{port}...', flush=True)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check()
            if websocket_ready(port, timeout=min(1, max(0.01, deadline - time.monotonic()))):
                self.check()
                print('WebSocket server is ready.', flush=True)
                return
            time.sleep(0.1)
        raise RuntimeError(f'Timed out waiting for WebSocket server on localhost:{port}.')

    def shutdown(self, grace=8):
        # Close tunnels and Python services, including any surviving descendants.
        def send(sig):
            for _, child in reversed(self.processes):
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
        send(signal.SIGTERM)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            alive = False
            for _, child in self.processes:
                child.poll()  # Reap exited direct children.
                try:
                    os.killpg(child.pid, 0)
                    alive = True
                except ProcessLookupError:
                    pass
                except PermissionError:
                    # A restricted process probe isn't evidence that the group
                    # exited. Keep waiting and still reap our direct children.
                    alive = True
            if not alive:
                break
            time.sleep(0.1)
        send(signal.SIGKILL)
        for _, child in self.processes:
            child.wait()
        self.processes.clear()
        for reader in self.readers:
            reader.join(timeout=1)
        self.readers.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild', action='store_true', help='Force the full pipeline even if its build stamp is current.')
    args = parser.parse_args()
    supervisor = Supervisor()
    signal.signal(signal.SIGINT, supervisor.interrupt)
    signal.signal(signal.SIGTERM, supervisor.interrupt)
    try:
        missing = [name for name in ('login_secret_session_key', 'public.pem') if not (ROOT / 'login/run' / name).is_file()]
        if missing:
            raise RuntimeError('Missing required login files: ' + ', '.join('login/run/' + name for name in missing))
        # Refuse to attach to an unrelated local server or stale tunnel.
        for port in (8001, 8080):
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', port)) == 0:
                    raise RuntimeError(f'localhost:{port} is already in use. Stop the existing stack first.')
        created_venv = not PYTHON.exists()
        if created_venv:
            supervisor.run('virtual environment setup', [sys.executable, '-m', 'venv', str(ROOT / '.venv')])
        editable_check = """import importlib.metadata as m, json, pathlib
u=json.loads(m.distribution('flask-modular-login').read_text('direct_url.json') or '{}')
assert u.get('dir_info', {}).get('editable') and u.get('url') == pathlib.Path('login').resolve().as_uri()
"""
        # This short metadata check never imports the application or reads secrets.
        check = supervisor.start('editable login check', [str(PYTHON), '-c', editable_check])
        while check.poll() is None:
            if supervisor.stopping:
                raise InterruptedError()
            time.sleep(0.1)
        supervisor.processes.remove(('editable login check', check))
        if check.returncode:
            supervisor.run('editable login installation', [str(PYTHON), '-m', 'pip', 'install', '-e', str(ROOT / 'login')])
        digest = build_digest()
        if args.rebuild or created_venv or not STAMP.exists() or STAMP.read_text().strip() != digest or any(not (ROOT / p).is_file() for p in OUTPUTS):
            supervisor.run('build pipeline', ['sh', 'scripts/build_pipeline.sh'])
            STAMP.parent.mkdir(parents=True, exist_ok=True)
            STAMP.write_text(digest + '\n')
        else:
            print('Build is current.', flush=True)
        supervisor.run('browser asset staging', [str(PYTHON), 'scripts/stage_web.py'])
        ssh = ['ssh', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
        # The remote PTY delivers a hangup when SSH closes, stopping the remote
        # foreground command as well as the local tunnel.
        supervisor.start('login websocket server', ssh + ['-tt', '-L', '8001:localhost:8001', 'kent@slaney.org', 'stty -onlcr; exec bash ~/kent.slaney.org/login/server.sh ws server'], stdin=subprocess.DEVNULL, normalize_output=True)
        supervisor.wait_websocket(8001)
        supervisor.start('login pubsub client', [str(PYTHON), 'login/src/flask_modular_login/pubsub.py', 'client', '--host-url', 'https://kent.slaney.org'])
        supervisor.wait_client()
        supervisor.start('reverse tunnel', ssh + ['-N', '-R', '8081:localhost:8080', 'kent@slaney.org'])
        supervisor.start('authenticated web server', [str(PYTHON), 'scripts/remote_auth.py'])
        supervisor.wait_port(8080)
        print('Remote auth is running. Ctrl-C shuts down all four commands.', flush=True)
        while True:
            supervisor.check()
            time.sleep(0.2)
    except InterruptedError:
        return 130
    except Exception as error:
        print(f'Error: {error}', file=sys.stderr, flush=True)
        return 1
    finally:
        supervisor.shutdown()


if __name__ == '__main__':
    sys.exit(main())
