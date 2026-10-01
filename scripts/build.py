#!/usr/bin/env python3
"""Generuje stavové varianty stránky z index.html do složky stranky/.

  python3 scripts/build.py                  vygeneruje všechny varianty do stranky/
  python3 scripts/build.py --live vyprodano přepne i stav živé stránky index.html

Stavy (v pořadí životního cyklu akce):
  brzy · otevreno · posledni-mista · vyprodano · na-priste · po-akci

Zároveň synchronizuje FAQ ve strukturovaných datech (JSON-LD) s otázkami na stránce.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'index.html'
OUT_DIR = ROOT / 'stranky'

# slug → atribut data-state, výstupní soubor, dostupnost pro Google, prefix titulku, popis pro CMS
STATES = {
    'brzy': {'attr': 'teaser', 'file': 'brzy.html', 'availability': 'PreOrder', 'title': 'Přihlášky brzy',
             'label': 'Přihlášky brzy', 'hint': 'Termín je venku, registrace ještě neběží.'},
    'otevreno': {'attr': 'open', 'file': 'otevreno.html', 'availability': 'InStock', 'title': None,
                 'label': 'Otevřeno', 'hint': 'Registrace běží, formulář a platba.'},
    'posledni-mista': {'attr': 'lastcall', 'file': 'posledni-mista.html', 'availability': 'LimitedAvailability',
                       'title': 'Poslední místa', 'label': 'Poslední místa', 'hint': 'Registrace běží, zbývá pár míst.'},
    'vyprodano': {'attr': 'soldout', 'file': 'vyprodano.html', 'availability': 'SoldOut', 'title': 'Vyprodáno',
                  'label': 'Vyprodáno', 'hint': 'Plno, bez formuláře, odkaz na další termín.'},
    'na-priste': {'attr': 'waitlist', 'file': 'prihlaska-na-priste.html', 'availability': 'SoldOut',
                  'title': 'Přihláška na příště', 'label': 'Na příště', 'hint': 'Plno, formulář sbírá zájemce na další večer.'},
    'po-akci': {'attr': 'after', 'file': 'po-akci.html', 'availability': 'SoldOut', 'title': 'Po akci',
                'label': 'Po akci', 'hint': 'Poděkování, bez odpočtu, odkaz na další termín.'},
}

STATE_ATTR_RE = re.compile(r'<html lang="cs" data-state="([a-z]+)">')
TITLE_RE = re.compile(r'<title>(?:[^<·]+ · )?(Networking[^<]*)</title>')
FAQ_ITEM_RE = re.compile(
    r'<details>\s*<summary[^>]*>(.*?)</summary>\s*<div class="faq__answer"><p[^>]*>(.*?)</p></div>\s*</details>', re.S)
FAQ_SCHEMA_RE = re.compile(r'( *)\{\s*"@type": "FAQPage",.*?\n\1\}', re.S)


def write_atomic(path: Path, content: str) -> None:
    """Zapíše soubor přes dočasný soubor, takže se nikdy neuloží napůl."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f'.{path.name}.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def live_state(page: str | None = None) -> str:
    page = page if page is not None else SOURCE.read_text(encoding='utf-8')
    match = STATE_ATTR_RE.search(page)
    attr = match.group(1) if match else 'open'
    return next((slug for slug, st in STATES.items() if st['attr'] == attr), 'otevreno')


def plain(fragment: str) -> str:
    return html.unescape(re.sub(r'<[^>]+>', '', fragment)).strip()


def sync_faq_schema(page: str) -> str:
    items = FAQ_ITEM_RE.findall(page)
    match = FAQ_SCHEMA_RE.search(page)
    if not items or not match:
        return page
    indent = match.group(1)
    entities = [
        {'@type': 'Question', 'name': plain(q), 'acceptedAnswer': {'@type': 'Answer', 'text': plain(a)}}
        for q, a in items
    ]
    block = json.dumps({'@type': 'FAQPage', 'mainEntity': entities}, ensure_ascii=False, indent=2)
    block = '\n'.join(indent + line if i else line for i, line in enumerate(block.splitlines()))
    return page[:match.start()] + indent + block + page[match.end():]


def apply_state(page: str, state: dict, variant: bool) -> str:
    page = STATE_ATTR_RE.sub(f'<html lang="cs" data-state="{state["attr"]}">', page)
    page = re.sub(r'"availability": "https://schema.org/\w+"',
                  f'"availability": "https://schema.org/{state["availability"]}"', page)
    if variant:
        page = re.sub(r'<meta name="robots" content="[^"]*">', '<meta name="robots" content="noindex, follow">', page)
        page = re.sub(r'(src|href|poster)="assets/', r'\1="../assets/', page)
        if state['title']:
            page = TITLE_RE.sub(lambda m: f'<title>{state["title"]} · {m.group(1)}</title>', page)
    return page


def build(live: str | None = None) -> list[str]:
    source = sync_faq_schema(SOURCE.read_text(encoding='utf-8'))
    if live:
        source = apply_state(source, STATES[live], variant=False)
    write_atomic(SOURCE, source)

    written = []
    for state in STATES.values():
        write_atomic(OUT_DIR / state['file'], apply_state(source, state, variant=True))
        written.append(f'stranky/{state["file"]}')
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--live', choices=STATES, help='stav, který se nastaví přímo v index.html')
    args = parser.parse_args()
    for path in build(args.live):
        print(f'✓ {path}')
    print(f'✓ index.html → {live_state()}')


if __name__ == '__main__':
    main()
