import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PureWindowsPath

from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from prepare_docker_runtime import ConfigError, render_config


class RuntimeConfigurationTests(unittest.TestCase):
    root = PureWindowsPath(r'D:\AI project\apps\api')

    def values(self):
        return {
            'RAG_DATABASE_URL': 'postgresql+psycopg://demo:p%40ss@127.0.0.1:5433/carebrief?sslmode=prefer',
            'DATABASE_URL': 'sqlite:///D:/AI project/apps/api/.cache/carebrief.db',
            'CONTEXT_SUMMARY_DB': r'D:\AI project\apps\api\.cache\context_summaries.sqlite3',
            'WORKSPACE_ROOT': r'.cache\workspace',
            'DEEPSEEK_API_KEY': 'fake-quote"-hash#-slash\\value',
            'CRAWL4AI_PYTHON': r'C:\separate\python.exe',
            'CRAWL4AI_ENABLED': 'true',
        }

    def test_credentials_preserved_while_database_endpoint_changes(self):
        raw, quoted, _ = render_config(self.values(), self.root, 'rag-db')
        parsed = dotenv_values(stream=io.StringIO(quoted), interpolate=False)
        url = make_url(parsed['RAG_DATABASE_URL'])
        self.assertEqual((url.host, url.port, url.password), ('rag-db', 5432, 'p@ss'))
        self.assertEqual(url.query['sslmode'], 'prefer')
        self.assertIn('rag-db:5432', raw)

    def test_existing_sqlite_summary_and_workspace_use_mounted_directories(self):
        _, quoted, _ = render_config(self.values(), self.root, 'rag-db')
        parsed = dotenv_values(stream=io.StringIO(quoted), interpolate=False)
        self.assertEqual(make_url(parsed['DATABASE_URL']).database, '/app/.cache/carebrief.db')
        self.assertEqual(parsed['CONTEXT_SUMMARY_DB'], '/app/.cache/context_summaries.sqlite3')
        self.assertEqual(parsed['WORKSPACE_ROOT'], '/app/.cache/workspace')
        self.assertEqual(parsed['CRAWL4AI_ENABLED'], 'false')

    def test_secret_content_survives_both_serialization_formats(self):
        values = self.values()
        raw, quoted, _ = render_config(values, self.root, 'rag-db')
        docker_values = dict(row.split('=', 1) for row in raw.splitlines())
        dotenv_values_result = dotenv_values(stream=io.StringIO(quoted), interpolate=False)
        self.assertEqual(docker_values['DEEPSEEK_API_KEY'], values['DEEPSEEK_API_KEY'])
        self.assertEqual(dotenv_values_result['DEEPSEEK_API_KEY'], values['DEEPSEEK_API_KEY'])

    def test_external_storage_is_not_silently_relocated(self):
        values = self.values()
        values['CONTEXT_SUMMARY_DB'] = r'C:\external\summary.sqlite3'
        with self.assertRaisesRegex(ConfigError, 'CONTEXT_SUMMARY_DB'):
            render_config(values, self.root, 'rag-db')

    def test_multiline_secret_is_rejected_without_exposing_it(self):
        values = self.values()
        values['DEEPSEEK_API_KEY'] = 'fake-private\nsecond-line'
        with self.assertRaises(ConfigError) as error:
            render_config(values, self.root, 'rag-db')
        self.assertNotIn('fake-private', str(error.exception))

    def test_parent_paths_and_root_sqlite_need_explicit_mounts(self):
        for path in ('../outside.db', 'carebrief.db'):
            values = self.values()
            values['DATABASE_URL'] = 'sqlite:///' + path
            with self.assertRaises(ConfigError):
                render_config(values, self.root, 'rag-db')

    def test_relative_windows_summary_path_is_translated(self):
        values = self.values()
        values['CONTEXT_SUMMARY_DB'] = r'.cache\context_summaries.sqlite3'
        _, quoted, _ = render_config(values, self.root, 'rag-db')
        parsed = dotenv_values(stream=io.StringIO(quoted), interpolate=False)
        self.assertEqual(parsed['CONTEXT_SUMMARY_DB'], '/app/.cache/context_summaries.sqlite3')

    def test_cli_preserves_source_and_writes_private_configuration_without_secret_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'data').mkdir()
            (root / 'data' / 'knowledge.json').write_text('[]', encoding='utf-8')
            source = ('RAG_DATABASE_URL=postgresql+psycopg://demo:fake-pass@127.0.0.1:5433/carebrief\n'
                      'DEEPSEEK_API_KEY=fake-private-key\n')
            (root / '.env').write_text(source, encoding='utf-8')
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name('prepare_docker_runtime.py')),
                 '--api-root', str(root)], text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('fake-pass', result.stdout + result.stderr)
            self.assertNotIn('fake-private-key', result.stdout + result.stderr)
            self.assertEqual((root / '.env').read_text(encoding='utf-8'), source)
            generated = root / '.cache' / 'docker-runtime'
            self.assertTrue((generated / 'api.env').is_file())
            self.assertTrue((generated / 'api.dotenv').is_file())


if __name__ == '__main__':
    unittest.main()
