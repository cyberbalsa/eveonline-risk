#!/usr/bin/env python3
"""Extract CCP's in-client 2D map positions for the frozen warzone roster."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--build', default='3528119', help='Pinned CCP SDE build')
args = parser.parse_args()
url = f'https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-{args.build}-jsonl.zip'
archive = ROOT / '.cache/sde' / url.rsplit('/', 1)[1]
archive.parent.mkdir(parents=True, exist_ok=True)
if not archive.exists():
    print(f'Downloading SDE {args.build}…', flush=True)
    urllib.request.urlretrieve(url, archive)
warzone = json.loads((ROOT / 'research/warzone.json').read_text())
ids = {s['system_id'] for s in warzone['systems']}
with zipfile.ZipFile(archive) as source:
    data = source.read('mapSolarSystems.jsonl')
    records = [json.loads(line) for line in data.splitlines()]
systems = []
for record in records:
    if record['_key'] in ids:
        if 'position2D' not in record:
            raise ValueError(f"Missing in-client coordinates for {record['_key']}")
        systems.append({'id': record['_key'], 'name': record['name']['en'],
                        'position2D': record['position2D'], 'position': record['position']})
assert {s['id'] for s in systems} == ids
snapshot = {
    'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source': url, 'build': int(args.build), 'member': 'mapSolarSystems.jsonl',
    'memberSHA256': hashlib.sha256(data).hexdigest(),
    'reference': 'https://developers.eveonline.com/docs/guides/map-data/',
    'method': 'Use CCP position2D for the in-game 2D star map: +X right, +Y north. Reflect Y for SVG screen coordinates, then translate and uniformly scale. No force layout, per-system offsets, or aspect-ratio distortion.',
    'systems': sorted(systems, key=lambda s: s['id']),
}
(ROOT / 'research/map-layout.json').write_text(json.dumps(snapshot, indent=2) + '\n')
print(f'Extracted {len(systems)} official map positions from SDE {args.build}.')
