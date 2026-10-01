# FINE Club — web

Statický web. Na hosting (Vercel) se nahrává celá složka; `.vercelignore` z nasazení vynechá `scripts/`, `.cms/`, `_archive/` a `_source/`.

```
index.html                 hlavní stránka a zdroj pro všechny stavy akce (SEO, JSON-LD)
stranky/
  brzy.html … po-akci.html náhledy všech fází akce, generované z index.html (neindexují se)
  klub.html                koncept uzavřeného klubu „Kruh" pouze na pozvání (neindexuje se)
scripts/
  cms.py                   lokální editor textů (FINE CMS)
  cms-editor.js            editor, který se v režimu úprav vloží do stránky
  build.py                 generuje varianty a přepíná stav živého webu
.cms/zalohy/               zálohy z CMS (nenahrávají se na web)
robots.txt, sitemap.xml    pro vyhledávače
llms.txt                   shrnutí faktů pro AI vyhledávače (GEO)
assets/
  css/main.css             styly (tokeny, typografická škála, komponenty)
  js/main.js               scroll efekty, odpočet, menu, videa, Tally
  img/
    brand/                 loga (SVG, barva přes currentColor)
    photos/                zakladatelé, průběh večera, host
    events/2026-06/        první večer (červen)
    events/2026-08/        druhý večer (srpen)
    payment/               QR kód pro platbu
  video/                   hero.mp4 (zatím chybí)
_archive/                  starší verze webu (v8 a dřív)
_source/                   originální podklady (HEIC, původní loga)
```

## Úprava textů (FINE CMS)

```bash
python3 scripts/cms.py
```

Otevře se prohlížeč s webem v režimu úprav (jen na vašem počítači):

- **klikněte na text** a přepište ho · Enter potvrdí · Esc vrátí původní · Shift+Enter = nový řádek,
- **ukládá se automaticky** (vteřinu po dopsání), případně tlačítkem Uložit nebo Cmd+S,
- **Verze stránky** — přepínač šesti fází akce, náhled každé z nich a tlačítko „Nastavit jako živou“,
- **SEO** — titulek a popis pro Google, **Historie** — zálohy s obnovením jedním klikem,
- lištu jde sbalit šipkou vlevo.

**Skrytí sekce:** do značky `<section …>` v `index.html` přidejte slovo `hidden` (zobrazení: slovo smažte).
Skrytá sekce se na webu neukáže, v CMS je vidět zeslabeně s červeným štítkem. Takhle jsou teď skryté
sekce „Co nás baví“ (`#proc`) a „Po večerech“ (`#ohlasy`).

**QR kód k platbě** je jen v Tally. Původní obrázek je v `_source/qr-platba-500.jpg`.

### Aby se nic neztratilo

| Situace | Co se stane |
| --- | --- |
| Zavřete okno nebo spadne prohlížeč | rozepsané texty jsou v prohlížeči, při dalším otevření se nabídnou k obnovení |
| CMS server neběží (zavřený Terminál) | editor to ukáže, změny drží v prohlížeči a uloží je, jakmile server znovu poběží |
| Stejný text se mezitím změnil jinde | editor ho nepřepíše a zeptá se, která verze platí |
| Chcete se vrátit k dřívější verzi | Historie → Obnovit (aktuální stav se předtím sám zazálohuje) |

Zálohy jsou ve složce `.cms/zalohy/` (posledních 200 na stránku). Soubory se zapisují atomicky, takže se nikdy neuloží napůl.

### Zabezpečení

Server poslouchá jen na `127.0.0.1`, každé spuštění má náhodný klíč, kontroluje původ požadavků (ochrana proti cizím webům
a DNS rebindingu), neservíruje interní složky a text z editoru čistí (povolené jsou jen *kurzíva*, **tučné** a zalomení).
Atributy `data-cms="t001"` v HTML jsou značky pro editor, návštěvníci je nevidí.

## Verze stránky (fáze akce)

Obsah všech fází je v `index.html`, zobrazení řídí `<html data-state="…">` a bloky `data-when="…"`.

| Fáze | Slug | Kdy použít | Co je jinak |
| --- | --- | --- | --- |
| Přihlášky brzy | `brzy` | termín je venku, registrace ještě neběží | štítek „Přihlášky brzy“, bez formuláře, razítko na vstupence |
| Otevřeno | `otevreno` | registrace běží | rezervace, formulář, vstupenka 00/35 |
| Poslední místa | `posledni-mista` | zbývá pár míst | štítek „Posledních pár míst“ v úvodu, kartě i liště |
| Vyprodáno | `vyprodano` | kapacita je plná | razítko „Máme vyprodáno!“, místo formuláře karta dalšího večera |
| Na příště | `na-priste` | plno, ale sbíráte zájemce | formulář jako přednostní registrace na další večer |
| Po akci | `po-akci` | den po večeru | poděkování, bez odpočtu, razítko „Díky, že jste dorazili!“ |

Každá fáze má náhled ve `stranky/<slug>.html` (neindexuje se). Živou fázi nastavíte v CMS, nebo:

```bash
python3 scripts/build.py --live vyprodano
```

Po ruční úpravě `index.html` mimo CMS spusťte `python3 scripts/build.py`.
Odpočet v úvodu si sám vybírá nejbližší termín podle dat `data-days-to` u karet v sekci Termíny a po skončení večera se přepne na další. Při novém termínu stačí upravit kartu (text v CMS, datum v `data-days-to`).

## Fotky

| Soubor | Kde je na webu |
| --- | --- |
| `events/2026-08/srpen-spolecna.jpg` | Minulé večery (srpen), pozadí sestřihu, náhled pro sdílení (`og-image.jpg`) |
| `events/2026-08/srpen-ondra-martina.jpg` | Jak to vzniklo |
| `events/2026-08/srpen-predstaveni.jpg` | Průběh → Představovací kolečko |
| `events/2026-08/momentka-1.jpg` | Průběh → Volné rozhovory |
| `events/2026-08/momentka-2.jpg` | Průběh → Společná večeře |
| `events/2026-08/momentka-3.jpg` | Přiveďte jednoho člověka |
| `events/2026-08/video-nahled.jpg` | Náhled videa ze srpna |
| `events/2026-06/networking-cerven-1.jpg`, `-2.jpg` | Minulé večery (červen), klíčová dírka, úvod |
| `video/hero.mp4` | Video v úvodu (zatím chybí, ukazuje se fotka) |

Originály ve plné velikosti jsou v `_source/`. Pro web exportujte na 1600 px delší strany, JPG kvalita ~80.

## Lokální náhled

```bash
python3 -m http.server 5173
```
