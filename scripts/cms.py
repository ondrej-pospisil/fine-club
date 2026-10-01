#!/usr/bin/env python3
"""FINE CMS — lokální editor textů přímo na stránce.

  python3 scripts/cms.py

Otevře prohlížeč s webem v režimu úprav. Klikněte na text a přepište ho, ukládá se automaticky.

Bezpečnost:
  - server poslouchá jen na 127.0.0.1 (není dostupný z jiných zařízení ani z internetu),
  - každé spuštění má náhodný klíč; bez něj server nic neuloží ani nevydá (ochrana proti cizím webům),
  - kontroluje hlavičky Host/Origin (ochrana proti DNS rebinding a CSRF),
  - interní složky (scripts, zálohy, archiv, zdroje) se neservírují,
  - text z editoru se čistí, povolené jsou jen <em>, <strong> a <br>.

Ochrana dat:
  - před zápisem se dělá záloha do .cms/zalohy/ (historie s obnovením v editoru),
  - soubory se zapisují atomicky (nikdy se neuloží napůl),
  - pokud se text mezitím změnil jinde, editor ho nepřepíše a zeptá se.
"""
from __future__ import annotations

import hmac
import html
import json
import posixpath
import re
import secrets
import sys
import threading
import time
import webbrowser
from datetime import datetime
from functools import partial
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EDITOR_JS = Path(__file__).resolve().parent / 'cms-editor.js'
BACKUP_DIR = ROOT / '.cms' / 'zalohy'
PORTS = range(8787, 8797)
TOKEN = secrets.token_urlsafe(32)
MAX_BODY = 2 * 1024 * 1024
BACKUP_KEEP = 200
BACKUP_INTERVAL = 5 * 60
WRITE_LOCK = threading.Lock()

# Stránky, které se upravují ručně (varianty ve stranky/ se generují z index.html).
PAGES = {
    'index.html': 'Hlavní stránka',
    'stranky/klub.html': 'Klub — koncept',
}
BLOCKED_PREFIXES = ('scripts/', '_archive/', '_source/', '.cms/')

LEAF_RE = re.compile(
    r'<(h1|h2|h3|h4|p|span|a|b|dt|dd|summary|blockquote|small|li|figcaption|button)(\s[^>]*)?>'
    r'((?:[^<]|<(?:em|strong)(?:\s[^>]*)?>|</(?:em|strong)>|<br\s*/?>)*?)</\1>')
PROTECTED_RE = re.compile(r'<(svg|script|style|head)\b.*?</\1>', re.S)
ID_RE = re.compile(r'data-cms="t(\d+)"')
BACKUP_NAME_RE = re.compile(r'^\d{8}-\d{6}-\d{6}__[a-z-]+\.html$')


# ---------------------------------------------------------------------------
# Označení editovatelných textů
# ---------------------------------------------------------------------------
def tag_page(page: str) -> str:
    """Doplní data-cms="tNNN" ke každému textovému prvku, který ho ještě nemá."""
    next_id = max((int(n) for n in ID_RE.findall(page)), default=0) + 1

    def tag(match: re.Match) -> str:
        nonlocal next_id
        tag_name, attrs, inner = match.group(1), match.group(2) or '', match.group(3)
        text = html.unescape(re.sub(r'<[^>]+>', '', inner)).strip()
        if 'data-cms=' in attrs or not re.search(r'\w', text):
            return match.group(0)
        tagged = f'<{tag_name}{attrs} data-cms="t{next_id:03d}">{inner}</{tag_name}>'
        next_id += 1
        return tagged

    out, pos = [], 0
    for block in PROTECTED_RE.finditer(page):
        out.append(LEAF_RE.sub(tag, page[pos:block.start()]))
        out.append(block.group(0))
        pos = block.end()
    out.append(LEAF_RE.sub(tag, page[pos:]))
    return ''.join(out)


# ---------------------------------------------------------------------------
# Čištění textu z editoru
# ---------------------------------------------------------------------------
class Sanitizer(HTMLParser):
    OPEN = {'em': '<em class="ital">', 'i': '<em class="ital">', 'strong': '<strong>', 'b': '<strong>'}
    CLOSE = {'em': '</em>', 'i': '</em>', 'strong': '</strong>', 'b': '</strong>'}

    DROP = {'script', 'style', 'template', 'noscript', 'iframe', 'object'}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.DROP:
            self.skip += 1
        elif self.skip:
            return
        elif tag == 'br':
            self.out.append('<br>')
        elif tag in self.OPEN:
            self.out.append(self.OPEN[tag])

    def handle_endtag(self, tag):
        if tag in self.DROP:
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in self.CLOSE:
            self.out.append(self.CLOSE[tag])

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data.replace('\xa0', ' '), quote=False))


def sanitize(fragment: str) -> str:
    parser = Sanitizer()
    parser.feed(fragment)
    parser.close()
    text = re.sub(r'[ \t\r\n]+', ' ', ''.join(parser.out)).strip()
    return re.sub(r'(<br>\s*)+$', '', text)


def element_pattern(cms_id: str) -> re.Pattern:
    return re.compile(rf'(<(\w+)[^>]*\sdata-cms="{cms_id}"[^>]*>)(.*?)(</\2>)', re.S)


def apply_changes(page: str, changes: dict, meta: dict, force: bool) -> tuple[str, list, list]:
    saved, conflicts = [], []
    for cms_id, change in changes.items():
        if not re.fullmatch(r't\d+', cms_id) or not isinstance(change, dict):
            continue
        pattern = element_pattern(cms_id)
        match = pattern.search(page)
        if not match:
            conflicts.append({'id': cms_id, 'current': None})
            continue
        if not force and sanitize(match.group(3)) != sanitize(str(change.get('base', ''))):
            conflicts.append({'id': cms_id, 'current': match.group(3)})
            continue
        clean = sanitize(str(change.get('html', '')))
        page = page[:match.start()] + match.group(1) + clean + match.group(4) + page[match.end():]
        saved.append(cms_id)

    if meta.get('title'):
        title = html.escape(str(meta['title']).strip()[:120], quote=False)
        page = re.sub(r'<title>.*?</title>', lambda _: f'<title>{title}</title>', page, count=1, flags=re.S)
    if meta.get('description'):
        desc = html.escape(str(meta['description']).strip()[:300], quote=True)
        page = re.sub(r'<meta name="description" content="[^"]*">',
                      lambda _: f'<meta name="description" content="{desc}">', page, count=1)
    return page, saved, conflicts


# ---------------------------------------------------------------------------
# Zálohy
# ---------------------------------------------------------------------------
def backup_dir(page_name: str) -> Path:
    return BACKUP_DIR / page_name.replace('/', '__').removesuffix('.html')


def list_backups(page_name: str) -> list[Path]:
    folder = backup_dir(page_name)
    return sorted(folder.glob('*.html'), reverse=True) if folder.exists() else []


def make_backup(page_name: str, reason: str, force: bool = True) -> None:
    content = (ROOT / page_name).read_text(encoding='utf-8')
    existing = list_backups(page_name)
    if existing and not force and time.time() - existing[0].stat().st_mtime < BACKUP_INTERVAL:
        return
    if existing and existing[0].read_text(encoding='utf-8') == content:
        return
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    build.write_atomic(backup_dir(page_name) / f'{stamp}__{reason}.html', content)
    for old in list_backups(page_name)[BACKUP_KEEP:]:
        old.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    server_version = 'FINE-CMS'
    sys_version = ''

    def log_message(self, fmt, *args):
        pass

    # --- bezpečnostní kontroly -------------------------------------------
    def allowed_hosts(self) -> set[str]:
        port = self.server.server_address[1]
        return {f'127.0.0.1:{port}', f'localhost:{port}'}

    def host_ok(self) -> bool:
        return self.headers.get('Host', '') in self.allowed_hosts()

    def api_ok(self) -> bool:
        token = self.headers.get('X-CMS-Token', '')
        if not hmac.compare_digest(token, TOKEN):
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{h}' for h in self.allowed_hosts()}:
            return False
        return self.headers.get('Sec-Fetch-Site', 'same-origin') in {'same-origin', 'none'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
        super().end_headers()

    # --- GET ---------------------------------------------------------------
    def do_GET(self):
        if not self.host_ok():
            return self.send_error(403)
        url = urlsplit(self.path)
        path = posixpath.normpath(unquote(url.path)).lstrip('/')
        path = '' if path == '.' else path

        if path == '__cms/editor.js':
            return self.send_bytes(EDITOR_JS.read_bytes(), 'text/javascript; charset=utf-8')
        if path == '__cms/history':
            if not self.api_ok():
                return self.send_json({'ok': False, 'error': 'Neplatný klíč relace'}, 403)
            page_name = parse_qs(url.query).get('page', [''])[0]
            if page_name not in PAGES:
                return self.send_json({'ok': False, 'error': 'Neznámá stránka'}, 400)
            items = [{'id': b.name, 'time': b.stat().st_mtime, 'reason': b.stem.split('__', 1)[1]}
                     for b in list_backups(page_name)]
            return self.send_json({'ok': True, 'items': items})
        if path.startswith('__cms/'):
            return self.send_error(404)

        page_name = path or 'index.html'
        if page_name in PAGES:
            return self.send_editor_page(page_name)
        if any(page_name.startswith(p) for p in BLOCKED_PREFIXES) or any(
                part.startswith('.') for part in page_name.split('/')):
            return self.send_error(404)
        return super().do_GET()

    def send_editor_page(self, page_name: str):
        page = (ROOT / page_name).read_text(encoding='utf-8')
        config = {
            'page': page_name,
            'pages': PAGES,
            'token': TOKEN,
            'live': build.live_state() if page_name == 'index.html' else None,
            'states': [{'slug': slug, **{k: st[k] for k in ('attr', 'label', 'hint', 'file')}}
                       for slug, st in build.STATES.items()] if page_name == 'index.html' else [],
        }
        config_json = json.dumps(config, ensure_ascii=False).replace('</', '<\\/')
        head = '<script>document.documentElement.setAttribute("data-cms-edit","")</script>\n</head>'
        body = (f'<script>window.FINE_CMS={config_json}</script>\n'
                '<script src="/__cms/editor.js" defer></script>\n</body>')
        page = page.replace('</head>', head, 1).replace('</body>', body, 1)
        self.send_bytes(page.encode('utf-8'), 'text/html; charset=utf-8')

    # --- POST --------------------------------------------------------------
    def do_POST(self):
        if not self.host_ok() or not self.api_ok():
            return self.send_json({'ok': False, 'error': 'Požadavek odmítnut (neplatný klíč relace)'}, 403)
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.send_json({'ok': False, 'error': 'Očekávám JSON'}, 415)
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_json({'ok': False, 'error': 'Požadavek je příliš velký'}, 413)
        try:
            payload = json.loads(self.rfile.read(length))
            routes = {'/__cms/save': self.api_save, '/__cms/restore': self.api_restore, '/__cms/live': self.api_live}
            handler = routes.get(self.path)
            if not handler:
                return self.send_json({'ok': False, 'error': 'Neznámá akce'}, 404)
            with WRITE_LOCK:
                return self.send_json(handler(payload))
        except Exception as exc:  # chyba se zobrazí v editoru
            return self.send_json({'ok': False, 'error': str(exc)}, 400)

    def api_save(self, payload: dict) -> dict:
        page_name = payload.get('page')
        if page_name not in PAGES:
            raise ValueError('Neznámá stránka')
        file = ROOT / page_name
        before = file.read_text(encoding='utf-8')
        after, saved, conflicts = apply_changes(before, payload.get('changes') or {}, payload.get('meta') or {},
                                                bool(payload.get('force')))
        built = []
        if after != before:
            make_backup(page_name, 'uprava', force=False)
            build.write_atomic(file, after)
            built = build.build() if page_name == 'index.html' else []
            log(f'uloženo: {page_name} ({len(saved)} textů)')
        return {'ok': True, 'saved': saved, 'conflicts': conflicts, 'built': bool(built), 'time': time.time()}

    def api_restore(self, payload: dict) -> dict:
        page_name, backup = payload.get('page'), str(payload.get('backup', ''))
        if page_name not in PAGES or not BACKUP_NAME_RE.match(backup):
            raise ValueError('Neplatná záloha')
        source = backup_dir(page_name) / backup
        if not source.exists():
            raise ValueError('Záloha neexistuje')
        make_backup(page_name, 'pred-obnovou')
        build.write_atomic(ROOT / page_name, source.read_text(encoding='utf-8'))
        if page_name == 'index.html':
            build.build()
        log(f'obnoveno: {page_name} ze zálohy {backup}')
        return {'ok': True}

    def api_live(self, payload: dict) -> dict:
        state = payload.get('state')
        if state not in build.STATES:
            raise ValueError('Neznámý stav')
        make_backup('index.html', 'zmena-stavu')
        build.build(live=state)
        log(f'živá verze: {state}')
        return {'ok': True, 'live': state}

    # --- odpovědi ----------------------------------------------------------
    def send_bytes(self, body: bytes, content_type: str, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data: dict, status: int = 200):
        self.send_bytes(json.dumps(data, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', status)


def log(message: str) -> None:
    print(f'{datetime.now():%H:%M:%S}  ✓ {message}', flush=True)


def start_server() -> ThreadingHTTPServer:
    handler = partial(Handler, directory=str(ROOT))
    for port in PORTS:
        try:
            return ThreadingHTTPServer(('127.0.0.1', port), handler)
        except OSError:
            continue
    raise SystemExit('Nepodařilo se najít volný port. Neběží už CMS v jiném okně?')


def main() -> None:
    for name in PAGES:
        file = ROOT / name
        tagged = tag_page(file.read_text(encoding='utf-8'))
        if tagged != file.read_text(encoding='utf-8'):
            build.write_atomic(file, tagged)
        make_backup(name, 'start')
    build.build()

    server = start_server()
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'FINE CMS běží na {url}\nZálohy: {BACKUP_DIR.relative_to(ROOT)}/   ·   Ukončení: Ctrl+C', flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nCMS ukončeno. Neuložené změny zůstávají v prohlížeči a nabídnou se při dalším spuštění.')


if __name__ == '__main__':
    main()
