from dataclasses import dataclass, field
from pathlib import Path
import os
from dotenv import load_dotenv
from .source_registry import OFFICIAL_SITES

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


@dataclass
class Settings:
    mode: str = field(default_factory=lambda: os.getenv("PROVIDER_MODE", "demo"))
    deepseek_key: str = field(default_factory=lambda: os.getenv("DEEPSEEK_API_KEY", ""))
    deepseek_base: str = field(
        default_factory=lambda: os.getenv(
            "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
        ).rstrip("/")
    )
    chat_model: str = field(
        default_factory=lambda: os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
    )
    disable_thinking: bool = field(
        default_factory=lambda: os.getenv("DEEPSEEK_DISABLE_THINKING", "true").lower()
        == "true"
    )
    embedding_key: str = field(
        default_factory=lambda: os.getenv("SILICONFLOW_API_KEY", "")
    )
    embedding_base: str = field(
        default_factory=lambda: os.getenv(
            "SILICONFLOW_BASE_URL", "https://api.siliconflow.com/v1"
        ).rstrip("/")
    )
    embedding_model: str = field(
        default_factory=lambda: os.getenv(
            "EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-0.6B"
        )
    )
    rag_backend: str = field(default_factory=lambda: os.getenv("RAG_BACKEND", "json"))
    dimensions: int = field(
        default_factory=lambda: int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))
    )
    timeout: float = field(
        default_factory=lambda: float(os.getenv("API_TIMEOUT_SECONDS", "30"))
    )
    history_max_turns: int = field(
        default_factory=lambda: int(os.getenv("HISTORY_MAX_TURNS", "6"))
    )

    history_max_chars: int = field(
        default_factory=lambda: int(os.getenv("HISTORY_MAX_CHARS", "6000"))
    )
    retrieval_min_score: float = field(
        default_factory=lambda: float(os.getenv("RETRIEVAL_MIN_SCORE", "0.2"))
    )
    dev_token: str = field(default_factory=lambda: os.getenv("DEV_TOKEN", ""))
    knowledge_path: Path = ROOT / "data" / "knowledge.json"
    index_path: Path = ROOT / ".cache" / "vectors.json"
    log_path: Path = ROOT / ".cache" / "events.jsonl"
    cors: list[str] = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    )
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", "sqlite:///" + (ROOT / ".cache" / "carebrief.db").as_posix()
        )
    )
    cookie_secure: bool = field(
        default_factory=lambda: os.getenv("COOKIE_SECURE", "false").lower() == "true"
    )
    ocr_enabled: bool = field(
        default_factory=lambda: os.getenv("OCR_ENABLED", "false").lower() == "true"
    )
    external_enabled: bool = field(
        default_factory=lambda: os.getenv("EXTERNAL_SEARCH_ENABLED", "false").lower()
        == "true"
    )
    bocha_key: str = field(default_factory=lambda: os.getenv("BOCHA_API_KEY", ""))
    bocha_url: str = field(
        default_factory=lambda: os.getenv(
            "BOCHA_SEARCH_URL", "https://api.bochaai.com/v1/web-search"
        )
    )
    external_domains: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            host.strip().lower()
            for host in os.getenv(
                "EXTERNAL_DOMAINS",
                ",".join(OFFICIAL_SITES),
            ).split(",")
            if host.strip()
        )
    )

    def __post_init__(self):
        if self.mode not in {"demo", "live"}:
            raise ValueError("PROVIDER_MODE must be demo or live")

        if self.history_max_turns < 1 or self.history_max_chars < 1:
            raise ValueError("History limits must be positive")
        if not 0 <= self.retrieval_min_score <= 1:
            raise ValueError("RETRIEVAL_MIN_SCORE must be between 0 and 1")
        if self.rag_backend not in {"json", "postgres"}:
            raise ValueError("RAG_BACKEND must be json or postgres")
