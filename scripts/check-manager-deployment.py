"""CI-only real PostgreSQL dump/restore verification, using disposable containers."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location('agent', pathlib.Path('deploy/updater/agent.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


class CIManager(a.Manager):
    def run(self, args, **kwargs):
        if args[:2] == ['systemctl', 'stop']:
            return command('docker', 'stop', 'nova-api-1')
        if args[:2] == ['systemctl', 'start']:
            return command('docker', 'start', 'nova-api-1')
        return super().run(args, **kwargs)

    def resume(self):
        command('docker', 'start', 'nova-api-1')
        for _ in range(30):
            response = subprocess.run(['docker', 'exec', 'nova-api-1', 'node', '-e', "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], capture_output=True)
            if response.returncode == 0:
                return
            time.sleep(1)
        raise a.Failure('CI API did not recover')


with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    config = json.loads(pathlib.Path('deploy/updater/config.example.json').read_text())
    for key, name in [('app_dir', 'app'), ('web_dir', 'web'), ('uploads_dir', 'uploads'), ('state_dir', 'state'), ('backup_dir', 'backups'), ('staging_dir', 'staging')]:
        config[key] = str(root / name)
        (root / name).mkdir()
    config.update(db_container='nova-db-1', db_name='nova', env_file=str(root / 'private.env'), revision_file=str(root / 'revision'))
    (root / 'app/config').mkdir()
    (root / 'app/config/release.json').write_text('{"version":"0.21.0"}')
    (root / 'web/index.html').write_text('CI only')
    (root / 'uploads/photo.png').write_bytes(b'CI image')
    (root / 'private.env').write_text('CI-PRIVATE-SETTINGS')
    (root / 'private.env').chmod(0o600)
    count_before = command('docker', 'exec', 'nova-db-1', 'psql', '-U', 'postgres', '-d', 'nova', '-Atc', 'SELECT count(*) FROM admin_accounts')
    manager = CIManager(config)
    manager.state['active'] = {'id': 'ci', 'kind': 'backup', 'phase': 'queued', 'status': 'running', 'recovery_snapshot': None}
    manager.perform({'kind': 'backup'})
    job = manager.state['jobs'][-1]
    assert job['status'] == 'succeeded', job
    backups = manager.list_backups()
    assert backups and backups[0]['verified']
    path, metadata = manager.inspect_backup(backups[0]['id'])
    assert (path / 'environment').read_text() == 'CI-PRIVATE-SETTINGS'
    assert 'CI-PRIVATE-SETTINGS' not in json.dumps(manager.status())
    count_after = command('docker', 'exec', 'nova-db-1', 'psql', '-U', 'postgres', '-d', 'nova', '-Atc', 'SELECT count(*) FROM admin_accounts')
    assert count_after == count_before == '1'
    remaining = command('docker', 'exec', 'nova-db-1', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'nova_verify_%'")
    assert not remaining
    print('PASS full backup and real PostgreSQL 17 restore into a temporary database; live test database remains unchanged')
