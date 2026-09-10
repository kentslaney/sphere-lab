from werkzeug.middleware.proxy_fix import ProxyFix
from flask_modular_login import RemoteLoginBuilder, AccessNamespace
import flask, asyncio, pathlib

access = flask.Blueprint('access', __name__)

from stage_web import stage_web
stage_web()

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'web'

@access.route('/', defaults={'filename': 'index.html'})
@access.route('/<path:filename>')
def serve_directory(filename):
    path = (ROOT / filename).resolve()
    if not path.is_relative_to(ROOT) or any(part.startswith('.') for part in path.relative_to(ROOT).parts):
        flask.abort(404)
    return flask.send_from_directory(ROOT, filename)

group = AccessNamespace(
        "sphere_debug_access", "google", "100312806121431583241")

login_config = RemoteLoginBuilder(
        "https://kent.slaney.org", "ws://localhost:8001")
login_required, login_optional = login_config.decorators

asyncio.run(
        login_config.bp.ensure_access(group.qualname, owner=group.info.owner))

app = flask.Flask(__name__)
# Keep /index.html at the requested URL; a default-route redirect to / would
# discard a prefix stripped by nginx before proxying the request.
app.url_map.redirect_defaults = False
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)
#login_required.prefix = "//sub.domain.tld"
app.register_blueprint(login_required(access, group=group))


if __name__ == "__main__":
    app.run(port=8080)
