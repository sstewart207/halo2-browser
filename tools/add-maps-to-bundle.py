"""Add campaign map(s) from local installation to the Halo 2 boot bundle.

Usage:
    python tools/add-maps-to-bundle.py [--all | map_name.map ...] [bundle.wgb]

Examples:
    # Add Cairo Station (01b_spacestation.map):
    python tools/add-maps-to-bundle.py 01b_spacestation.map

    # Add The Heretic and Cairo Station:
    python tools/add-maps-to-bundle.py 00a_introduction.map 01b_spacestation.map

    # Add all 15 campaign maps:
    python tools/add-maps-to-bundle.py --all

Idempotent: entries already present in the bundle are skipped.
"""

import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

DEFAULT_BUNDLE = Path("work/halo2-browser/bundles/halo2-2gb.wgb")
MAPS_DIR = Path("C:/Games/Halo 2 Project Cartographer/maps")

CAMPAIGN_MAPS = [
    "00a_introduction.map",    # The Heretic (97.7 MB)
    "01a_tutorial.map",        # Armory (60.0 MB)
    "01b_spacestation.map",    # Cairo Station (219.7 MB)
    "03a_oldmombasa.map",      # Outskirts (188.6 MB)
    "03b_newmombasa.map",      # Metropolis (204.3 MB)
    "04a_gasgiant.map",        # The Arbiter (184.2 MB)
    "04b_floodlab.map",        # The Oracle (196.7 MB)
    "05a_deltaapproach.map",   # Delta Halo (185.5 MB)
    "05b_deltatowers.map",     # Regret (194.6 MB)
    "06a_sentinelwalls.map",   # Sacred Icon (210.0 MB)
    "06b_floodzone.map",       # Quarantine Zone (214.1 MB)
    "07a_highcharity.map",     # Gravemind (277.9 MB)
    "07b_forerunnership.map",  # High Charity (173.3 MB)
    "08a_deltacliffs.map",     # Uprising (146.0 MB)
    "08b_deltacontrol.map",    # The Great Journey (246.0 MB)
]


def main() -> None:
    args = sys.argv[1:]
    bundle_path = DEFAULT_BUNDLE

    # Detect bundle path if passed as last arg ending with .wgb
    if args and args[-1].endswith(".wgb"):
        bundle_path = Path(args.pop())

    assert bundle_path.exists(), f"Missing bundle: {bundle_path}"
    assert MAPS_DIR.exists(), f"Missing installed maps: {MAPS_DIR}"

    if "--all" in args or not args:
        targets = [m for m in CAMPAIGN_MAPS if m != "01a_tutorial.map"]
    else:
        targets = [a for a in args if not a.startswith("--")]

    with ZipFile(bundle_path, "a", compression=ZIP_STORED, allowZip64=True) as z:
        existing = {info.filename.lower() for info in z.infolist()}
        added = 0
        for map_name in targets:
            src = MAPS_DIR / map_name
            if not src.is_file():
                print(f"Warning: map file not found: {src}")
                continue
            entry_name = f"rom/maps/{map_name}"
            if entry_name.lower() in existing:
                print(f"Skipping already existing: {entry_name}")
                continue
            size_mb = src.stat().st_size / (1024 * 1024)
            print(f"Adding: {entry_name} ({size_mb:.1f} MB)...")
            z.write(src, entry_name)
            added += 1

    print(f"Added {added} map files to {bundle_path}. "
          f"New size: {bundle_path.stat().st_size / (1024 * 1024):.1f} MB")


if __name__ == "__main__":
    main()
