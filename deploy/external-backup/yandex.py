#!/usr/bin/env python3
"""Root-only encrypted off-site copies. Never accepts credentials via argv or HTTP."""
import argparse
import configparser
import datetime as dt
import fcntl
import getpass
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import stat
import subprocess
import tempfile

CONFIG = pathlib.Path('/etc/nova/yandex-rclone.conf')
STATE = pathlib.Path('/var/lib/nova-external-backup')
BACKUPS = pathlib.Path('/var/backups/nova-system')
REMOTE = 'nova-crypt:'
FOLDER = 'NOVA-Backups/nova.maxxdev.ru'
IDENTIFIER = re.compile(r'^\d{8}T\d{6}Z-[a-f0-9]{8}$')
FILES = ('database.dump', 'code.tar.gz', 'web.tar.gz', 'uploads.tar.gz', 'environment')


class Failure(Exception):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def private(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise Failure('Файл конфигурации должен принадлежать root с правами 600')


def atomic(path, value):
    temporary = path.with_suffix('.next')
    with open(temporary, 'w', encoding='utf-8') as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def run(args, *, incoming=None):
    # No provider stderr or config content is returned to the caller/journal.
    try:
        result = subprocess.run(args, input=incoming, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=3300, check=True)
        return result.stdout
    except (subprocess.SubprocessError, OSError):
        raise Failure('Операция Яндекс Диска не выполнена: проверьте доступ, сеть и свободное место') from None


def rclone(*args):
    return run(['/usr/bin/rclone', '--config', str(CONFIG), '--contimeout', '20s',
                # Yandex WebDAV must accept the PUT before streaming its body.
                # Without this handshake even small encrypted uploads can stall.
                '--disable-http2', '--header-upload', 'Expect: 100-continue',
                '--expect-continue-timeout', '5m', '--timeout', '6m',
                '--retries', '3', '--low-level-retries', '3',
                '--transfers', '1', '--checkers', '2', '--bwlimit', '4M', *args])


def validate_config():
    private(CONFIG)
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(CONFIG)
    # Refuse unencrypted remotes, exec hooks and alternate destinations.
    expected = {'yandex': {'type', 'url', 'vendor', 'user', 'pass'},
                'nova-crypt': {'type', 'remote', 'filename_encryption', 'directory_name_encryption', 'password'}}
    if set(parser.sections()) != set(expected) or parser.defaults():
        raise Failure('Неожиданная конфигурация внешнего хранилища')
    for section, keys in expected.items():
        if set(parser[section]) != keys:
            raise Failure('Неожиданные параметры внешнего хранилища')
    a, b = parser['yandex'], parser['nova-crypt']
    if (a['type'], a['url'], a['vendor']) != ('webdav', 'https://webdav.yandex.ru', 'other') or not a['user'] or not a['pass']:
        raise Failure('Требуется WebDAV Яндекс Диска')
    if (b['type'], b['remote'], b['filename_encryption'], b['directory_name_encryption']) != ('crypt', 'yandex:' + FOLDER, 'standard', 'true') or not b['password']:
        raise Failure('Требуется шифрование содержимого и имён файлов')


def inspect(path):
    if path.is_symlink() or not path.is_dir() or not IDENTIFIER.fullmatch(path.name):
        raise Failure('Некорректный каталог копии')
    info = (path / 'metadata.json').lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 32768:
        raise Failure('Некорректные метаданные копии')
    row = json.loads((path / 'metadata.json').read_text())
    if row.get('id') != path.name or row.get('complete') is not True or row.get('verified') is not True or set(row.get('sha256', {})) != set(FILES):
        raise Failure('Отправляются только полные проверенные копии')
    for name in FILES:
        file = path / name
        if not stat.S_ISREG(file.lstat().st_mode):
            raise Failure('Копия содержит ссылку или специальный файл')
        with open(file, 'rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        if digest != row['sha256'][name]:
            raise Failure('Контрольная сумма локальной копии не совпадает')
    return row


def obscure(value):
    return run(['/usr/bin/rclone', 'obscure', '-'], incoming=value.encode()).decode().strip()


def setup():
    if CONFIG.exists():
        raise Failure('Настройка уже существует. Для проверки используйте test; не заменяйте пароль шифрования существующих копий')
    print('Данные вводятся только здесь. Не отправляйте их в чат. Пароли не отображаются.')
    login = input('Логин Яндекса: ').strip()
    password = getpass.getpass('Пароль приложения «Файлы WebDAV»: ')
    phrase = getpass.getpass('Новый пароль шифрования (от 20 символов; сохраните вне VDS): ')
    repeat = getpass.getpass('Повторите пароль шифрования: ')
    if not login or any(c in login for c in '\r\n[]') or not password or len(phrase) < 20 or phrase != repeat:
        raise Failure('Пустые/некорректные значения или пароли шифрования не совпадают')
    if input('Пароль шифрования сохранён у вас вне VDS? Введите ДА: ').strip() != 'ДА':
        raise Failure('Сначала сохраните пароль: без него после потери VDS копии не расшифровать')
    config = configparser.ConfigParser(interpolation=None)
    config['yandex'] = dict(type='webdav', url='https://webdav.yandex.ru', vendor='other', user=login, **{'pass': obscure(password)})
    config['nova-crypt'] = dict(type='crypt', remote='yandex:' + FOLDER,
                              filename_encryption='standard', directory_name_encryption='true', password=obscure(phrase))
    CONFIG.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    with open(CONFIG, 'x') as handle:
        os.chmod(CONFIG, 0o600)
        config.write(handle)
    del password, phrase, repeat
    probe()
    enable()


def enable():
    run(['/usr/bin/systemctl', 'enable', '--now', 'nova-external-backup.timer'])
    run(['/usr/bin/systemctl', 'start', '--no-block', 'nova-external-backup.service'])
    print('Авторизация и шифрование проверены. Отправка копий запущена; status покажет результат.')


def probe():
    validate_config()
    with tempfile.TemporaryDirectory(dir=STATE) as temporary:
        file = pathlib.Path(temporary) / 'probe'
        file.write_bytes(secrets.token_bytes(64))
        destination = REMOTE + '_connection-probe'
        rclone('copyto', str(file), destination)
        if rclone('cat', destination) != file.read_bytes():
            raise Failure('Проверка расшифрования не прошла')
    # A fixed 64-byte encrypted probe is intentionally kept; no remote deletions.
    atomic(STATE / 'status.json', {'configured': True, 'provider': 'yandex', 'tested_at': now()})


def sync():
    validate_config()
    receipts = STATE / 'receipts'
    receipts.mkdir(mode=0o700, exist_ok=True)
    status = json.loads((STATE / 'status.json').read_text()) if (STATE / 'status.json').exists() else {}
    status.update(configured=True, provider='yandex', last_attempt=now(), error=None)
    atomic(STATE / 'status.json', status)
    try:
        # Newest first: a large backlog must not delay protection of today's state.
        for path in sorted(BACKUPS.iterdir(), reverse=True):
            if not IDENTIFIER.fullmatch(path.name):
                continue
            receipt = receipts / (path.name + '.json')
            if receipt.exists():
                continue
            try:
                row = json.loads((path / 'metadata.json').read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                continue
            if row.get('complete') is not True or row.get('verified') is not True:
                continue
            with tempfile.TemporaryDirectory(dir=STATE) as temporary:
                # Private staging remains stable if local retention removes a copy.
                source = pathlib.Path(temporary) / path.name
                source.mkdir(mode=0o700)
                try:
                    for name in FILES:
                        shutil.copyfile(path / name, source / name, follow_symlinks=False)
                    shutil.copyfile(path / 'metadata.json', source / 'metadata.json')
                except FileNotFoundError:
                    continue
                inspect(source)
                remote = REMOTE + path.name
                rclone('copy', str(source), remote, '--ignore-times')
                # Read every uploaded byte through crypt and compare with local data.
                rclone('check', str(source), remote, '--download', '--one-way')
                value = {'id': path.name, 'uploaded_at': now(), 'verified_download': True}
                marker = pathlib.Path(temporary) / 'complete.json'
                marker.write_text(json.dumps(value))
                rclone('copyto', str(marker), remote + '/_COMPLETE.json')
                if json.loads(rclone('cat', remote + '/_COMPLETE.json')) != value:
                    raise Failure('Маркер завершения не подтверждён')
                atomic(receipt, value)
                status.update(last_success=now(), last_backup_id=path.name, error=None)
                atomic(STATE / 'status.json', status)
        print('Проверенные локальные копии отправлены. Удаление файлов Яндекс Диска не выполняется.')
    except Exception:
        status.update(error='Не удалось отправить и проверить внешнюю копию. Локальные копии сохранены.')
        atomic(STATE / 'status.json', status)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'test', 'sync', 'status'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Failure('Запустите от root через sudo')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if args.command == 'status':
        print((STATE / 'status.json').read_text() if (STATE / 'status.json').exists() else '{"configured":false}')
        return
    with open(STATE / 'lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure('Внешнее копирование уже выполняется') from None
        if args.command == 'setup':
            setup()
        elif args.command == 'test':
            probe()
            enable()
        elif args.command == 'sync':
            sync()


if __name__ == '__main__':
    try:
        main()
    except Failure as error:
        print(str(error))
        raise SystemExit(1)
    except (ValueError, OSError):
        print('Операция не завершена. Проверьте настройки, сеть, место и статус службы. Секреты не выводятся.')
        raise SystemExit(1)
