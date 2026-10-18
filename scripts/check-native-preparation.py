"""CI only: exercise the actual protected systemd preparation path on a disposable VM."""
import grp
import json
import os
import pathlib
import pwd
import shutil
import subprocess
import sys
import tempfile
import uuid

if os.geteuid() != 0:
    raise SystemExit('This isolated infrastructure test requires sudo')
user = pwd.getpwnam(sys.argv[1])
if user.pw_uid == 0:
    raise SystemExit('Pass a non-root CI user')
with tempfile.TemporaryDirectory(prefix='nova-native-test-', dir='/srv') as folder:
    root = pathlib.Path(folder)
    root.chmod(0o755)
    for name in ('app', 'outside', 'state'):
        (root / name).mkdir()
    for name in ('app', 'outside'):
        os.chown(root / name, user.pw_uid, user.pw_gid)
    shutil.copyfile('deploy/updater/agent.py', root / 'agent.py')
    child = '\n'.join([
        'import os,pathlib',
        'assert os.getuid() == ' + str(user.pw_uid),
        'pathlib.Path(' + repr(str(root / 'app/prepared')) + ').write_text("ok")',
        'try:',
        ' pathlib.Path(' + repr(str(root / 'outside/forbidden')) + ').write_text("bad")',
        'except OSError: pass',
        'else: raise AssertionError("preparation can write outside its staging directory")',
    ])
    config = {'app_user': user.pw_name, 'app_group': grp.getgrgid(user.pw_gid).gr_name}
    program = '\n'.join([
        'import importlib.util,pathlib,json',
        's=importlib.util.spec_from_file_location("manager",' + repr(str(root / 'agent.py')) + ')',
        'a=importlib.util.module_from_spec(s);s.loader.exec_module(a)',
        'm=object.__new__(a.Manager)',
        'm.config=' + repr(config),
        'm.root=pathlib.Path(' + repr(str(root / 'state')) + ')',
        'm.run_unprivileged(["/usr/bin/python3","-c",' + repr(child) + '], pathlib.Path(' + repr(str(root / 'app')) + '), timeout=60)',
    ])
    (root / 'check.py').write_text(program)
    result = subprocess.run([
        'systemd-run', '--wait', '--pipe', '--collect', '--quiet',
        '--unit=nova-manager-ci-' + uuid.uuid4().hex,
        '--property=NoNewPrivileges=yes', '--property=ProtectSystem=full',
        '--property=ProtectHome=yes', '--property=ProtectControlGroups=yes',
        '--property=ProtectKernelTunables=yes', '--property=ProtectKernelModules=yes',
        '--', '/usr/bin/python3', str(root / 'check.py')
    ], timeout=120)
    if result.returncode:
        print((root / 'state/worker.log').read_text() if (root / 'state/worker.log').exists() else 'No manager log')
        raise SystemExit(result.returncode)
    assert (root / 'app/prepared').read_text() == 'ok'
    assert not (root / 'outside/forbidden').exists()
print('PASS native systemd preparation: non-root UID, writable staging, read-only outside, bounded service lifecycle')
