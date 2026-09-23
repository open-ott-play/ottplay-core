"""Compare packaged browser, Capacitor and built iOS resources to the core receipt."""
import hashlib
import json

from consumer_paths import SOURCE_ROOT, consumer_path

root = SOURCE_ROOT
main = consumer_path('ottplay-foss')
manifest = json.loads((root / 'shared-core/dist/ottplay-core.manifest.json').read_text())
resources = []
for relative in [
    'dist/js/ottplay-core.js',
    'dist-mobile/js/ottplay-core.js',
    'ios/App/App/public/js/ottplay-core.js',
    'build/ios-migration/Build/Products/Debug-iphonesimulator/App.app/ottplay-core.js',
    'build/ios-migration/Build/Products/Debug-iphonesimulator/App.app/public/js/ottplay-core.js',
]:
    data = (main / relative).read_bytes()
    actual = dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
    assert actual == manifest['artifacts']['ottplay-core.js'], relative
    resources.append(dict(path=relative, **actual))
print(json.dumps(dict(source_sha256=manifest['source']['sha256'], resources=resources), indent=2))
