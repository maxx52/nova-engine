"""CI only: disposable Docker deployment with localhost TLS; never run against a live site."""
import http.cookiejar
import json
import os
import ssl
import urllib.error
import urllib.request

context = ssl.create_default_context(cafile=os.environ['NOVA_TEST_CA'])
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(jar))
base = 'https://localhost'


def request(path, data=None, expected=200):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(base + path, data=body, headers={'Content-Type': 'application/json', 'Origin': base, 'X-Nova-Request': '1'})
    try:
        response = client.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    assert response.code == expected, (path, response.code, expected)
    return response, response.read()


if os.environ.get('NOVA_TEST_RESTART'):
    _, body = request('/api/auth/status')
    assert json.loads(body)['setup_required'] is False
    print('PASS administrator persists after container restart')
else:
    _, body = request('/api/auth/status')
    assert json.loads(body)['setup_required'] is True
    request('/api/admin/packages', expected=401)
    for path in ['/', '/admin/']:
        response, body = request(path)
        assert b'<div id="app">' in body
        assert "script-src 'self'" in response.headers['Content-Security-Policy']
    for path in ['/api/code-frame', '/api/payment-frame']:
        response, _ = request(path)
        policies = response.headers.get_all('Content-Security-Policy')
        assert len(policies) == 1 and 'sandbox allow-scripts' in policies[0]
        assert 'allow-same-origin' not in policies[0]
    response, body = request('/api/auth/setup', {'username': 'ci_admin', 'password': 'ci-only-disposable-password-8241', 'setup_key': os.environ['ADMIN_API_KEY']}, 201)
    assert 'Secure' in response.headers['Set-Cookie'] and 'HttpOnly' in response.headers['Set-Cookie']
    request('/api/auth/me')
    _, body = request('/api/admin/packages/examples')
    assert b'nova-studio' in body and b'contact-page' in body
    print('PASS Docker database role, HTTPS, static apps, sandbox headers, admin setup/session and packaged examples')
