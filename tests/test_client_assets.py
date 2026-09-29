"""HTTP asset transport tests; no XR session, DDS or robot control is started."""

import gzip
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from televuer import TeleVuer


class ClientAssetTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        assets = self.root / 'assets'
        assets.mkdir()
        self.javascript = b'const message = "XR frontend";\n' * 40000
        (assets / 'client.js').write_bytes(self.javascript)
        (assets / 'style.css').write_text('body { color: white; }')
        self.server = TeleVuer.__new__(TeleVuer)
        self.server.vuer = SimpleNamespace(client_root=self.root)
        app = web.Application()
        app.router.add_get('/assets/{path:.*}', self.server._client_asset)
        self.client = TestClient(TestServer(app), auto_decompress=False)
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_gzip_transfer_is_complete_and_smaller(self) -> None:
        response = await self.client.get('/assets/client.js', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers['Content-Encoding'], 'gzip')
        self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
        body = await response.read()
        self.assertEqual(gzip.decompress(body), self.javascript)
        self.assertLess(len(body), len(self.javascript) // 2)
        self.assertEqual(int(response.headers['Content-Length']), len(body))

    async def test_identity_transfer_is_unchanged(self) -> None:
        response = await self.client.get('/assets/client.js', headers={'Accept-Encoding': 'identity'})
        self.assertEqual(response.status, 200)
        self.assertNotIn('Content-Encoding', response.headers)
        self.assertEqual(await response.read(), self.javascript)

    async def test_stylesheet_mime_type(self) -> None:
        response = await self.client.get('/assets/style.css', headers={'Accept-Encoding': 'identity'})
        self.assertEqual(response.content_type, 'text/css')
        self.assertEqual(await response.text(), 'body { color: white; }')

    async def test_missing_asset(self) -> None:
        response = await self.client.get('/assets/missing.js')
        self.assertEqual(response.status, 404)

    async def test_cannot_read_outside_assets(self) -> None:
        (self.root / 'private.js').write_text('private')
        for name in ('../private.js', str(self.root / 'private.js')):
            request = make_mocked_request('GET', '/', match_info={'path': name})
            with self.assertRaises(web.HTTPNotFound):
                await self.server._client_asset(request)
        (self.root / 'assets' / 'link.js').symlink_to(self.root / 'private.js')
        response = await self.client.get('/assets/link.js')
        self.assertEqual(response.status, 404)


if __name__ == '__main__':
    unittest.main()
