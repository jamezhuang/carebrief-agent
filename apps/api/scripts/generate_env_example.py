"""Generate a sanitized API configuration example using local source and key names."""
from __future__ import annotations

import argparse
import ast
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


SECRET = re.compile(r'(?:^|_)(?:API_KEY|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(?:$|_)|(?:^|_)TOKEN$', re.I)
IDENTITY = re.compile(r'EMAIL|PHONE|CONTACT|USERNAME|ACCOUNT', re.I)
DRIVE = re.compile(r'(?<![A-Za-z0-9+._-])[A-Za-z]:[\\/]')
NAME = re.compile(r'^[A-Z][A-Z0-9_]+$')
SCALAR = re.compile(r'^[A-Za-z0-9_.:/+,-]{1,200}$')
PATH_KEYS = re.compile(r'(?:PATH|DIR|ROOT|FILE|DB)$')


def source_defaults(root: Path):
    defaults = {}
    for path in sorted((root / 'app').rglob('*.py')):
        tree = ast.parse(path.read_text(encoding='utf-8-sig'), filename=path.name)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            method = node.func
            is_environment = (
                isinstance(method, ast.Attribute)
                and (method.attr == 'getenv' or (
                    method.attr == 'get' and isinstance(method.value, ast.Attribute)
                    and method.value.attr == 'environ'))
            )
            if not is_environment or not isinstance(node.args[0], ast.Constant):
                continue
            key = node.args[0].value
            if not isinstance(key, str) or not NAME.fullmatch(key):
                continue
            value = None
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                raw = node.args[1].value
                if isinstance(raw, (str, int, float, bool)):
                    value = str(raw).lower() if isinstance(raw, bool) else str(raw)
            if key not in defaults or defaults[key] is None:
                defaults[key] = value
    return defaults


def public_value(key: str, value):
    if value is None or value == '' or SECRET.search(key) or IDENTITY.search(key):
        return None
    value = str(value)
    if '\n' in value or '\r' in value or DRIVE.search(value) or value.startswith('\\\\'):
        return None
    if re.fullmatch(r'\d+(?:\.\d+)?', value) or value.lower() in {'true', 'false'}:
        return value
    if value.startswith(('https://', 'http://')):
        parts = urlsplit(value)
        # Copy only known public provider URLs, never credentials or URL queries.
        if (key.endswith(('BASE_URL', '_URL')) and parts.hostname in {
            'api.deepseek.com', 'api.siliconflow.cn', 'api.siliconflow.com',
            'api.bochaai.com', 'api.tavily.com', 'api.jina.ai',
        } and not parts.username and not parts.password and not parts.query and not parts.fragment):
            return value
        return None
    if key.endswith(('MODEL', '_MODE', '_BACKEND', '_PROVIDER')) and SCALAR.fullmatch(value):
        return value
    if key.endswith('_DOMAINS') and re.fullmatch(r'[A-Za-z0-9., -]+', value):
        return value
    return None


def generate(root: Path, config=None):
    defaults = source_defaults(root)
    actual = dotenv_values(config, encoding='utf-8-sig') if config and config.is_file() else {}
    keys = set(defaults) | {key for key in actual if NAME.fullmatch(key)}
    # These fields are already used by the checked-in Compose deployment.
    required = {'RAG_DATABASE_URL', 'DATABASE_URL', 'CORS_ORIGINS', 'CRAWL4AI_ENABLED'}
    keys |= required
    overrides = {
        'PROVIDER_MODE': 'live',
        'RAG_DATABASE_URL': 'postgresql+psycopg://carebrief:CHANGE_ME@127.0.0.1:5433/carebrief_rag',
        'DATABASE_URL': 'sqlite:///.cache/carebrief.db',
        'CORS_ORIGINS': 'http://127.0.0.1:3100,http://localhost:3100',
        'CRAWL4AI_ENABLED': 'false',
    }
    groups = {'core': [], 'models': [], 'search': [], 'workspace': [], 'context': [], 'other': []}
    for key in sorted(keys):
        if key == 'RAG_POSTGRES_PASSWORD':
            line = '# RAG_POSTGRES_PASSWORD=  # Only for standalone compose.rag.yml'
        elif key in overrides:
            line = f'{key}={overrides[key]}'
        elif SECRET.search(key) and not key.startswith('CRAWL4AI_'):
            # Blank optional secrets let the application report missing_key.
            line = f'{key}='
        elif IDENTITY.search(key) or key.startswith('CRAWL4AI_') or PATH_KEYS.search(key):
            line = f'# {key}=  # Keep application default; configure explicitly if needed'
        else:
            value = public_value(key, actual.get(key))
            if value is None:
                value = public_value(key, defaults.get(key))
            line = f'{key}={value}' if value is not None else f'# {key}=  # Optional; keep application default'
        if key in overrides:
            group = 'core'
        elif key.startswith(('CONTEXT_', 'HISTORY_')):
            group = 'context'
        elif key.startswith(('WORKSPACE_', 'HEALTH_MEMORY_')):
            group = 'workspace'
        elif any(word in key for word in ('DEEPSEEK', 'EMBEDDING', 'SILICONFLOW', 'CHAT_MODEL', 'RERANK')):
            group = 'models'
        elif any(word in key for word in ('BOCHA', 'TAVILY', 'JINA', 'WEB_', 'EXTERNAL_', 'CRAWL4AI')):
            group = 'search'
        else:
            group = 'other'
        groups[group].append(line)
    header = [
        '# CareBrief API configuration example. Copy to apps/api/.env.',
        '# Generated from source fields; private credential values are never copied.',
        '# Fill the chat and embedding API keys before using live mode.',
        '# Optional web search keys are needed only for the enabled search service.',
        '# Docker Compose overrides RAG_DATABASE_URL, DATABASE_URL and key storage paths.',
        '# The local RAG URL below is a placeholder; replace CHANGE_ME for native development.',
        '# Do not change commented fields unless you understand their code defaults.',
        '# Core Docker image does not include browser rendering or OCR dependencies.',
    ]
    for title, lines in groups.items():
        if lines:
            header.extend(['', '# ' + title.upper(), *lines])
    return '\n'.join(header) + '\n', len(keys)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-root', type=Path, required=True)
    parser.add_argument('--reference-env', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.api_root.resolve()
    destination = args.output.resolve()
    if not (root / 'app/config.py').is_file():
        parser.error('API source config.py is missing')
    if destination.name != '.env.example':
        parser.error('Output must be named .env.example; actual .env will never be overwritten')
    if destination.exists():
        parser.error('Example already exists; keep or back it up before generating again')
    text, count = generate(root, args.reference_env)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text, encoding='utf-8')
    print('API example created:', destination)
    print('Configuration fields:', count)
    print('Private key/password/email values copied: 0')
    print('Optional and storage fields remain commented to preserve code defaults.')


if __name__ == '__main__':
    main()
