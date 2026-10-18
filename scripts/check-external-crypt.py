#!/usr/bin/env python3
"""Disposable local rclone crypt round-trip; no account/network credentials."""
import importlib.util
import pathlib
import tempfile

spec = importlib.util.spec_from_file_location('yandex', pathlib.Path(__file__).resolve().parents[1] / 'deploy/external-backup/yandex.py')
y = importlib.util.module_from_spec(spec)
spec.loader.exec_module(y)

with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    source = root / 'source'
    source.mkdir()
    payload = b'NOVA-disposable-private-config-' * 40000
    (source / 'environment').write_bytes(payload)
    ciphertext = root / 'encrypted'
    y.CONFIG = root / 'rclone.conf'
    password = y.obscure('disposable test phrase with spaces 123456789')
    y.CONFIG.write_text('[nova-crypt]\ntype = crypt\nremote = ' + str(ciphertext) + '\nfilename_encryption = standard\ndirectory_name_encryption = true\npassword = ' + password + '\n')
    y.CONFIG.chmod(0o600)
    y.rclone('copy', str(source), 'nova-crypt:copy')
    y.rclone('check', str(source), 'nova-crypt:copy', '--download', '--one-way')
    assert y.rclone('cat', 'nova-crypt:copy/environment') == payload
    encrypted_files = [p for p in ciphertext.rglob('*') if p.is_file()]
    assert len(encrypted_files) == 1
    encrypted = encrypted_files[0]
    assert encrypted.name != 'environment' and b'NOVA-disposable' not in encrypted.read_bytes()
    # Recreate the config from the saved phrase, not its obscured representation.
    y.CONFIG.write_text(y.CONFIG.read_text().replace(password, y.obscure('disposable test phrase with spaces 123456789')))
    assert y.rclone('cat', 'nova-crypt:copy/environment') == payload
    damaged = bytearray(encrypted.read_bytes())
    damaged[-1] ^= 1
    encrypted.write_bytes(damaged)
    try:
        y.rclone('check', str(source), 'nova-crypt:copy', '--download', '--one-way')
    except y.Failure:
        pass
    else:
        raise AssertionError('Damaged encrypted file was accepted')
print('crypt round-trip, name/content encryption, saved phrase recovery and corruption rejection: OK')
