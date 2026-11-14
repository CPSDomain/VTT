"""Turns docs/DM-GUIDE.md and docs/PLAYER-GUIDE.md into the PDF guides the apps offer under Help
(public/guides/Tabletop-DM-Guide.pdf and Tabletop-Player-Guide.pdf). Run it after changing a guide:
    pip install markdown playwright && playwright install chromium
    python build/make-guides.py
"""
import json, pathlib, re, datetime, markdown
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS, OUT = ROOT / 'docs', ROOT / 'public' / 'guides'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
REPO = 'https://github.com/CPSDomain/VTT/blob/HEAD/docs/'

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1c1917; margin: 0; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; border-left: 6px solid #e8390e; padding-left: 14mm; }
.cover .brand { font-size: 12pt; letter-spacing: .3em; font-weight: 700; color: #e8390e; }
.cover h1 { font-size: 34pt; margin: 6mm 0 3mm; border: 0; }
.cover p { color: #57534e; font-size: 12pt; margin: 0; max-width: 120mm; }
.cover .meta { margin-top: 12mm; font-size: 10pt; color: #78716c; }
.toc { page-break-after: always; } .toc h2 { margin-top: 0; } .toc ol { columns: 2; column-gap: 10mm; padding-left: 5mm; } .toc li { margin: 1.5mm 0; break-inside: avoid; }
.toc a { color: #1c1917; text-decoration: none; }
h1 { font-size: 20pt; margin: 0 0 4mm; }
h2 { font-size: 15pt; color: #e8390e; border-bottom: 1px solid #e7e5e4; padding-bottom: 1.5mm; margin: 9mm 0 3mm; break-after: avoid; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; } ul, ol { padding-left: 6mm; } li { margin: 1mm 0; }
code { font: 9pt Consolas, "Courier New", monospace; background: #f5f5f4; padding: 0 1mm; border-radius: 2px; }
a { color: #c2410c; }
img { display: block; max-width: 100%; max-height: 105mm; margin: 4mm auto; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,.25); break-inside: avoid; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 3mm 0; break-inside: auto; }
th, td { border: 1px solid #e7e5e4; padding: 1.5mm 2mm; text-align: left; vertical-align: top; } th { background: #fafaf9; }
tr { break-inside: avoid; }
"""

def build(src, out, title, blurb):
    md = (DOCS / src).read_text(encoding='utf-8')
    md = re.sub(r'\]\((?!https?:|#|images/)([A-Za-z0-9_.-]+\.md)\)', lambda m: '](' + REPO + m.group(1) + ')', md)  # other guides: on GitHub
    md = re.sub(r'^# .*\n', '', md, count=1)
    body = markdown.markdown(md, extensions=['tables', 'sane_lists', 'toc'])
    heads = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', body)
    toc = '<section class="toc"><h2>Contents</h2><ol>' + ''.join(f'<li><a href="#{i}">{t}</a></li>' for i, t in heads) + '</ol></section>'
    date = datetime.date.today().strftime('%d %B %Y').lstrip('0')
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><base href="{(DOCS).as_uri()}/"><style>{CSS}</style></head><body>
<section class="cover"><div class="brand">TABLETOP</div><h1>{title}</h1><p>{blurb}</p><div class="meta">Version {VERSION} · {date}</div></section>
{toc}{body}</body></html>"""
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / (out + '.html'); tmp.write_text(html, encoding='utf-8')
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto(tmp.as_uri()); pg.wait_for_load_state('networkidle')
        pg.pdf(path=str(OUT / out), format='A4', print_background=True, display_header_footer=True,
               header_template='<span></span>',
               footer_template=f'<div style="font:8px Arial;color:#78716c;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>{title} · Tabletop {VERSION}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
               margin={'top': '18mm', 'bottom': '20mm', 'left': '16mm', 'right': '16mm'})
        b.close()
    tmp.unlink()
    print(out, (OUT / out).stat().st_size // 1024, 'KB')

build('DM-GUIDE.md', 'Tabletop-DM-Guide.pdf', 'DM guide', 'Running a session in Tabletop: the server, players, maps, fog, combat, spells, monsters and items.')
build('PLAYER-GUIDE.md', 'Tabletop-Player-Guide.pdf', 'Player guide', 'Joining the table with Tabletop Player: your character, dice, combat, spells, items and summons.')
