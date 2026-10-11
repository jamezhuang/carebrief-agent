import tempfile
import unittest
from pathlib import Path

from dotenv import dotenv_values

from generate_env_example import generate


class ExampleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'app').mkdir()
        (self.root / 'app/config.py').write_text('import os\n'
            'a=os.getenv("PROVIDER_MODE", "demo")\n'
            'b=os.getenv("DEEPSEEK_API_KEY", "")\n'
            'c=os.getenv("DEEPSEEK_MODEL", "model-default")\n'
            'd=os.getenv("REQUEST_TIMEOUT", "30")\n'
            'e=os.getenv("CONTEXT_TOKEN_BUDGET", "18000")\n'
            'f=os.getenv("WORKSPACE_UPLOAD_DIR")\n', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def reference(self, text):
        path = self.root / '.env'
        path.write_text(text, encoding='utf-8')
        return path

    def test_credentials_identity_and_windows_paths_not_exported(self):
        path = self.reference('DEEPSEEK_API_KEY=private-real-value\n'
            'WORKSPACE_ADMIN_EMAILS=real-person@example.com\n'
            'WORKSPACE_UPLOAD_DIR=D:/private/uploads\n'
            'RAG_DATABASE_URL=postgresql://user:real-password@localhost/db\n')
        text, _ = generate(self.root, path)
        for value in ('private-real-value', 'real-person@example.com', 'D:/private', 'real-password'):
            self.assertNotIn(value, text)
        self.assertIn('DEEPSEEK_API_KEY=\n', text)

    def test_actual_public_model_name_preserved_and_numeric_defaults_valid(self):
        text, _ = generate(self.root, self.reference('DEEPSEEK_MODEL=actual-model\n'))
        self.assertIn('DEEPSEEK_MODEL=actual-model\n', text)
        self.assertIn('REQUEST_TIMEOUT=30\n', text)
        self.assertIn('CONTEXT_TOKEN_BUDGET=18000\n', text)

    def test_unknown_fields_are_commented_not_empty_numeric_overrides(self):
        text, _ = generate(self.root, self.reference('UNKNOWN_FIELD=private-unrecognized-value\n'))
        self.assertIn('# UNKNOWN_FIELD=', text)
        self.assertNotIn('private-unrecognized-value', text)
        self.assertIn('# WORKSPACE_UPLOAD_DIR=', text)

    def test_urls_with_auth_queries_or_private_hosts_not_exported(self):
        for url in ('https://user:password@api.deepseek.com',
                    'https://api.deepseek.com?key=private-value',
                    'https://private.company.example/v1'):
            text, _ = generate(self.root, self.reference('DEEPSEEK_BASE_URL=' + url))
            self.assertNotIn(url, text)

    def test_sample_parses_live_and_browser_off_without_changing_reference(self):
        from io import StringIO
        path = self.reference('PROVIDER_MODE=live\nDEEPSEEK_API_KEY=keep-original-secret\n')
        before = path.read_bytes()
        text, _ = generate(self.root, path)
        parsed = dotenv_values(stream=StringIO(text), interpolate=False)
        self.assertEqual(parsed['PROVIDER_MODE'], 'live')
        self.assertEqual(parsed['CRAWL4AI_ENABLED'], 'false')
        self.assertEqual(parsed['DEEPSEEK_API_KEY'], '')
        self.assertEqual(before, path.read_bytes())


if __name__ == '__main__':
    unittest.main()
