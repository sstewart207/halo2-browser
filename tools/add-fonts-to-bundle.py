"""Add maps/fonts/ to the Halo 2 boot bundle.

The guest's load_font_table (halo2.exe 0x431dff) reads maps/fonts/font_table and
then opens up to 12 named font files as tags. Without those entries the font
table is empty, no glyph data is ever uploaded, and every character cell draws
as a solid box.

Run from the repository root:
    python tools/add-fonts-to-bundle.py [bundle.wgb]

Idempotent: entries already present in the bundle are skipped. The previous
bundle file is left untouched, so keep your own copy if you need to roll back.
"""

import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

DEFAULT_BUNDLE = "work/halo2-browser/bundles/halo2-2gb.wgb"
FONTS_DIR = Path("C:/Games/Halo 2 Project Cartographer/maps/fonts")


def main() -> None:
    bundle_path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BUNDLE)
    fonts_dir = FONTS_DIR

    assert bundle_path.exists(), f"Missing bundle: {bundle_path}"
    assert fonts_dir.exists(), f"Missing installed fonts: {fonts_dir}"

    with ZipFile(bundle_path, "a", compression=ZIP_STORED, allowZip64=True) as z:
        existing = {info.filename.lower() for info in z.infolist()}
        added = 0
        for font_file in sorted(fonts_dir.iterdir()):
            if not font_file.is_file():
                continue
            entry_name = f"rom/maps/fonts/{font_file.name}"
            if entry_name.lower() in existing:
                print(f"Skipping already existing: {entry_name}")
                continue
            print(f"Adding: {entry_name} ({font_file.stat().st_size} bytes)")
            z.write(font_file, entry_name)
            added += 1

    print(f"Added {added} font files to {bundle_path}. "
          f"New size: {bundle_path.stat().st_size} bytes")


if __name__ == "__main__":
    main()