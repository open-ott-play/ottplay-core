"""Check the locally built Alpine image without retaining a running container."""
import hashlib
import json
import subprocess
import time
import urllib.request

from consumer_paths import consumer_path

main = consumer_path("ottplay-foss")
container = subprocess.check_output([
    "docker", "run", "--rm", "-d", "--platform", "linux/arm64",
    "-p", "127.0.0.1::8080", "ottplay-unification-container-check",
], text=True).strip()
try:
    state = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
    base = "http://127.0.0.1:" + state["NetworkSettings"]["Ports"]["8080/tcp"][0]["HostPort"]
    for attempt in range(40):
        try:
            health = urllib.request.urlopen(base + "/health", timeout=2).read()
            break
        except OSError:
            if attempt == 39:
                raise
            time.sleep(0.2)
    assert health == b"OK", health
    html = urllib.request.urlopen(base + "/", timeout=5).read().decode()
    assert "parseProviderPlaylist" in html and "parseOperatorPlaylist" in html
    receipt = json.loads((main / "vendor/ottplay-core.manifest.json").read_text())
    for name in ["ottplay-core.js", "ottplay-core.manifest.json", "ottplay-core.LICENSE.txt"]:
        body = urllib.request.urlopen(base + "/js/" + name, timeout=5).read()
        assert body == (main / "vendor" / name).read_bytes(), name
        print(hashlib.sha256(body).hexdigest(), name)
    print("PASS container health, ES5 bootstrap and HTTP-served assets match source", receipt["source"]["sha256"])
finally:
    subprocess.run(["docker", "stop", container], check=True, stdout=subprocess.DEVNULL)
