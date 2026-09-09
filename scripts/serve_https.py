#!/usr/bin/env python3
"""Serve project files over HTTPS; HTTP serves only the CA installation profile."""
import functools
import http.server
import os
import pathlib
import plistlib
import socket
import ssl
import subprocess
import tempfile
import threading
import urllib.parse
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
CERTS = ROOT / '.local-https'
HOSTNAME = socket.getfqdn()


def ensure_certificates():
    """Generate once, staging files so a failed command leaves no partial CA."""
    if CERTS.exists():
        return
    previous_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='.https-setup-', dir=ROOT) as temporary:
            staging = pathlib.Path(temporary)
            certs = staging / 'certificates'
            certs.mkdir(mode=0o700)

            def openssl(*args):
                subprocess.run(['openssl', *args], cwd=certs, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

            openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256',
                    '-days', '3650', '-subj', '/CN=Sphere Debug Local CA',
                    '-addext', 'basicConstraints=critical,CA:TRUE',
                    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
                    '-keyout', 'root-key.pem', '-out', 'root.pem')
            openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
                    '-subj', f'/CN={HOSTNAME}', '-keyout', 'server-key.pem',
                    '-out', 'server.csr')
            (certs / 'server.ext').write_text(
                'basicConstraints=critical,CA:FALSE\n'
                'keyUsage=critical,digitalSignature,keyEncipherment\n'
                'extendedKeyUsage=serverAuth\n'
                f'subjectAltName=DNS:{HOSTNAME},DNS:localhost,IP:127.0.0.1\n')
            openssl('x509', '-req', '-in', 'server.csr', '-CA', 'root.pem',
                    '-CAkey', 'root-key.pem', '-CAcreateserial', '-out', 'server.pem',
                    '-days', '365', '-sha256', '-extfile', 'server.ext')
            openssl('x509', '-in', 'root.pem', '-outform', 'DER', '-out', 'root.cer')
            payload = dict(
                PayloadType='com.apple.security.root', PayloadVersion=1,
                PayloadIdentifier='local.sphere-debug.ca', PayloadUUID=str(uuid.uuid4()),
                PayloadDisplayName='Sphere Debug Local CA',
                PayloadContent=(certs / 'root.cer').read_bytes())
            profile = dict(
                PayloadType='Configuration', PayloadVersion=1,
                PayloadIdentifier='local.sphere-debug', PayloadUUID=str(uuid.uuid4()),
                PayloadDisplayName='Sphere Debug HTTPS',
                PayloadDescription='Trust the local development certificate authority for Sphere Debug on your Mac.',
                PayloadContent=[payload])
            (certs / 'vision-pro.mobileconfig').write_bytes(plistlib.dumps(profile))
            certs.rename(CERTS)
        print('Created local CA, server certificate, and Vision Pro installation profile.', flush=True)
    finally:
        os.umask(previous_umask)

class Site(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = pathlib.Path(self.translate_path(self.path)).resolve()
        if not path.is_relative_to(ROOT) or any(p.startswith('.') for p in path.relative_to(ROOT).parts):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

class CertificateDownload(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path != '/vision-pro.mobileconfig':
            self.send_error(404)
            return
        data = (CERTS / 'vision-pro.mobileconfig').read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-apple-aspen-config')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    ensure_certificates()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERTS / 'server.pem', CERTS / 'server-key.pem')
    https = http.server.ThreadingHTTPServer(('0.0.0.0', 8443), functools.partial(Site, directory=str(ROOT)))
    https.socket = context.wrap_socket(https.socket, server_side=True)
    bootstrap = http.server.ThreadingHTTPServer(('0.0.0.0', 8001), CertificateDownload)
    threading.Thread(target=bootstrap.serve_forever, daemon=True).start()
    print(f'Install: http://{HOSTNAME}:8001/vision-pro.mobileconfig', flush=True)
    print(f'Site: https://{HOSTNAME}:8443/index.html', flush=True)
    try:
        https.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        https.server_close()
        bootstrap.shutdown()
        bootstrap.server_close()
