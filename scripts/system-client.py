#!/usr/bin/env python3
"""Local operator CLI; the daemon independently validates every command."""
import argparse
import http.client
import json
import socket

parser = argparse.ArgumentParser()
parser.add_argument('--socket', default='/run/nova-updater/agent.sock')
parser.add_argument('command', choices=['status', 'check', 'backup', 'verify', 'update', 'restore', 'schedule'])
parser.add_argument('value', nargs='?')
parser.add_argument('--confirm', default='')
parser.add_argument('--enabled', action='store_true')
parser.add_argument('--hour-utc', type=int, default=3)
parser.add_argument('--retention-days', type=int, choices=[7, 14, 30], default=7)
args = parser.parse_args()
connection = http.client.HTTPConnection('localhost', timeout=10)
connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
connection.sock.connect(args.socket)
if args.command == 'status':
    connection.request('GET', '/status')
else:
    value = {'kind': args.command}
    if args.command == 'update':
        value['version'] = args.value
    if args.command in ('verify', 'restore'):
        value['backup_id'] = args.value
    if args.command == 'restore':
        value['confirm'] = args.confirm
    if args.command == 'schedule':
        value.update(enabled=args.enabled, hour_utc=args.hour_utc, retention_days=args.retention_days)
    connection.request('POST', '/jobs', json.dumps(value).encode(), {'content-type': 'application/json'})
response = connection.getresponse()
print(json.dumps(json.loads(response.read()), ensure_ascii=False, indent=2))
raise SystemExit(0 if response.status < 400 else 1)
