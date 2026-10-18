#!/usr/bin/env python3
"""Privileged, local-only NOVA deployment manager. No shell/paths from HTTP input."""
import argparse
import copy
import datetime as dt
import fcntl
import grp
import hashlib
import http.server
import json
import os
import pathlib
import platform
import pwd
import re
import shutil
import socket
import socketserver
import stat
import struct
import subprocess
import tarfile
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid

REPOSITORY = 'maxx52/nova-engine'
VERSION = re.compile(r'^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$')
BACKUP_ID = re.compile(r'^\d{8}T\d{6}Z-[a-f0-9]{8}$')
MANAGED_WEB = ('index.html', 'assets', 'admin')


class Failure(Exception):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise Failure('Некорректный номер версии')
    return tuple(map(int, value.split('.')))


def atomic_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + '.tmp')
    with open(temporary, 'w') as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def inside(root, path):
    return pathlib.Path(path).resolve().is_relative_to(pathlib.Path(root).resolve())


def safe_extract(archive, destination, allow_links=False):
    """Extract into a NEW empty directory; never traverse symlinks from an archive."""
    destination = pathlib.Path(destination)
    if list(destination.iterdir()):
        raise Failure('Каталог распаковки должен быть пустым')
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        if len(members) > 100000 or sum(m.size for m in members) > 1024 * 1024 * 1024:
            raise Failure('Архив слишком велик')
        seen = set()
        link_names = {pathlib.PurePosixPath(m.name) for m in members if m.issym()}
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or '\\' in member.name or member.name in seen:
                raise Failure('Некорректный путь в архиве')
            seen.add(member.name)
            if any(parent in link_names for parent in name.parents):
                raise Failure('Файл находится под ссылкой из архива')
            if not (member.isfile() or member.isdir() or allow_links and member.issym()):
                raise Failure('Архив содержит неподдерживаемый тип файла')
            if member.issym():
                target = destination / name.parent / member.linkname
                if pathlib.PurePosixPath(member.linkname).is_absolute() or not inside(destination, target):
                    raise Failure('Ссылка выходит за пределы архива')
        for member in members:
            if member.issym():
                continue
            target = destination / member.name
            if not inside(destination, target):
                raise Failure('Путь выходит за пределы архива')
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as incoming, open(target, 'xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)
        # No files are written after links are installed.
        for member in members:
            if member.issym():
                target = destination / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(member.linkname)
        for member in members:
            if member.issym() and not inside(destination, destination / member.name):
                raise Failure('Цепочка ссылок выходит за пределы архива')


def command_valid(body):
    if not isinstance(body, dict):
        return False
    kind = body.get('kind')
    if kind in ('backup', 'check'):
        return set(body) == {'kind'}
    if kind == 'update':
        return set(body) == {'kind', 'version'} and isinstance(body['version'], str) and bool(VERSION.fullmatch(body['version']))
    if kind in ('restore', 'verify'):
        keys = {'kind', 'backup_id'} | ({'confirm'} if kind == 'restore' else set())
        return set(body) == keys and isinstance(body['backup_id'], str) and bool(BACKUP_ID.fullmatch(body['backup_id'])) and (kind != 'restore' or body['confirm'] == 'ВОССТАНОВИТЬ')
    if kind == 'schedule':
        return set(body) == {'kind', 'enabled', 'hour_utc', 'retention_days'} and type(body['enabled']) is bool and type(body['hour_utc']) is int and 0 <= body['hour_utc'] <= 23 and type(body['retention_days']) is int and body['retention_days'] in (7, 14, 30)
    return False


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com') or parsed.username:
            raise Failure('Недопустимое перенаправление GitHub')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, destination=None, limit=200000):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ('api.github.com', 'github.com') or parsed.username or parsed.fragment:
        raise Failure('Недопустимый адрес GitHub')
    request = urllib.request.Request(url, headers={'User-Agent': 'NOVA-update-manager/1', 'Accept': 'application/vnd.github+json' if parsed.hostname == 'api.github.com' else 'application/octet-stream'})
    opener = urllib.request.build_opener(GitHubRedirect())
    size, chunks = 0, []
    with opener.open(request, timeout=20) as response:
        output = open(destination, 'xb') if destination else None
        try:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise Failure('Превышен размер загрузки')
                if output:
                    output.write(chunk)
                else:
                    chunks.append(chunk)
        finally:
            if output:
                output.close()
    return size if destination else json.loads(b''.join(chunks))


def validate_manifest(value, requested):
    if not isinstance(value, dict) or set(value) != {'format', 'version', 'theme_api', 'schema', 'manager_protocol', 'min_node', 'from_min', 'artifact'}:
        raise Failure('Неподдерживаемый манифест релиза')
    if any(type(value[key]) is not int for key in ('theme_api', 'schema', 'manager_protocol')):
        raise Failure('Некорректная версия протокола')
    if value['format'] != 'nova-release' or value['version'] != requested or value['theme_api'] != 1 or value['schema'] != 1 or value['manager_protocol'] != 1:
        raise Failure('Релиз несовместим с темами или службой обновления')
    version(requested)
    version(value['min_node'])
    version(value['from_min'])
    artifact = value['artifact']
    if not isinstance(artifact, dict) or set(artifact) != {'name', 'size', 'sha256'} or artifact['name'] != 'nova-' + requested + '.tar.gz' or type(artifact['size']) is not int or not 0 < artifact['size'] <= 100 * 1024 * 1024 or not isinstance(artifact['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', artifact['sha256']):
        raise Failure('Некорректный пакет релиза')
    return value


class Manager:
    def __init__(self, config):
        self.config = config
        self.app = pathlib.Path(config['app_dir'])
        self.web = pathlib.Path(config['web_dir'])
        self.uploads = pathlib.Path(config['uploads_dir'])
        self.environment = pathlib.Path(config['env_file'])
        self.root = pathlib.Path(config['state_dir'])
        self.backups = pathlib.Path(config['backup_dir'])
        self.staging = pathlib.Path(config['staging_dir'])
        for path in (self.root, self.backups, self.staging):
            path.mkdir(parents=True, exist_ok=True)
            os.chmod(path, 0o700)
        self.guard = threading.RLock()
        self.state_file = self.root / 'state.json'
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {'jobs': [], 'active': None, 'release': None, 'checked_at': None, 'release_error': None, 'schedule': {'enabled': False, 'hour_utc': 3, 'retention_days': 7}, 'last_daily': None, 'last_check_attempt': None}
        self.persist()

    def persist(self):
        with self.guard:
            atomic_json(self.state_file, self.state)

    def current_version(self):
        path = self.app / 'config/release.json'
        if path.exists():
            value = json.loads(path.read_text())['version']
        else:
            match = re.search(r"PRODUCT_VERSION\s*=\s*['\"]([^'\"]+)['\"]", (self.app / 'config/release.js').read_text())
            if not match:
                raise Failure('Не удалось определить текущую версию')
            value = match.group(1)
        version(value)
        return value

    def run(self, args, *, cwd=None, output=None, incoming=None, capture=False, timeout=180, allow_failure=False):
        log_path = self.root / 'worker.log'
        if log_path.exists() and log_path.stat().st_size > 2 * 1024 * 1024:
            log_path.write_text('')
        with open(log_path, 'ab') as log:
            result = subprocess.run(args, cwd=cwd, stdin=incoming, stdout=subprocess.PIPE if capture else output or log, stderr=log, timeout=timeout, env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'})
        if result.returncode and not allow_failure:
            raise Failure('Команда не завершилась успешно: ' + pathlib.Path(args[0]).name + '. Подробности доступны администратору сервера.')
        if capture:
            if len(result.stdout) > 100000:
                raise Failure('Слишком большой ответ команды')
            return result.stdout.decode().strip()

    def run_unprivileged(self, args, cwd, timeout=600):
        # PID 1 applies credentials; the protected manager never needs to call
        # setuid itself. A separate cgroup and read-only filesystem also contain
        # any dependency/helper descendants, including after a manager crash.
        unit = 'nova-prepare-' + uuid.uuid4().hex
        command = ['systemd-run', '--wait', '--pipe', '--collect', '--quiet',
                   '--unit=' + unit, '--uid=' + self.config['app_user'],
                   '--gid=' + self.config['app_group'], '--working-directory=' + str(cwd),
                   '--property=NoNewPrivileges=yes', '--property=ProtectSystem=strict',
                   '--property=ProtectHome=yes', '--property=PrivateTmp=yes',
                   '--property=ReadWritePaths=' + str(cwd), '--property=UMask=0077',
                   '--property=KillMode=control-group', '--property=RuntimeMaxSec=' + str(timeout),
                   '--property=MemoryMax=384M', '--property=CPUQuota=60%',
                   '--setenv=HOME=' + str(cwd), '--setenv=PATH=/usr/local/bin:/usr/bin:/bin', '--', *args]
        try:
            return self.run(command, timeout=timeout + 10)
        finally:
            # --collect may already have removed a successful unit.
            self.run(['systemctl', 'stop', unit], timeout=30, allow_failure=True)

    def db_command(self, command, *args, incoming=None, output=None, capture=False):
        return self.run(['docker', 'exec', '-i', self.config['db_container'], command, '-U', self.config['db_admin'], *args], incoming=incoming, output=output, capture=capture, timeout=300)

    def phase(self, value):
        with self.guard:
            self.state['active']['phase'] = value
            self.persist()

    def check_releases(self):
        with self.guard:
            last = self.state.get('last_check_attempt')
            if last and (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(last)).total_seconds() < 60:
                raise Failure('Проверка выполнялась недавно. Повторите через минуту.')
            self.state['last_check_attempt'] = now()
            self.persist()
        try:
            rows = download('https://api.github.com/repos/' + REPOSITORY + '/releases?per_page=10')
            if not isinstance(rows, list):
                raise Failure('Некорректный ответ GitHub')
            releases = []
            for row in rows:
                tag = row.get('tag_name', '')
                if not isinstance(tag, str) or not tag.startswith('v') or not VERSION.fullmatch(tag[1:]) or row.get('draft') or row.get('prerelease'):
                    continue
                if row.get('html_url') != 'https://github.com/' + REPOSITORY + '/releases/tag/' + tag:
                    continue
                releases.append({'version': tag[1:], 'url': row['html_url'], 'title': str(row.get('name') or tag)[:200], 'notes': str(row.get('body') or '')[:8000], 'published_at': row.get('published_at')})
            releases.sort(key=lambda row: version(row['version']), reverse=True)
            with self.guard:
                self.state.update(release=releases[0] if releases else None, checked_at=now(), release_error=None)
                self.persist()
        except Exception:
            with self.guard:
                self.state['release_error'] = 'GitHub временно недоступен. Последняя успешная проверка сохранена.'
                self.persist()
            raise Failure('Не удалось проверить GitHub')

    def status(self):
        with self.guard:
            return {'protocol': 1, 'current_version': self.current_version(), 'release': copy.deepcopy(self.state['release']), 'checked_at': self.state['checked_at'], 'error': self.state['release_error'], 'active': copy.deepcopy(self.state['active']), 'jobs': copy.deepcopy(self.state['jobs'][-15:][::-1]), 'schedule': copy.deepcopy(self.state['schedule']), 'backups': self.list_backups(), 'backup_scope': ['database', 'uploads', 'code', 'web', 'environment'], 'external_backup': False}

    def list_backups(self, limit=100):
        result = []
        for path in self.backups.iterdir():
            if not BACKUP_ID.fullmatch(path.name) or not path.is_dir() or path.is_symlink():
                continue
            try:
                row = json.loads((path / 'metadata.json').read_text())
                if row['complete']:
                    result.append({key: row[key] for key in ('id', 'created_at', 'version', 'verified', 'size_bytes', 'reason')})
            except (OSError, ValueError, KeyError):
                continue
        rows = sorted(result, key=lambda row: row['id'], reverse=True)
        return rows[:limit] if limit else rows

    def backup_path(self, identifier):
        if not isinstance(identifier, str) or not BACKUP_ID.fullmatch(identifier):
            raise Failure('Некорректный идентификатор копии')
        path = self.backups / identifier
        if not path.is_dir() or path.is_symlink():
            raise Failure('Резервная копия не найдена')
        return path

    def inspect_backup(self, identifier):
        path = self.backup_path(identifier)
        row = json.loads((path / 'metadata.json').read_text())
        if not row.get('complete') or row['id'] != identifier:
            raise Failure('Копия не завершена')
        for name in ('database.dump', 'code.tar.gz', 'web.tar.gz', 'uploads.tar.gz', 'environment'):
            file = path / name
            if file.is_symlink() or not file.is_file() or digest(file) != row['sha256'].get(name):
                raise Failure('Контрольная сумма резервной копии не совпадает')
        return path, row

    def pause(self):
        (self.web / '.nova-maintenance').write_text('NOVA maintenance\n')
        self.run(['systemctl', 'stop', self.config['service']])

    def resume(self):
        self.run(['systemctl', 'start', self.config['service']])
        last = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(self.config['health_url'], timeout=3) as response:
                    if response.status == 200 and json.load(response).get('status') == 'ok':
                        return
            except Exception as error:
                last = error
            time.sleep(1)
        raise Failure('API не прошёл проверку готовности; сайт оставлен в режиме обслуживания') from last

    def archive(self, destination, root, names):
        with tarfile.open(destination, 'w:gz', compresslevel=1) as target:
            for name in names:
                path = root / name
                if path.exists() or path.is_symlink():
                    target.add(path, arcname=name, recursive=True)
        os.chmod(destination, 0o600)

    def snapshot(self, reason):
        identifier = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
        path = self.backups / identifier
        path.mkdir(mode=0o700)
        self.phase('backup')
        with open(path / 'database.dump', 'xb') as output:
            self.db_command('pg_dump', '-d', self.config['db_name'], '-Fc', output=output)
        self.archive(path / 'code.tar.gz', self.app, [p.name for p in self.app.iterdir() if p.name not in ('.env', '.git', 'uploads')])
        self.archive(path / 'web.tar.gz', self.web, MANAGED_WEB)
        self.archive(path / 'uploads.tar.gz', self.uploads, [p.name for p in self.uploads.iterdir()])
        shutil.copyfile(self.environment, path / 'environment')
        env_stat = self.environment.stat()
        os.chmod(path / 'environment', 0o600)
        files = ('database.dump', 'code.tar.gz', 'web.tar.gz', 'uploads.tar.gz', 'environment')
        row = {'id': identifier, 'created_at': now(), 'version': self.current_version(), 'verified': False, 'complete': True, 'reason': reason, 'size_bytes': sum((path / name).stat().st_size for name in files), 'sha256': {name: digest(path / name) for name in files}, 'environment_mode': stat.S_IMODE(env_stat.st_mode), 'environment_uid': env_stat.st_uid, 'environment_gid': env_stat.st_gid}
        atomic_json(path / 'metadata.json', row)
        return identifier

    def verify(self, identifier):
        self.phase('verify')
        path, row = self.inspect_backup(identifier)
        database = 'nova_verify_' + uuid.uuid4().hex
        self.db_command('createdb', '-O', self.config['db_role'], database)
        try:
            with open(path / 'database.dump', 'rb') as incoming:
                self.db_command('pg_restore', '-d', database, '--no-owner', '--role=' + self.config['db_role'], '--exit-on-error', incoming=incoming)
            answer = self.db_command('psql', '-d', database, '-At', '-c', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'", capture=True)
            if not answer.isdigit() or int(answer) < 5:
                raise Failure('Проверочная база не содержит таблицы CMS')
            # Check full extraction as well, including native runtime symlinks.
            for name, links in (('code.tar.gz', True), ('web.tar.gz', False), ('uploads.tar.gz', False)):
                with tempfile.TemporaryDirectory(dir=self.staging) as folder:
                    safe_extract(path / name, folder, allow_links=links)
            row['verified'] = True
            atomic_json(path / 'metadata.json', row)
        finally:
            self.db_command('dropdb', '--if-exists', database)
        return row

    def chown_runtime(self, path):
        self.run(['chown', '-R', '--no-dereference', self.config['app_user'] + ':' + self.config['app_group'], str(path)])

    def freeze_tree(self, path):
        # Promoted application/public files must never retain setuid or writable
        # ownership from the unprivileged dependency installation step.
        self.run(['chown', '-R', '--no-dereference', 'root:root', str(path)])
        os.chmod(path, 0o755)
        for folder, directories, files in os.walk(path, followlinks=False):
            for name in directories + files:
                file = pathlib.Path(folder) / name
                info = file.lstat()
                if stat.S_ISLNK(info.st_mode):
                    if not inside(path, file):
                        raise Failure('Ссылка в зависимостях выходит за пределы приложения')
                elif stat.S_ISDIR(info.st_mode):
                    os.chmod(file, 0o755)
                elif stat.S_ISREG(info.st_mode):
                    os.chmod(file, 0o755 if info.st_mode & 0o111 else 0o644)
                else:
                    raise Failure('Неподдерживаемый файл в приложении')

    def verify_release_files(self, archive, app):
        expected = set()
        with tarfile.open(archive, 'r:gz') as source:
            for member in source.getmembers():
                if not member.isfile():
                    continue
                relative = pathlib.PurePosixPath(member.name)
                expected.add(str(relative))
                actual = app / relative
                if actual.is_symlink() or not actual.is_file():
                    raise Failure('Файл релиза заменён во время подготовки')
                value = hashlib.sha256()
                with source.extractfile(member) as incoming:
                    for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                        value.update(chunk)
                if digest(actual) != value.hexdigest():
                    raise Failure('Код релиза изменился во время установки зависимостей')
        for folder, _, files in os.walk(app, followlinks=False):
            for name in files:
                relative = (pathlib.Path(folder) / name).relative_to(app)
                if 'node_modules' not in relative.parts and str(relative) not in expected:
                    raise Failure('В подготовленном релизе появились посторонние файлы')

    def restore(self, identifier):
        path, row = self.inspect_backup(identifier)
        if not row['verified']:
            raise Failure('Сначала проверьте резервную копию')
        self.phase('restore')
        with tempfile.TemporaryDirectory(dir=self.staging) as folder:
            root = pathlib.Path(folder)
            for name in ('code', 'web', 'uploads'):
                (root / name).mkdir()
                safe_extract(path / (name + '.tar.gz'), root / name, allow_links=name == 'code')
            # Extraction and digest verification completed before the first mutation.
            self.run(['systemctl', 'stop', self.config['service']])
            self.run(['docker', 'exec', '-i', self.config['db_container'], 'psql', '-U', self.config['db_admin'], '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" + self.config['db_name'] + "' AND pid<>pg_backend_pid()"])
            self.db_command('dropdb', '--if-exists', self.config['db_name'])
            self.db_command('createdb', '-O', self.config['db_role'], self.config['db_name'])
            with open(path / 'database.dump', 'rb') as incoming:
                self.db_command('pg_restore', '-d', self.config['db_name'], '--no-owner', '--role=' + self.config['db_role'], '--exit-on-error', incoming=incoming)
            # Only configured application directories and the three managed web paths.
            for destination, source in ((self.app, root / 'code'), (self.uploads, root / 'uploads')):
                self.replace_directory(destination, source)
            for name in MANAGED_WEB:
                target = self.web / name
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink(missing_ok=True)
                source = root / 'web' / name
                if source.is_dir():
                    shutil.copytree(source, target)
                elif source.exists():
                    shutil.copyfile(source, target)
            temporary = self.environment.with_name(self.environment.name + '.restore')
            shutil.copyfile(path / 'environment', temporary)
            os.chmod(temporary, row['environment_mode'])
            os.chown(temporary, row['environment_uid'], row['environment_gid'])
            os.replace(temporary, self.environment)
            pathlib.Path(self.config['revision_file']).write_text('restored:' + identifier + '\n')
        self.resume()

    def get_release(self, requested, folder):
        version(requested)
        if version(requested) <= version(self.current_version()):
            raise Failure('Для обновления выберите более новую стабильную версию')
        row = download('https://api.github.com/repos/' + REPOSITORY + '/releases/tags/v' + requested)
        expected = 'https://github.com/' + REPOSITORY + '/releases/download/v' + requested + '/'
        if row.get('draft') or row.get('prerelease') or row.get('tag_name') != 'v' + requested:
            raise Failure('Можно устанавливать только опубликованный стабильный релиз')
        assets = {a.get('name'): a for a in row.get('assets', [])}
        manifest_asset = assets.get('nova-release.json', {})
        if manifest_asset.get('browser_download_url') != expected + 'nova-release.json':
            raise Failure('В релизе нет проверяемого пакета NOVA')
        manifest = validate_manifest(download(expected + 'nova-release.json', limit=16000), requested)
        if version(self.current_version()) < version(manifest['from_min']):
            raise Failure('Нужна промежуточная версия CMS')
        node = self.run(['node', '--version'], capture=True).removeprefix('v')
        if version(node) < version(manifest['min_node']):
            raise Failure('Требуется обновить Node.js на сервере')
        artifact = manifest['artifact']
        if assets.get(artifact['name'], {}).get('browser_download_url') != expected + artifact['name']:
            raise Failure('Некорректный адрес пакета')
        archive = folder / 'release.tar.gz'
        size = download(expected + artifact['name'], archive, limit=artifact['size'])
        if size != artifact['size'] or digest(archive) != artifact['sha256']:
            raise Failure('Контрольная сумма релиза не совпадает')
        return archive, manifest

    def prepare_release(self, requested, folder):
        self.phase('download')
        archive, manifest = self.get_release(requested, folder)
        app = folder / 'app'
        app.mkdir()
        safe_extract(archive, app)
        actual = json.loads((app / 'config/release.json').read_text())
        if any(actual.get(key) != manifest[key] for key in ('version', 'min_node', 'theme_api', 'schema', 'manager_protocol', 'from_min')):
            raise Failure('Код релиза не соответствует манифесту')
        for file in ('apps/storefront/dist/index.html', 'apps/admin/dist/index.html', 'apps/api/src/server.js', 'package-lock.json'):
            if not (app / file).is_file():
                raise Failure('Пакет не содержит готовые интерфейсы и API')
        # Root-owned staging parent becomes traversable only for the configured app user.
        os.chmod(self.staging, 0o711)
        os.chmod(folder, 0o755)
        self.chown_runtime(app)
        self.phase('dependencies')
        self.run_unprivileged(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(app / '.npm-cache')], cwd=app, timeout=600)
        self.run_unprivileged(['node', '--input-type=module', '-e', "import sharp from 'sharp';await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer()"], cwd=app, timeout=120)
        shutil.rmtree(app / '.npm-cache', ignore_errors=True)
        self.freeze_tree(app)
        self.verify_release_files(archive, app)
        return app

    def replace_directory(self, destination, source):
        prepared = destination.with_name(destination.name + '.nova-new-' + uuid.uuid4().hex)
        old = destination.with_name(destination.name + '.nova-old-' + uuid.uuid4().hex)
        shutil.copytree(source, prepared, symlinks=True)
        if destination == self.uploads:
            self.chown_runtime(prepared)
        else:
            self.freeze_tree(prepared)
        existed = destination.exists()
        if existed:
            destination.rename(old)
        try:
            prepared.rename(destination)
        except Exception:
            if existed:
                old.rename(destination)
            raise
        if existed:
            shutil.rmtree(old)

    def install_release(self, app):
        self.phase('apply')
        self.replace_directory(self.app, app)
        # Assets first; index files atomically after all dependencies are present.
        for source, destination in ((self.app / 'apps/storefront/dist', self.web), (self.app / 'apps/admin/dist', self.web / 'admin')):
            destination.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source / 'assets', destination / 'assets', dirs_exist_ok=True)
            temporary = destination / 'index.html.next'
            shutil.copyfile(source / 'index.html', temporary)
            os.replace(temporary, destination / 'index.html')
        self.phase('health')
        self.resume()

    def free_space(self):
        estimate = 256 * 1024 * 1024
        for root in (self.app, self.uploads):
            for folder, _, files in os.walk(root):
                for name in files:
                    file = pathlib.Path(folder) / name
                    if not file.is_symlink():
                        estimate += file.stat().st_size * 2
        database_size = self.db_command('psql', '-d', self.config['db_name'], '-At', '-c', 'SELECT pg_database_size(current_database())', capture=True)
        estimate += int(database_size) * 2
        if shutil.disk_usage(self.backups).free < estimate or shutil.disk_usage(self.staging).free < estimate:
            raise Failure('Недостаточно свободного места для копии и обновления')

    def submit(self, body):
        if not command_valid(body):
            raise Failure('Некорректная системная операция')
        with self.guard:
            if self.state['active']:
                raise Failure('Другая системная операция уже выполняется')
            if body['kind'] == 'schedule':
                self.state['schedule'] = {key: body[key] for key in ('enabled', 'hour_utc', 'retention_days')}
                self.persist()
                return {'schedule': copy.deepcopy(self.state['schedule'])}
            job = {'id': uuid.uuid4().hex, 'kind': body['kind'], 'started_at': now(), 'phase': 'queued', 'status': 'running', 'recovery_snapshot': None}
            if body['kind'] == 'update':
                job['version'] = body['version']
            if body['kind'] in ('restore', 'verify'):
                job['backup_id'] = body['backup_id']
            self.state['active'] = job
            self.persist()
            threading.Thread(target=self.perform, args=(copy.deepcopy(body),), daemon=True).start()
            return copy.deepcopy(job)

    def perform(self, body):
        recovery, paused, mutating = None, False, False
        try:
            kind = body['kind']
            if kind == 'check':
                self.phase('check')
                self.check_releases()
            elif kind == 'verify':
                self.verify(body['backup_id'])
            else:
                self.free_space()
                with tempfile.TemporaryDirectory(dir=self.staging) as directory:
                    prepared = self.prepare_release(body['version'], pathlib.Path(directory)) if kind == 'update' else None
                    if kind == 'restore':
                        _, target = self.inspect_backup(body['backup_id'])
                        if not target['verified']:
                            raise Failure('Сначала проверьте выбранную копию')
                    self.phase('maintenance')
                    self.pause()
                    paused = True
                    recovery = self.snapshot('before-' + kind if kind != 'backup' else 'manual-or-scheduled')
                    self.verify(recovery)
                    with self.guard:
                        self.state['active']['recovery_snapshot'] = recovery
                        self.persist()
                    if kind == 'update':
                        mutating = True
                        self.install_release(prepared)
                        pathlib.Path(self.config['revision_file']).write_text('release:v' + body['version'] + '\n')
                    elif kind == 'restore':
                        mutating = True
                        self.restore(body['backup_id'])
                    else:
                        self.resume()
                    paused = False
                self.retention()
            with self.guard:
                self.state['active'].update(status='succeeded', phase='done', finished_at=now())
                self.persist()
            if kind in ('backup', 'update', 'restore'):
                (self.web / '.nova-maintenance').unlink(missing_ok=True)
        except Exception as error:
            with open(self.root / 'worker.log', 'a') as log:
                traceback.print_exc(file=log)
            message = str(error) if isinstance(error, Failure) else 'Операция не завершена. Подробности доступны администратору сервера.'
            try:
                if recovery and mutating:
                    self.restore(recovery)
                    (self.web / '.nova-maintenance').unlink(missing_ok=True)
                    message += ' Предыдущее состояние восстановлено.'
                elif paused or (self.web / '.nova-maintenance').exists():
                    self.resume()
                    (self.web / '.nova-maintenance').unlink(missing_ok=True)
            except Exception:
                message += ' Автоматическое восстановление не завершено; требуется администратор сервера. Сайт остаётся в режиме обслуживания.'
            with self.guard:
                self.state['active'].update(status='failed', error=message, finished_at=now())
        finally:
            with self.guard:
                self.state['jobs'] = (self.state['jobs'] + [self.state['active']])[-30:]
                self.state['active'] = None
                self.persist()

    def retention(self):
        rows = self.list_backups(limit=None)
        keep = {row['id'] for row in rows[:2]}
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=self.state['schedule']['retention_days'])
        for row in rows:
            if row['id'] not in keep and dt.datetime.fromisoformat(row['created_at']) < cutoff:
                shutil.rmtree(self.backup_path(row['id']))

    def recover_interrupted(self):
        active = self.state['active']
        if not active:
            return
        try:
            identifier = active.get('recovery_snapshot')
            if identifier:
                self.restore(identifier)
            elif (self.web / '.nova-maintenance').exists():
                self.resume()
            (self.web / '.nova-maintenance').unlink(missing_ok=True)
            active.update(status='failed', error='Предыдущая операция прервалась; выполнено восстановление при запуске службы.', finished_at=now())
        except Exception:
            active.update(status='failed', error='Прерванная операция требует восстановления администратором сервера.', finished_at=now())
        self.state['jobs'] = (self.state['jobs'] + [active])[-30:]
        self.state['active'] = None
        self.persist()

    def tick(self):
        while True:
            time.sleep(60)
            with self.guard:
                if self.state['active'] or (self.web / '.nova-maintenance').exists():
                    continue
                schedule = self.state['schedule']
                today = dt.datetime.now(dt.timezone.utc)
                if schedule['enabled'] and today.hour >= schedule['hour_utc'] and self.state['last_daily'] != today.date().isoformat():
                    self.state['last_daily'] = today.date().isoformat()
                    self.persist()
                    self.submit({'kind': 'backup'})
                elif (not self.state.get('last_check_attempt') or (today - dt.datetime.fromisoformat(self.state['last_check_attempt'])).total_seconds() > 3600) and (not self.state['checked_at'] or (today - dt.datetime.fromisoformat(self.state['checked_at'])).total_seconds() > 86400):
                    self.submit({'kind': 'check'})


class LocalServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(5)
        return request, address

    def verify_request(self, request, client_address):
        _, uid, _ = struct.unpack('3i', request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return uid in (0, self.allowed_uid)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status_code, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != '/status':
            return self.reply(404, {'error': 'Не найдено'})
        self.reply(200, self.server.manager.status())

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.path != '/jobs' or not 0 < size <= 2048:
                return self.reply(400, {'error': 'Некорректный запрос'})
            value = json.loads(self.rfile.read(size))
            self.reply(202, self.server.manager.submit(value))
        except Failure as error:
            self.reply(409, {'error': str(error)})
        except Exception:
            self.reply(400, {'error': 'Некорректный запрос'})


def load_config(path):
    path = pathlib.Path(path)
    info = path.stat()
    if path.is_symlink() or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
        raise Failure('Конфигурация должна принадлежать root и не быть доступной на запись другим пользователям')
    return validate_config(json.loads(path.read_text()))


def validate_config(value):
    keys = {'app_dir', 'web_dir', 'uploads_dir', 'env_file', 'state_dir', 'backup_dir', 'staging_dir', 'socket', 'service', 'db_container', 'db_admin', 'db_role', 'db_name', 'app_user', 'app_group', 'health_url', 'revision_file'}
    if set(value) != keys:
        raise Failure('Некорректная конфигурация службы')
    for key in ('service', 'db_container', 'db_admin', 'db_role', 'db_name', 'app_user', 'app_group'):
        if not isinstance(value[key], str) or not re.fullmatch('[a-zA-Z0-9_-]{1,80}', value[key]):
            raise Failure('Некорректное имя в конфигурации')
    paths = []
    for key in ('app_dir', 'web_dir', 'uploads_dir', 'state_dir', 'backup_dir', 'staging_dir'):
        target = pathlib.Path(value[key])
        if not target.is_absolute() or target.is_symlink() or len(target.parts) < 3 or target.resolve() != target:
            raise Failure('Некорректный путь в конфигурации')
        paths.append(target)
    if len(set(paths)) != len(paths):
        raise Failure('Каталоги службы должны быть разными')
    for first in paths:
        for second in paths:
            if first != second and (first.is_relative_to(second) or second.is_relative_to(first)):
                raise Failure('Каталоги службы не должны быть вложены друг в друга')
    for key in ('env_file', 'revision_file', 'socket'):
        if not pathlib.Path(value[key]).is_absolute():
            raise Failure('Требуется абсолютный путь')
    parsed = urllib.parse.urlparse(value['health_url'])
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path != '/health' or parsed.username or parsed.query:
        raise Failure('Проверка готовности должна обращаться к локальному API')
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    arguments = parser.parse_args()
    if os.geteuid() != 0 or platform.system() != 'Linux':
        raise Failure('Служба предназначена для Linux/systemd и запускается администратором сервера')
    os.umask(0o077)
    config = load_config(arguments.config)
    for key in ('state_dir', 'backup_dir', 'staging_dir'):
        folder = pathlib.Path(config[key])
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        info = folder.stat()
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
            raise Failure('Каталоги менеджера должны принадлежать root и не быть доступны другим на запись')
    lock = open(pathlib.Path(config['state_dir']) / 'manager.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for key in ('app_dir', 'web_dir'):
        path = pathlib.Path(config[key])
        for ancestor in (path, *path.parents):
            info = ancestor.stat()
            if info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
                raise Failure('Код, webroot и родительские каталоги должны принадлежать root без записи для приложения')
    manager = Manager(config)
    manager.recover_interrupted()
    address = pathlib.Path(config['socket'])
    address.parent.mkdir(parents=True, exist_ok=True)
    os.chown(address.parent, 0, grp.getgrnam(config['app_group']).gr_gid)
    os.chmod(address.parent, 0o750)
    address.unlink(missing_ok=True)
    server = LocalServer(str(address), Handler)
    server.manager = manager
    server.allowed_uid = pwd.getpwnam(config['app_user']).pw_uid
    os.chown(address, 0, grp.getgrnam(config['app_group']).gr_gid)
    os.chmod(address, 0o660)
    threading.Thread(target=manager.tick, daemon=True).start()
    server.serve_forever(poll_interval=1)


if __name__ == '__main__':
    main()
