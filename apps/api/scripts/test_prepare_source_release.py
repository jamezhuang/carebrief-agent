import json
import tempfile
import unittest
from pathlib import Path

from prepare_source_release import inspect_file, prepare


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.source, self.output = base / 'project', base / 'release'
        self.source.mkdir()
        (self.output / '.git').mkdir(parents=True)
        for name, text in {
            'apps/api/app/main.py': '# application\n',
            'apps/api/requirements.txt': 'httpx==0.28.1\n',
            'apps/api/data/knowledge.json': '[]',
            'apps/web/package.json': '{}',
            'apps/web/package-lock.json': '{}',
            'apps/web/app/page.tsx': 'export default function Page() {}',
        }.items():
            self.write(name, text)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, text):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def test_source_and_lockfile_copied_with_report_outside_checkout(self):
        report, path = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'prepared')
        self.assertTrue((self.output / 'apps/web/package-lock.json').is_file())
        self.assertTrue(path.is_relative_to(self.source / '.cache'))
        self.assertFalse((self.output / '.cache').exists())

    def test_private_files_backups_and_unreviewed_catalog_not_copied(self):
        for name in ('apps/api/app/.cache/private.py', 'apps/api/scripts/tool.bak.py',
                     'apps/api/data/sample-report.csv', 'apps/api/data/knowledge_catalog.json',
                     'apps/api/.env', 'apps/web/.env.local', 'apps/web/node_modules/tool.js'):
            self.write(name, 'private')
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'prepared')
        for name in ('apps/api/.env', 'apps/web/.env.local', 'apps/api/data/knowledge_catalog.json',
                     'apps/api/scripts/tool.bak.py', 'apps/api/app/.cache/private.py'):
            self.assertFalse((self.output / name).exists())

    def test_known_environment_key_blocks_all_writes_and_report_redacts_value(self):
        secret = 'example-private-key-1234567890'
        self.write('apps/api/.env', 'DEEPSEEK_API_KEY=' + secret)
        self.write('apps/api/app/bad.py', 'key = ' + repr(secret))
        report, path = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'blocked')
        self.assertFalse((self.output / 'apps/api/app/main.py').exists())
        self.assertNotIn(secret, path.read_text())
        self.assertEqual(report['blockers'][0]['line'], 1)

    def test_database_password_extracted_from_url(self):
        secret = 'private-db-pass-123'
        self.write('apps/api/.env', f'RAG_DATABASE_URL=postgresql+psycopg://user:{secret}@localhost:5433/db')
        self.write('compose.yaml', 'password: ' + secret)
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'blocked')

    def test_short_common_database_password_matches_credentials_not_project_name(self):
        self.write('apps/api/.env', 'RAG_DATABASE_URL=postgresql://demo:carebrief@localhost/db')
        self.write('apps/api/app/main.py', '# carebrief application\n')
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'prepared')
        self.write('compose.yaml', 'password: carebrief')
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'blocked')

    def test_existing_repository_dockerfile_not_overwritten(self):
        target = self.output / 'apps/api/Dockerfile'
        target.parent.mkdir(parents=True)
        target.write_text('reviewed Dockerfile')
        self.write('apps/api/Dockerfile', 'old Dockerfile')
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'prepared')
        self.assertEqual(target.read_text(), 'reviewed Dockerfile')

    def test_nested_or_non_checkout_destination_rejected(self):
        for target in (self.source / 'release', self.output.parent / 'not-a-checkout'):
            with self.assertRaises(ValueError):
                prepare(self.source, target)

    def test_symlink_file_cannot_import_external_contents(self):
        external = Path(self.temporary.name) / 'external.py'
        external.write_text('outside')
        try:
            (self.source / 'apps/api/app/linked.py').symlink_to(external)
        except OSError:
            self.skipTest('symlink unavailable')
        report, _ = prepare(self.source, self.output)
        self.assertEqual(report['status'], 'blocked')

    def test_token_pattern_and_windows_path_review_use_locations_only(self):
        token = 'sk-' + 'x' * 32
        issues, review = inspect_file(Path('app.py'), (token + '\nD:\\private\\report').encode(), set())
        serialized = json.dumps([issues, review])
        self.assertNotIn(token, serialized)
        self.assertNotIn('private', serialized)
        self.assertEqual(issues[0]['line'], 1)
        self.assertEqual(review[0]['line'], 2)


if __name__ == '__main__':
    unittest.main()
