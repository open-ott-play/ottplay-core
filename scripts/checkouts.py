"""Materialize the exact consumer revisions recorded in checkouts.json."""
import argparse
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
pins = json.loads((root / 'checkouts.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--only', choices=list(pins), action='append')
args = parser.parse_args()
for name in args.only or pins:
    pin = pins[name]
    target = root / name
    if target.exists():
        head = subprocess.check_output(['git', '-C', str(target), 'rev-parse', 'HEAD'], text=True).strip()
        if head != pin['revision']:
            raise SystemExit(f'{name}: existing checkout differs from pin; reconcile it explicitly')
    else:
        subprocess.run(['git', 'clone', '--no-checkout', pin['url'], str(target)], check=True)
        subprocess.run(['git', '-C', str(target), 'checkout', '--detach', pin['revision']], check=True)
    print(f'{name}: {pin["revision"]}')
