#!/usr/bin/env python3
"""Freeze public ESI geography. Cached, rate-conscious, no auth or runtime API."""
import concurrent.futures, datetime, json, pathlib, time, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/esi'
CACHE.mkdir(parents=True, exist_ok=True)
API = 'https://esi.evetech.net/latest'

def fetch(route):
    file = CACHE / (route.strip('/').replace('/', '-') + '.json')
    if file.exists():
        return json.loads(file.read_text())
    url = API + route + '?datasource=tranquility'
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'New-Eden-Warfront/1.0 (https://github.com/cyberbalsa/eveonline-risk)'})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            file.write_text(json.dumps(data))
            time.sleep(.08)
            return data
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4: raise
            time.sleep(2 ** attempt)

def main():
    roster = [s for s in fetch('/fw/systems/') if s['owner_faction_id'] in [500001, 500004]]
    ids = sorted(s['solar_system_id'] for s in roster)
    print(f'Fetching geography for {len(ids)} systems', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        systems = list(pool.map(lambda i: fetch(f'/universe/systems/{i}/'), ids))
        cids = sorted(set(s['constellation_id'] for s in systems))
        cs = dict(zip(cids, pool.map(lambda i: fetch(f'/universe/constellations/{i}/'), cids)))
        rids = sorted(set(c['region_id'] for c in cs.values()))
        rs = dict(zip(rids, pool.map(lambda i: fetch(f'/universe/regions/{i}/'), rids)))
        gids = [g for s in systems for g in s.get('stargates', [])]
        gates = list(pool.map(lambda i: fetch(f'/universe/stargates/{i}/'), gids))
    edges = sorted(set(tuple(sorted((g['system_id'], g['destination']['system_id']))) for g in gates if g['destination']['system_id'] in ids))
    out = {'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'api': API,
           'roster': roster, 'systems': systems, 'constellations': cs, 'regions': rs, 'stargates': gates,
           'edges': edges, 'method': 'Original owner faction 500001 or 500004; direct stargates whose two endpoints are in the warzone. No invented links.'}
    (ROOT / 'research').mkdir(exist_ok=True)
    (ROOT / 'research/warzone.json').write_text(json.dumps(out, indent=2) + '\n')
    print(f'Saved {len(systems)} systems and {len(edges)} direct connections', flush=True)

if __name__ == '__main__': main()
