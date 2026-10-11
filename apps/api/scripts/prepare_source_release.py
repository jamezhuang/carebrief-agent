"""Copy an allowlisted source release into a separate Git checkout; never push."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url


SKIP_DIRS = {
    '.git', '.git-backup', '.cache', '.pytest_cache', '__pycache__',
    '.venv', 'node_modules', '.next', 'uploads', 'private_uploads',
    'user_uploads', 'private_data', 'health_records', 'backups',
    'browser_profiles', 'results', 'eval_runs',
}
BACKUP_NAME = re.compile(r'(?:^|[._-])(?:bak|backup|old|copy)(?:[._-]|$)', re.I)
SECRET_NAME = re.compile(r'(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)', re.I)
TOKEN = re.compile(r'\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b')
LOCAL_PATH = re.compile(r'(?<![A-Za-z0-9+._-])[A-Za-z]:[\\/]')
CREDENTIAL_CONTEXT = re.compile(r'\b(?:password|passwd|pwd|database_url|rag_database_url)\b[\"\x27]?\s*[:=]|\bpostgres(?:ql)?(?:\+[a-z0-9_]+)?://', re.I)
API_SUFFIXES = {'.py', '.sql', '.html', '.j2', '.jinja2'}
WEB_SUFFIXES = {'.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.json', '.svg'}
MAX_SIZE = 5 * 1024 * 1024


def skip(relative: Path) -> bool:
    return any(p in SKIP_DIRS or p.startswith(('.cache-', '.venv-')) for p in relative.parts) or bool(BACKUP_NAME.search(relative.name))


def collect(root: Path):
    chosen = set()
    for folder, suffixes in (
        ('apps/api/app', API_SUFFIXES), ('apps/api/scripts', API_SUFFIXES),
        ('apps/api/tests', API_SUFFIXES), ('apps/web/app', WEB_SUFFIXES),
        ('apps/web/lib', WEB_SUFFIXES), ('apps/web/components', WEB_SUFFIXES),
    ):
        directory = root / folder
        if not directory.is_dir():
            continue
        # Prune excluded directories before descending into them.
        import os
        for parent, directories, files in os.walk(directory, followlinks=False):
            directories[:] = [name for name in directories
                              if not skip((Path(parent) / name).relative_to(root))
                              and not (Path(parent) / name).is_symlink()]
            for name in files:
                path = Path(parent) / name
                relative = path.relative_to(root)
                if not skip(relative) and path.suffix.lower() in suffixes:
                    chosen.add(relative)
    explicit = [
        'ARCHITECTURE.md', 'VALIDATION.md', 'LICENSE', 'compose.yaml',
        'compose.rag.yml', 'Start-Api.ps1', 'Start-Web.ps1', '.env.example',
        'apps/api/Dockerfile', 'apps/api/.dockerignore',
        'apps/api/data/knowledge.json', 'apps/web/Dockerfile',
        'apps/web/.dockerignore', 'apps/web/.env.local.example',
        'apps/web/package.json', 'apps/web/package-lock.json',
        'apps/web/tsconfig.json', 'apps/web/next-env.d.ts',
    ]
    for pattern in ('requirements*.txt', '*.env.example'):
        explicit.extend(str(p.relative_to(root)) for p in (root / 'apps/api').glob(pattern))
    for pattern in ('next.config.*', 'postcss.config.*', 'tailwind.config.*', 'eslint.config.*'):
        explicit.extend(str(p.relative_to(root)) for p in (root / 'apps/web').glob(pattern))
    for name in explicit:
        if (root / name).is_file():
            chosen.add(Path(name))
    return sorted(chosen, key=lambda p: p.as_posix())


def sensitive_values(root: Path):
    values = set()
    passwords = set()
    for name in ('.env', 'apps/api/.env', 'apps/web/.env.local'):
        path = root / name
        if not path.is_file():
            continue
        for key, value in dotenv_values(path, encoding='utf-8-sig').items():
            if value and SECRET_NAME.search(key):
                if re.search(r'PASSWORD|PASSWD', key, re.I):
                    passwords.add(value)
                elif len(value) >= 8:
                    values.add(value)
            if value and value.startswith(('postgresql', 'postgres://', 'sqlite')):
                try:
                    password = make_url(value).password
                    if password:
                        passwords.add(password)
                except Exception:
                    pass
    return {'values': values, 'passwords': passwords}


def inspect_file(relative: Path, payload: bytes, secrets):
    if len(payload) > MAX_SIZE:
        return [{'file': relative.as_posix(), 'reason': 'file_over_5MiB'}], []
    try:
        text = payload.decode('utf-8-sig')
    except UnicodeDecodeError:
        return [{'file': relative.as_posix(), 'reason': 'not_utf8_text'}], []
    blockers, review = [], []
    values = secrets.get('values', set()) if isinstance(secrets, dict) else secrets
    passwords = secrets.get('passwords', set()) if isinstance(secrets, dict) else set()
    for number, line in enumerate(text.splitlines(), 1):
        # Reports contain locations only; never log matched content or secrets.
        password_found = CREDENTIAL_CONTEXT.search(line) and any(value in line for value in passwords)
        if TOKEN.search(line) or any(value in line for value in values) or password_found:
            blockers.append({'file': relative.as_posix(), 'line': number, 'reason': 'possible_credential'})
        if LOCAL_PATH.search(line):
            review.append({'file': relative.as_posix(), 'line': number, 'reason': 'windows_path_review'})
    return blockers, review


def prepare(root: Path, output: Path):
    root, output = root.resolve(), output.resolve()
    if output == root or root in output.parents or output in root.parents:
        raise ValueError('Release checkout must be separate from the working project.')
    if not (output / '.git').is_dir():
        raise ValueError('Output must be a separate cloned Git checkout.')
    required = ('apps/api/app/main.py', 'apps/api/requirements.txt',
                'apps/api/data/knowledge.json', 'apps/web/package.json',
                'apps/web/package-lock.json')
    for name in required:
        if not (root / name).is_file():
            raise ValueError(f'Required source file missing: {name}')
    selected = collect(root)
    secrets = sensitive_values(root)
    blockers, review, payloads = [], [], {}
    preserve = {'README.md', '.gitignore', 'apps/api/Dockerfile', 'apps/api/.dockerignore',
                'apps/web/Dockerfile', 'apps/web/.dockerignore', 'compose.yaml',
                'apps/api/scripts/prepare_docker_runtime.py',
                'apps/api/scripts/start_docker_api.ps1',
                'apps/api/scripts/prepare_source_release.py',
                'apps/api/scripts/test_prepare_source_release.py'}
    for relative in selected:
        path = root / relative
        if path.is_symlink() or root not in path.resolve().parents:
            blockers.append({'file': relative.as_posix(), 'reason': 'symlink_or_external_file'})
            continue
        destination = output / relative
        if output not in destination.resolve().parents:
            blockers.append({'file': relative.as_posix(), 'reason': 'unsafe_destination'})
            continue
        if relative.as_posix() in preserve and destination.exists():
            continue
        payload = path.read_bytes()
        issues, notes = inspect_file(relative, payload, secrets)
        blockers.extend(issues)
        review.extend(notes)
        payloads[relative] = payload
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    report_path = root / '.cache' / 'release-review' / f'{stamp}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        'status': 'blocked' if blockers else 'prepared',
        'files': [{'path': p.as_posix(), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
                  for p, b in payloads.items()],
        'blockers': blockers, 'review': review,
        'public_data_pending': [
            'apps/api/data/knowledge_catalog.json', 'apps/api/data/knowledge_sources.json',
            'apps/api/data/seeds', 'apps/api/data/knowledge_raw',
        ],
        'note': 'Automated scanning does not establish absence of personal data or redistribution permission.',
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if blockers:
        return report, report_path
    for relative, payload in payloads.items():
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
    return report, report_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report, path = prepare(args.source, args.output)
    print('Status:', report['status'])
    print('Source files:', len(report['files']))
    print('Blocked locations:', len(report['blockers']))
    print('Windows path review locations:', len(report['review']))
    print('Local review report:', path)
    print('No commit or push performed. Public catalogs and extra assets remain pending review.')
    if report['blockers']:
        for issue in report['blockers'][:20]:
            print(issue['file'], 'line', issue.get('line', '-'), issue['reason'])
        return 2
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except ValueError as error:
        print('Release preparation error:', error, file=sys.stderr)
        raise SystemExit(2) from None
