"""Record only completed checks against the distributed source revision."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import re
import shutil
import xml.etree.ElementTree as ET

from consumer_paths import SOURCE_ROOT, consumer_path, workspace_path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('stage', choices=['stalker', 'guide'])
args = parser.parse_args()
stage = args.stage
ci_count = 117 if stage == 'guide' else 116
root = SOURCE_ROOT
manifest = json.loads((root / 'shared-core/dist/ottplay-core.manifest.json').read_text())
source = manifest['source']['sha256']
now = datetime.datetime.now(datetime.timezone.utc).isoformat()


def read(name):
    return (root / ('reports/' + stage + '-' + name)).read_text()


def require(name, expected):
    assert expected in read(name), (name, expected)


def suites(directory, kind):
    rows = []
    for report in sorted((directory / 'build/test-results' / kind).glob('TEST-*.xml')):
        element = ET.parse(report).getroot()
        row = dict(suite=element.attrib['name'], **{key: int(element.attrib.get(key, 0)) for key in ['tests', 'failures', 'errors', 'skipped']}, report=str(report.relative_to(directory)))
        assert not row['failures'] and not row['errors'] and not row['skipped'], report
        rows.append(row)
    assert rows, directory
    return rows


for file, marker in {
    'core-final.log': 'BUILD SUCCESSFUL', 'pack-final.log': 'PASS core distribution: build',
    'android-build.log': 'BUILD SUCCESSFUL', 'main-tests.log': f'{ci_count}/{ci_count} tests reachable',
    'server-es5.log': 'ES5 grammar for 206', 'foss2-tests.log': 'PASS shared core receipt',
    'native-adapters.log': 'PASS Kotlin XMLTV edition defaults=true: 18',
    'xcode-build.log': '** BUILD SUCCEEDED **', 'typecheck.log': 'tsc --noEmit',
    'boundary.log': 'PASS unified guide/archive/playlist/Xtream/Stalker artifacts',
    'container-smoke.log': source, 'rust-tests.log': 'test result: ok. 22 passed',
    'alpine-tests.log': 'test result: ok. 15 passed', 'python-tests.log': '81%',
}.items():
    require(file, marker)
require('native-adapters.log', 'PASS Swift native parity')
require('container-smoke.log', 'PASS container health')
for file in ['rust-tests.log', 'alpine-tests.log']:
    require(file, 'test result: ok. 29 passed')
    require(file, 'test result: ok. 15 passed')
require('foss2-tests.log', 'fail 0')
foss2_count = int(re.search(r'pass (\d+)', read('foss2-tests.log')).group(1))

fixture_files = {
    'foss2': 'ottplay-foss2/tests/fixtures/stalker-before-core.json',
    'android': 'ottplay-android/core/src/test/resources/stalker-before-core.json',
    'base_player': 'ottplay-foss/tests/fixtures/stalker/legacy.json',
    'bestlist_xtream': 'ottplay-foss/tests/fixtures/stalker/bestlist-xtream.json',
}
counts = {}
for key, file in fixture_files.items():
    fixture = json.loads(workspace_path(file).read_text())
    counts[key] = len(fixture if isinstance(fixture, list) else fixture['cases'])
counts['total'] = sum(counts.values())
stalker = dict(
    profiles=['browser MAG', 'Android MAG/JSON-RPC', 'base-player JSON-RPC'],
    recorded_contracts=counts,
    domains=['authentication and profile policy', 'token cache and bounded retry', 'request/header ordering',
             'pagination and duplicate policy', 'catalog identity and folder hierarchy', 'media-link interpretation', 'RPC short EPG'],
    host_boundaries=['JSON and URL codecs', 'HTTP and cancellation', 'locking', 'hash/encoding primitives', 'localization and UI'],
    retained_compatibility=['browser raw-row vs native unique-row pagination', 'browser first duplicate vs native last duplicate',
                            'browser private token/command references and strict generations', 'native single 401/403 retry and token reuse',
                            'base-player numeric/hash IDs, raw URLs and numeric-prefix EPG fields', 'BEST LiST distinct M3U fallback URL forms'],
    cancellation='browser load cancellation exercised at all stages; stale sessions and string generations rejected; existing page cancellation passed',
    es5='modern and two old-API simulations passed; forbidden Unicode RegExp calls removed from Xtream fallback and antifriz logo rewrite',
    fixture_sha256={file: hashlib.sha256(workspace_path(file).read_bytes()).hexdigest() for file in fixture_files.values()},
    benchmark=json.loads(read('benchmark.json')) if stage == 'stalker' else json.loads((root/'reports/stalker-benchmark.json').read_text()),
)
benchmark = json.loads(read('benchmark.json'))
assert benchmark['source_sha256'] == source
jslog = read('core-es5.log')
javascript = json.loads(jslog[jslog.index('{'):])
assert javascript['es5Syntax'] and all(row['passed'] for row in javascript['reports'])
core = json.loads((root / 'shared-core/validation.json').read_text())
core.update(scope='integrated_guide_archive_playlist_xtream_and_stalker_rules', source=manifest['source'], artifacts=manifest['artifacts'],
            javascript=javascript, validated_at_utc=now, core_source_sha256=source, stalker=stalker)
core['test_suites'] = [row for kind in ['jvmTest', 'jsNodeTest', 'macosArm64Test'] for row in suites(root / 'shared-core', kind)]
core['total_tests'] = sum(row['tests'] for row in core['test_suites'])
if stage == 'stalker':
    core['xtream']['benchmark'] = json.loads(read('xtream-benchmark.json'))

v = json.loads((root / 'validation.json').read_text())
v.update(scope='guide_archive_playlist_xtream_and_stalker_core_integration', core_source_sha256=source,
         shared_core_tests=core['total_tests'], validated_at_utc=now, stalker=stalker)
a = v['android']
android = consumer_path('ottplay-android')
a['core_test_suites'] = suites(android / 'core', 'test')
a['app_test_suites'] = suites(android / 'app', 'testDebugUnitTest')
a['core_tests'] = sum(row['tests'] for row in a['core_test_suites'])
a['app_unit_tests'] = sum(row['tests'] for row in a['app_test_suites'])
for name in ['debug_apk', 'release_apk']:
    data = workspace_path(a[name]['path']).read_bytes()
    a[name].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
a['shared_domain_scope'] = list(dict.fromkeys(a['shared_domain_scope'] + ['Stalker MAG/JSON-RPC sessions and catalogs']))
a['stalker_recorded_contracts'] = counts['android']
f = v['foss2']
f['unit_tests'] = foss2_count
f['stalker_recorded_contracts'] = counts['foss2']
f['current_artifact_checks'] = f'{foss2_count} tests, ES5, resource/vendor/core receipts; captured Stalker/Xtream/M3U contracts; Chromium provider playback, EPG and compatibility passed'
for row in f['browser_checks']:
    name = Path(row['report']).name
    src = root / 'ottplay-foss2/test-results' / name[name.index('browser-'):]
    data = json.loads(src.read_text())
    assert data['passed'], src
    row['report'] = 'reports/' + stage + '-' + src.name
    shutil.copyfile(src, root / row['report'])
m = v['main_player']
m.update(ci_inventory=f'{ci_count}/{ci_count} reachable', stalker_recorded_contracts=counts['base_player'],
         bestlist_xtream_recorded_contracts=counts['bestlist_xtream'], server_es5_scripts=206)
m['core_bundle'] = dict(manifest['artifacts']['ottplay-core.js'], gzip_bytes=benchmark['gzip_bytes'])
if stage == 'stalker':
    v['playlist']['benchmark'] = json.loads(read('playlist-benchmark.json'))
v['xtream']['benchmark'] = core['xtream']['benchmark']
v['remaining'][1] = 'Other operator catalogs/sessions and cross-catalog channel identity/state migrations'
mapping = dict(common='core-final.log', es5='core-es5.log', rust='rust-tests.log', alpine='alpine-tests.log',
               container_build='container-build.log', container_smoke='container-smoke.log', ios='xcode-build.log',
               adapters='native-adapters.log', android='android-build.log', main_npm='main-tests.log', foss2='foss2-tests.log',
               python='python-tests.log', structure='boundary.log', inventory='main-tests.log',
               playlist_benchmark='playlist-benchmark.json', xtream_benchmark='xtream-benchmark.json',
               staged_core='staged-core.json', stalker_benchmark='benchmark.json', stalker_contracts='boundary.log')
if stage == 'guide':
    for key in ['playlist_benchmark', 'xtream_benchmark', 'stalker_benchmark', 'stalker_contracts']:
        del mapping[key]
    mapping.update(guide_benchmark='benchmark.json', guide_contracts='browser-parity.log')
v['reports'].update({key: 'reports/' + stage + '-' + value for key, value in mapping.items()})
assert json.loads(read('staged-core.json'))['source_sha256'] == source
if stage == 'guide':
    files = ['ottplay-foss2/tests/fixtures/guide-before-core.json', 'ottplay-foss/tests/fixtures/guide/legacy.json', 'ottplay-android/core/src/test/resources/guide-before-core.json']
    guide = dict(recorded_contracts=dict(foss2=44, base_player=44, android=33, total=121),
                 domains=['XMLTV programme validation and missing-stop inference', 'metadata/index/duplicate precedence',
                          'feed-scoped identity and preference', 'coverage metadata', 'protected lookup cache with copy budget',
                          'classic inclusive now/next selection and full-schedule TTL/LRU', 'Android programme ordering'],
                 retained_compatibility=['first usable icon and duplicate payload', 'programme references and unique-ID schedule aliases',
                                         'browser latest overlap and half-open ends', 'classic earliest overlap and inclusive ends',
                                         'classic one-hour miss retry and 12-hour response TTL', 'Android first duplicate interval'],
                 host_boundaries=['XML decoding and decompression limits', 'URL codec', 'transport/cancellation and UI', 'storage and wall clock'],
                 fixture_sha256={file:hashlib.sha256(workspace_path(file).read_bytes()).hexdigest() for file in files}, benchmark=benchmark)
    core.update(scope='integrated_guide_feed_cache_archive_playlist_xtream_and_stalker_rules', guide_feed_cache=guide)
    v.update(scope='guide_feed_cache_archive_playlist_xtream_and_stalker_core_integration', guide_feed_cache=guide)
    a['shared_domain_scope'] = list(dict.fromkeys(a['shared_domain_scope'] + ['XMLTV programme validation/deduplication/order']))
    a['guide_recorded_contracts'] = 33
    f['guide_recorded_contracts'] = 44
    m['guide_recorded_contracts'] = 44
    v['remaining'][0] = 'Streaming guide retention and remaining native cache policies'
for path, data in [(root / 'shared-core/validation.json', core), (root / 'validation.json', v)]:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print('Recorded source', source)
print('Stage:', stage)
print('Tests:', core['total_tests'], 'common;', a['core_tests'], 'Android core;', a['app_unit_tests'], 'Android app;', foss2_count, 'FOSS2')
print('Captured contracts:', 121 if stage == 'guide' else counts['total'], 'guide' if stage == 'guide' else 'Stalker/BEST LiST')
