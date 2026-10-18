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
    def test_native_oauth_migration_preserves_crypt_secret_and_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            state = root / 'state'
            state.mkdir()
            config = root / 'legacy.conf'
            config.write_text('[yandex]\ntype = webdav\nurl = https://webdav.yandex.ru\nvendor = other\nuser = dummy\npass = fake-obscured\n[nova-crypt]\ntype = crypt\nremote = yandex:' + y.FOLDER + '\nfilename_encryption = standard\ndirectory_name_encryption = true\npassword = unchanged-crypt-secret\n')
            with patch.object(y, 'CONFIG', config), patch.object(y, 'STATE', state), patch.object(y, 'private'), patch.object(y.getpass, 'getpass', return_value='{"access_token":"disposable-token","token_type":"bearer"}'), patch.object(y, 'probe') as probe, patch.object(y, 'enable') as enable:
                y.setup_api()
                y.validate_config()
                text = y.CONFIG.read_text()
                self.assertIn('password = unchanged-crypt-secret', text)
                self.assertIn('remote = yandex:' + y.FOLDER, text)
                self.assertIn('type = yandex', text)
                self.assertNotIn('fake-obscured', text)
                self.assertEqual(y.CONFIG.stat().st_mode & 0o777, 0o600)
                probe.assert_called_once()
                enable.assert_called_once()
                self.assertTrue(config.exists())

    def test_token_rejects_wrong_types_or_unexpected_fields(self):
        for scheme in ['bearer', 'Bearer', 'OAuth', 'oauth']:
            value = json.dumps({'access_token': 'disposable-token', 'token_type': scheme,
                                'refresh_token': 'disposable-refresh', 'expiry': '2027-01-01T00:00:00Z'})
            self.assertEqual(y.validate_token(value)['token_type'], scheme)
        for value in ['[]', '{}', '{"access_token":1,"token_type":"bearer"}', '{"access_token":"dummy","token_type":"basic"}', '{"access_token":"dummy","token_type":"bearer","command":"anything"}']:
            with self.assertRaises(y.Failure):
                y.validate_token(value)

    def test_transport_waits_for_yandex_to_accept_the_upload(self):
        with patch.object(y, 'run', return_value=b'') as run:
            y.rclone('copy', '/private/staging', 'nova-crypt:backup')
        args = run.call_args.args[0]
        self.assertEqual(args[args.index('--header-upload') + 1], 'Expect: 100-continue')
        self.assertEqual(args[args.index('--expect-continue-timeout') + 1], '5m')
        self.assertEqual(args[args.index('--timeout') + 1], '6m')
        self.assertNotIn('--no-check-certificate', args)

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
