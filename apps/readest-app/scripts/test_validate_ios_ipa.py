import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('validator', Path(__file__).with_name('validate-ios-ipa.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


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
