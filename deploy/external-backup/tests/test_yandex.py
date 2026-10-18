import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('yandex', pathlib.Path(__file__).parents[1] / 'yandex.py')
y = importlib.util.module_from_spec(spec)
spec.loader.exec_module(y)


class ExternalTests(unittest.TestCase):
    def fixture(self, root):
        backup = root / 'backups' / '20261018T100000Z-abcdef12'
        backup.mkdir(parents=True)
        for name in y.FILES:
            (backup / name).write_bytes(('private-' + name).encode())
        row = dict(id=backup.name, complete=True, verified=True,
                   sha256={n: hashlib.sha256((backup / n).read_bytes()).hexdigest() for n in y.FILES})
        (backup / 'metadata.json').write_text(json.dumps(row))
        state = root / 'state'
        state.mkdir()
        return backup, state

    def test_refuses_incomplete_tampered_or_symlinked_backups(self):
        with tempfile.TemporaryDirectory() as temporary:
            backup, _ = self.fixture(pathlib.Path(temporary))
            self.assertEqual(y.inspect(backup)['id'], backup.name)
            original = (backup / 'metadata.json').read_text()
            row = json.loads(original)
            row['verified'] = False
            (backup / 'metadata.json').write_text(json.dumps(row))
            with self.assertRaises(y.Failure):
                y.inspect(backup)
            (backup / 'metadata.json').write_text(original)
            (backup / 'environment').write_text('corrupted')
            with self.assertRaises(y.Failure):
                y.inspect(backup)
            (backup / 'environment').unlink()
            (backup / 'environment').symlink_to(backup / 'database.dump')
            with self.assertRaises(y.Failure):
                y.inspect(backup)

    def test_receipt_only_after_download_verification_and_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            backup, state = self.fixture(pathlib.Path(temporary))
            calls, markers = [], {}
            def transfer(*args):
                calls.append(args)
                if args[0] == 'copyto':
                    markers[args[2]] = pathlib.Path(args[1]).read_bytes()
                return markers[args[1]] if args[0] == 'cat' else b''
            with patch.object(y, 'STATE', state), patch.object(y, 'BACKUPS', backup.parent), patch.object(y, 'validate_config'), patch.object(y, 'rclone', side_effect=transfer):
                y.sync()
                self.assertEqual([c[0] for c in calls], ['copy', 'check', 'copyto', 'cat'])
                self.assertIn('--download', calls[1])
                self.assertTrue(all(c[2].startswith('nova-crypt:') for c in calls if c[0] in ('copy', 'check', 'copyto')))
                receipt = json.loads((state / 'receipts' / (backup.name + '.json')).read_text())
                self.assertTrue(receipt['verified_download'])
                calls.clear()
                y.sync()
                self.assertFalse(calls)

    def test_failed_verification_keeps_local_copy_and_retries(self):
        with tempfile.TemporaryDirectory() as temporary:
            backup, state = self.fixture(pathlib.Path(temporary))
            def transfer(*args):
                if args[0] == 'check':
                    raise y.Failure('test transport failure')
                return b''
            with patch.object(y, 'STATE', state), patch.object(y, 'BACKUPS', backup.parent), patch.object(y, 'validate_config'), patch.object(y, 'rclone', side_effect=transfer):
                with self.assertRaises(y.Failure):
                    y.sync()
            self.assertTrue(backup.exists())
            self.assertFalse(list((state / 'receipts').iterdir()))
            status = (state / 'status.json').read_text()
            self.assertNotIn('private-', status)
            self.assertTrue(json.loads(status)['error'])


if __name__ == '__main__':
    unittest.main()
