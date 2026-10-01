"""Validate bundle metadata and compare packaged iPhone/iPad icons with release assets.

sips decodes Apple's optimized PNGs on the macOS runner. Comparing BMP pixel
data avoids differences in PNG compression/metadata introduced by actool.
"""
import argparse
import plistlib
import re
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path


def decode_image(path):
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / 'icon.bmp'
        subprocess.run(['sips', '-s', 'format', 'bmp', str(path), '--out', str(output)],
                       check=True, capture_output=True)
        data = output.read_bytes()
    if data[:2] != b'BM':
        raise RuntimeError('sips did not produce a BMP image')
    offset = struct.unpack_from('<I', data, 10)[0]
    width, height = struct.unpack_from('<ii', data, 18)
    bits = struct.unpack_from('<H', data, 28)[0]
    if width <= 0 or height == 0 or bits not in (24, 32):
        raise RuntimeError('Unsupported decoded icon format')
    stride = ((width * bits + 31) // 32) * 4
    if len(data) < offset + stride * abs(height):
        raise RuntimeError('Truncated decoded icon')
    rows = [data[offset + y * stride:offset + (y + 1) * stride] for y in range(abs(height))]
    if height > 0:
        rows.reverse()
    # RGB only: iOS icons are opaque and BMP's fourth byte may be reserved.
    pixels = b''.join(row[x:x + 3] for row in rows for x in range(0, width * (bits // 8), bits // 8))
    return width, abs(height), pixels


def validate_ipa(ipa, icons, decode=decode_image, preview=None):
    prefix = 'Payload/Readest.app/'
    with zipfile.ZipFile(ipa) as archive, tempfile.TemporaryDirectory() as folder:
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f'Corrupt IPA entry: {corrupt}')
        plist = plistlib.loads(archive.read(prefix + 'Info.plist'))
        for key in ('CFBundleExecutable', 'CFBundleIdentifier', 'CFBundleInfoDictionaryVersion', 'CFBundleVersion'):
            if not plist.get(key) or '$(' in str(plist[key]):
                raise RuntimeError(f'Missing or unresolved {key} in app Info.plist')
        if plist.get('CFBundlePackageType') != 'APPL':
            raise RuntimeError('App bundle must have CFBundlePackageType=APPL')
        if prefix + plist['CFBundleExecutable'] not in archive.namelist():
            raise RuntimeError('Missing app executable')
        primary = plist.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
        if primary.get('CFBundleIconName') != 'AppIcon' or not primary.get('CFBundleIconFiles'):
            raise RuntimeError('Missing primary app icon declaration')
        checked = 0
        iphone_checked = False
        icon_pattern = re.compile(r'AppIcon(\d+(?:\.\d+)?)x\1(?:@([123])x)?(~ipad)?\.png')
        for name in archive.namelist():
            if not name.startswith(prefix):
                continue
            compiled = name[len(prefix):]
            match = icon_pattern.fullmatch(compiled)
            if not match:
                continue
            size, scale, ipad = match.groups()
            scale = scale or '1'
            expected = Path(icons) / f'AppIcon-{size}x{size}@{scale}x.png'
            actual = Path(folder) / compiled
            actual.write_bytes(archive.read(name))
            if not expected.is_file() or decode(actual) != decode(expected):
                raise RuntimeError(f'Packaged app icon does not match the production icon: {compiled}')
            checked += 1
            if size == '60' and not ipad:
                iphone_checked = True
                if preview is not None:
                    subprocess.run(['sips', '-s', 'format', 'png', str(actual), '--out', str(preview)],
                                   check=True, capture_output=True)
        if not iphone_checked:
            raise RuntimeError('Missing packaged iPhone app icon')
        print(f'Validated IPA bundle and {checked} production app icon(s), including iPad icons when present.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa', type=Path)
    parser.add_argument('icons', type=Path)
    parser.add_argument('--icon-preview', type=Path)
    args = parser.parse_args()
    validate_ipa(args.ipa, args.icons, preview=args.icon_preview)
