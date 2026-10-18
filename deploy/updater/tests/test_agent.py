import copy
import importlib.util
import io
import json
import os
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', pathlib.Path(__file__).parents[1] / 'agent.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def app_files(root, release, bad=False):
    (root / 'config').mkdir(parents=True)
    (root / 'config/release.json').write_text(json.dumps({'version': release}))
    (root / 'marker').write_text('FAIL' if bad else release)
    for name in ('storefront', 'admin'):
        folder = root / 'apps' / name / 'dist'
        (folder / 'assets').mkdir(parents=True)
        (folder / 'assets/main.js').write_text(release)
        (folder / 'index.html').write_text(release)
    (root / 'node_modules/.bin').mkdir(parents=True)
    (root / 'node_modules/.bin/link').symlink_to('../../marker')


class Fixture(a.Manager):
    def __init__(self, root):
        root = pathlib.Path(root)
        self.database = {'nova_test': 'orders-and-owner-content'}
        self.bad_release = False
        self.fail_backup_verify = False
        self.events = []
        config = json.loads((pathlib.Path(__file__).parents[1] / 'config.example.json').read_text())
        for key, suffix in [('app_dir', 'app'), ('web_dir', 'web'), ('uploads_dir', 'uploads'), ('state_dir', 'state'), ('backup_dir', 'backups'), ('staging_dir', 'staging')]:
            config[key] = str(root / suffix)
            (root / suffix).mkdir()
        config['env_file'] = str(root / 'environment')
        config['revision_file'] = str(root / 'revision')
        pathlib.Path(config['env_file']).write_text('PRIVATE-KEY-DO-NOT-EXPOSE')
        pathlib.Path(config['env_file']).chmod(0o600)
        app_files(root / 'app', '0.20.0')
        (root / 'uploads/photo.png').write_bytes(b'owner-image')
        for name in ('index.html', 'admin/index.html', 'assets/main.js'):
            path = root / 'web' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('0.20.0')
        super().__init__(config)

    def run(self, args, **kwargs):
        self.events.append(args)
        return 'v24.21.0' if kwargs.get('capture') else None

    def db_command(self, command, *args, incoming=None, output=None, capture=False):
        self.events.append([command, *args])
        if command == 'pg_dump':
            output.write(self.database[args[1]].encode())
        if command == 'createdb':
            self.database[args[-1]] = ''
        if command == 'dropdb':
            self.database.pop(args[-1], None)
        if command == 'pg_restore':
            if self.fail_backup_verify and args[1].startswith('nova_verify_'):
                raise a.Failure('test verify failure')
            self.database[args[1]] = incoming.read().decode()
        if command == 'psql':
            return '10'

    def resume(self):
        self.events.append('health')
        if (self.app / 'marker').read_text() == 'FAIL':
            raise a.Failure('test startup failure')

    def chown_runtime(self, path):
        pass

    def prepare_release(self, requested, folder):
        root = folder / 'app'
        root.mkdir()
        app_files(root, requested, self.bad_release)
        return root

    def install_release(self, app):
        self.database['nova_test'] = 'new-schema-and-data'
        super().install_release(app)

    def execute(self, body):
        self.state['active'] = {'id': 'test-job', 'kind': body['kind'], 'phase': 'queued', 'status': 'running', 'recovery_snapshot': None}
        self.perform(body)
        return self.state['jobs'][-1]


class AgentTests(unittest.TestCase):
    def test_only_fixed_operations_and_literal_versions_are_accepted(self):
        for body in ({'kind': 'backup'}, {'kind': 'check'}, {'kind': 'update', 'version': '0.21.0'}, {'kind': 'schedule', 'enabled': True, 'hour_utc': 3, 'retention_days': 7}):
            self.assertTrue(a.command_valid(body))
        for body in (None, [], {'kind': 'shell', 'command': 'id'}, {'kind': 'update', 'version': '../main'}, {'kind': 'update', 'version': '0.21.0', 'url': 'http://localhost'}, {'kind': 'backup', 'path': '/etc'}, {'kind': 'verify', 'backup_id': '../../etc'}, {'kind': 'restore', 'backup_id': '20261018T100000Z-abcdef12'}, {'kind': 'schedule', 'enabled': True, 'hour_utc': True, 'retention_days': 7}):
            self.assertFalse(a.command_valid(body), body)

    def test_release_manifest_refuses_unsupported_protocols_and_paths(self):
        base = {'format': 'nova-release', 'version': '0.21.0', 'theme_api': 1, 'schema': 1, 'manager_protocol': 1, 'min_node': '22.12.0', 'from_min': '0.20.0', 'artifact': {'name': 'nova-0.21.0.tar.gz', 'size': 1000, 'sha256': 'a' * 64}}
        self.assertEqual(a.validate_manifest(base, '0.21.0'), base)
        for key, value in [('theme_api', 2), ('schema', True), ('manager_protocol', 2), ('from_min', 'main')]:
            changed = copy.deepcopy(base)
            changed[key] = value
            with self.assertRaises(a.Failure):
                a.validate_manifest(changed, '0.21.0')
        for key, value in [('name', '../out'), ('size', 10 ** 9), ('sha256', 'wrong')]:
            changed = copy.deepcopy(base)
            changed['artifact'][key] = value
            with self.assertRaises(a.Failure):
                a.validate_manifest(changed, '0.21.0')

    def test_archives_cannot_escape_with_paths_devices_or_link_chains(self):
        for members in ([('../escape', None)], [('/tmp/escape', None)], [('link', '/etc/passwd')], [('dir/link', '../'), ('outer', 'dir/link/../escape')], [('link', 'inside'), ('link/file', None)]):
            with tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                archive = root / 'a.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    for name, link in members:
                        member = tarfile.TarInfo(name)
                        if link:
                            member.type = tarfile.SYMTYPE
                            member.linkname = link
                        else:
                            member.size = 1
                        tar.addfile(member, None if link else io.BytesIO(b'x'))
                (root / 'target').mkdir()
                with self.assertRaises((a.Failure, FileExistsError)):
                    a.safe_extract(archive, root / 'target', allow_links=True)
                self.assertFalse((root / 'escape').exists())

    def test_backup_is_complete_private_verified_and_does_not_expose_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = Fixture(directory)
            job = manager.execute({'kind': 'backup'})
            self.assertEqual(job['status'], 'succeeded', job)
            row = manager.list_backups()[0]
            self.assertTrue(row['verified'])
            path, metadata = manager.inspect_backup(row['id'])
            self.assertEqual((path / 'environment').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('PRIVATE-KEY', json.dumps(manager.status()))
            self.assertFalse((manager.web / '.nova-maintenance').exists())
            (path / 'database.dump').write_bytes(b'corrupt')
            with self.assertRaises(a.Failure):
                manager.inspect_backup(row['id'])

    def test_failed_backup_verification_resumes_old_site_without_destructive_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = Fixture(directory)
            manager.fail_backup_verify = True
            job = manager.execute({'kind': 'backup'})
            self.assertEqual(job['status'], 'failed')
            self.assertEqual(manager.database['nova_test'], 'orders-and-owner-content')
            self.assertFalse((manager.web / '.nova-maintenance').exists())
            self.assertFalse(any(event[:2] == ['dropdb', '--if-exists'] and event[-1] == 'nova_test' for event in manager.events if isinstance(event, list)))

    def test_update_and_failed_startup_roll_back_database_code_uploads_and_environment(self):
        for bad in (False, True):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as directory:
                manager = Fixture(directory)
                manager.bad_release = bad
                job = manager.execute({'kind': 'update', 'version': '0.21.0'})
                self.assertEqual(job['status'], 'failed' if bad else 'succeeded', job)
                self.assertEqual(manager.current_version(), '0.20.0' if bad else '0.21.0')
                self.assertEqual(manager.database['nova_test'], 'orders-and-owner-content' if bad else 'new-schema-and-data')
                self.assertEqual((manager.uploads / 'photo.png').read_bytes(), b'owner-image')
                self.assertEqual(manager.environment.read_text(), 'PRIVATE-KEY-DO-NOT-EXPOSE')
                self.assertEqual((manager.web / 'index.html').read_text(), '0.20.0' if bad else '0.21.0')
                self.assertFalse((manager.web / '.nova-maintenance').exists())
                self.assertTrue(manager.list_backups()[0]['verified'])

    def test_explicit_restore_first_saves_current_state(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = Fixture(directory)
            manager.execute({'kind': 'backup'})
            old = manager.list_backups()[0]['id']
            manager.database['nova_test'] = 'new-order-after-backup'
            (manager.uploads / 'photo.png').write_bytes(b'new-image')
            job = manager.execute({'kind': 'restore', 'backup_id': old, 'confirm': 'ВОССТАНОВИТЬ'})
            self.assertEqual(job['status'], 'succeeded', job)
            self.assertEqual(manager.database['nova_test'], 'orders-and-owner-content')
            self.assertEqual((manager.uploads / 'photo.png').read_bytes(), b'owner-image')
            path, row = manager.inspect_backup(job['recovery_snapshot'])
            self.assertEqual((path / 'database.dump').read_bytes(), b'new-order-after-backup')
            self.assertTrue(row['verified'])

    def test_manager_restart_recovers_an_interrupted_update(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = Fixture(directory)
            manager.execute({'kind': 'backup'})
            backup = manager.list_backups()[0]['id']
            manager.state['active'] = {'id': 'crashed', 'kind': 'update', 'recovery_snapshot': backup, 'phase': 'apply'}
            manager.database['nova_test'] = 'partial-migration'
            (manager.app / 'marker').write_text('FAIL')
            (manager.web / '.nova-maintenance').touch()
            manager.recover_interrupted()
            self.assertIsNone(manager.state['active'])
            self.assertEqual(manager.database['nova_test'], 'orders-and-owner-content')
            self.assertEqual((manager.app / 'marker').read_text(), '0.20.0')
            self.assertFalse((manager.web / '.nova-maintenance').exists())

    def test_configuration_rejects_nested_paths_shell_names_and_nonlocal_health(self):
        config = json.loads((pathlib.Path(__file__).parents[1] / 'config.example.json').read_text())
        self.assertEqual(a.validate_config(config), config)
        for key, value in [('backup_dir', config['app_dir'] + '/backups'), ('service', 'nova;id'), ('health_url', 'http://evil.invalid/health'), ('app_dir', '/'), ('db_name', 'nova\';DROP')]:
            changed = copy.deepcopy(config)
            changed[key] = value
            with self.assertRaises(a.Failure):
                a.validate_config(changed)

    def test_only_published_version_asset_can_be_downloaded_and_hash_is_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = Fixture(directory)
            folder = pathlib.Path(directory) / 'download'
            folder.mkdir()
            url = 'https://github.com/maxx52/nova-engine/releases/download/v0.21.0/'
            release = {'tag_name': 'v0.21.0', 'draft': False, 'prerelease': False, 'assets': [{'name': 'nova-release.json', 'browser_download_url': url + 'nova-release.json'}, {'name': 'nova-0.21.0.tar.gz', 'browser_download_url': url + 'nova-0.21.0.tar.gz'}]}
            manifest = {'format': 'nova-release', 'version': '0.21.0', 'theme_api': 1, 'schema': 1, 'manager_protocol': 1, 'min_node': '22.12.0', 'from_min': '0.20.0', 'artifact': {'name': 'nova-0.21.0.tar.gz', 'size': 1, 'sha256': 'a' * 64}}
            def fake_download(location, destination=None, limit=0):
                if 'api.github.com' in location:
                    return release
                if location.endswith('.json'):
                    return manifest
                pathlib.Path(destination).write_bytes(b'x')
                return 1
            with patch.object(a, 'download', fake_download):
                with self.assertRaisesRegex(a.Failure, 'сумма'):
                    manager.get_release('0.21.0', folder)
                release['prerelease'] = True
                with self.assertRaisesRegex(a.Failure, 'стабильный'):
                    manager.get_release('0.21.0', folder)


if __name__ == '__main__':
    unittest.main()
