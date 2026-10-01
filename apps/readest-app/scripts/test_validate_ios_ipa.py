import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('validator', Path(__file__).with_name('validate-ios-ipa.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class IconComparison(unittest.TestCase):
    def image(self, changes=(), width=152, height=152):
        pixels = bytearray([128]) * (width * height * 3)
        for index, delta in changes:
            pixels[index] += delta
        return width, height, bytes(pixels)

    def test_identical_pixels_pass(self):
        self.assertTrue(validator.icons_match(self.image(), self.image()))

    def test_observed_ipad_rounding_passes(self):
        self.assertTrue(validator.icons_match(self.image(((100, 1), (200, -1))), self.image()))

    def test_two_level_difference_fails(self):
        self.assertFalse(validator.icons_match(self.image(((100, 2),)), self.image()))

    def test_widespread_one_level_changes_fail(self):
        self.assertFalse(validator.icons_match(self.image(tuple((i, 1) for i in range(70))), self.image()))

    def test_dimension_change_fails(self):
        self.assertFalse(validator.icons_match(self.image(width=153), self.image()))

    def test_truncated_pixels_fail(self):
        width, height, pixels = self.image()
        self.assertFalse(validator.icons_match((width, height, pixels[:-1]), self.image()))


class ValidateIPA(unittest.TestCase):
    def test_release_icon_and_valid_bundle_pass(self):
        self.check(b'production')

    def test_development_icon_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'production icon'):
            self.check(b'development')

    def test_missing_bundle_identity_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'CFBundleIdentifier'):
            self.check(b'production', missing='CFBundleIdentifier')

    def test_missing_icon_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'app icon'):
            self.check(None)

    def check(self, icon, missing=None):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            icons = root / 'icons'
            icons.mkdir()
            (icons / 'AppIcon-60x60@2x.png').write_bytes(b'production')
            (icons / 'AppIcon-60x60@3x.png').write_bytes(b'production')
            plist = dict(CFBundleExecutable='readest', CFBundleIdentifier='com.bilingify.readest',
                         CFBundleInfoDictionaryVersion='6.0', CFBundleVersion='0.12.10',
                         CFBundlePackageType='APPL', CFBundleIcons={'CFBundlePrimaryIcon': {
                             'CFBundleIconName': 'AppIcon', 'CFBundleIconFiles': ['AppIcon60x60']}})
            if missing:
                del plist[missing]
            ipa = root / 'Readest.ipa'
            with zipfile.ZipFile(ipa, 'w') as archive:
                archive.writestr('Payload/Readest.app/Info.plist', plistlib.dumps(plist))
                archive.writestr('Payload/Readest.app/readest', b'executable')
                if icon is not None:
                    archive.writestr('Payload/Readest.app/AppIcon60x60@2x.png', icon)
            validator.validate_ipa(ipa, icons, decode=lambda path: path.read_bytes())


if __name__ == '__main__':
    unittest.main()
