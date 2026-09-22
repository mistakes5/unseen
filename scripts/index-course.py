"""Explicit local-only PDF/EPUB/Markdown course indexing. Never edits originals.
Usage: python3 scripts/index-course.py COURSE_ROOT OUTPUT.index.json
Dependencies: Poppler pdftotext; everything else is Python standard library.
"""
import datetime
import html.parser
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = False
    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script'): self.skip = True
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'br'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('style', 'script'): self.skip = False
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def chunks(text, size=2600):
    text = re.sub(r'-\n(?=[a-z])', '', text)
    text = re.sub(r'[ \t]+', ' ', text).strip()
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            split = max(text.rfind('. ', start + size // 2, end), text.rfind('\n', start + size // 2, end))
            if split > start: end = split + 1
        yield text[start:end].strip()
        start = end

def main():
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    output = pathlib.Path(sys.argv[2]).resolve()
    sources = []
    # Only known course reading directories and selected local study notes.
    for folder in ('Readings', 'Readings — library exports', 'Readings — public alternatives'):
        sources += sorted((root / 'Documents' / folder).glob('*.pdf'))
        sources += sorted((root / 'Documents' / folder).glob('*.epub'))
    sources += sorted(root.glob('*Lecture Summary.md'))
    sources += sorted((root / 'Documents' / 'Assignments').glob('Week *Plan.md'))
    rows = []; manifest = []
    for path in sources:
        # This local alternative is an entire edited resource book, not just the
        # named author's chapter. Exclude until its chapter boundaries are mapped.
        if 'Corntassel' in path.name:
            continue
        path.resolve().relative_to(root)  # Reject symlinks outside the scoped course.
        name = str(path.relative_to(root)); pages = []
        if path.suffix == '.pdf':
            text = subprocess.check_output(['pdftotext', str(path), '-'], text=True, stderr=subprocess.DEVNULL)
            pages = [(f'PDF file page {i}', p) for i, p in enumerate(text.split('\f'), 1)]
        elif path.suffix == '.epub':
            with zipfile.ZipFile(path) as z:
                container = ET.fromstring(z.read('META-INF/container.xml'))
                opf = next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('rootfile'))
                package = ET.fromstring(z.read(opf)); parent = pathlib.PurePosixPath(opf).parent
                items = {e.attrib['id']: e.attrib.get('href', '') for e in package.iter() if e.tag.endswith('}item')}
                for item in package.iter():
                    if not item.tag.endswith('}itemref'): continue
                    href = items[item.attrib['idref']]
                    parser = Text(); parser.feed(z.read(str(parent / href)).decode('utf-8'))
                    pages.append((f'EPUB section {href} (printed pages unverified)', ''.join(parser.parts)))
        else:
            pages = [('derivative study notes; not an original reading', path.read_text())]
        for locator, page in pages:
            for part, text in enumerate(chunks(page), 1):
                if len(text) > 100: rows.append({'source': name, 'locator': f'{locator}, excerpt {part}', 'text': text})
        manifest.append({'source': name, 'mtimeNs': path.stat().st_mtime_ns})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'version': 1, 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sources': manifest, 'chunks': rows}, ensure_ascii=False))
    output.chmod(0o600)
    print(json.dumps({'sources': len(manifest), 'chunks': len(rows), 'bytes': output.stat().st_size, 'output': str(output)}))

if __name__ == '__main__': main()
