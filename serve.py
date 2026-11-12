"""Server locale per Scadense: python serve.py [porta]
Come `python -m http.server`, ma forza i MIME corretti (su Windows .js puo' risultare text/plain)."""
import mimetypes
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('image/svg+xml', '.svg')
mimetypes.add_type('text/css', '.css')

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
print(f'Scadense su http://localhost:{port}  (Ctrl+C per fermare)')
ThreadingHTTPServer(('', port), partial(SimpleHTTPRequestHandler, directory='.')).serve_forever()
