#!/usr/bin/env python3
"""Generate a proper macOS .icns file containing multiple PNG sizes.
Reference: Apple Icon Composer format - https://en.wikipedia.org/wiki/Apple_Icon_Image_format
"""
import struct, os, sys
from PIL import Image

ICON_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_PNG = os.path.join(ICON_DIR, 'icon.png')
OUTPUT_ICNS = os.path.join(ICON_DIR, 'icon.icns')

# Standard macOS icon sizes
SIZES = [
    ('icp4', 16),    # 16x16
    ('icp5', 32),    # 16x16@2x
    ('ic07', 128),   # 128x128
    ('ic08', 256),   # 128x128@2x
    ('ic09', 512),   # 512x512
    ('ic10', 1024),  # 512x512@2x (Retina)
    ('ic11', 32),    # 32x32
    ('ic12', 64),    # 32x32@2x
    ('ic13', 128),   # 128x128
    ('ic14', 256),   # 128x128@2x
]

def make_icns():
    if not os.path.exists(SOURCE_PNG):
        print(f'Source PNG not found: {SOURCE_PNG}', file=sys.stderr)
        sys.exit(1)

    # Deduplicate by size, keep first occurrence
    sizes_seen = set()
    final_sizes = []
    for code, size in SIZES:
        if size not in sizes_seen:
            sizes_seen.add(size)
            final_sizes.append((code, size))

    img = Image.open(SOURCE_PNG)

    icns_blocks = b''
    for code, size in final_sizes:
        resized = img.resize((size, size), Image.LANCZOS)
        # Save to PNG bytes
        from io import BytesIO
        buf = BytesIO()
        resized.save(buf, format='PNG')
        png_bytes = buf.getvalue()
        # icns block format: 4-byte type + 4-byte length (big-endian, includes type+length+data) + data
        block_len = 8 + len(png_bytes)
        icns_blocks += struct.pack('>4sI', code.encode('ascii'), block_len) + png_bytes

    # Total ICNS file: 'icns' magic + 4-byte total size + blocks
    total_size = 8 + len(icns_blocks)
    icns = b'icns' + struct.pack('>I', total_size) + icns_blocks

    with open(OUTPUT_ICNS, 'wb') as f:
        f.write(icns)
    print(f'Wrote {OUTPUT_ICNS}: {len(icns)} bytes with {len(final_sizes)} sizes')

if __name__ == '__main__':
    make_icns()