from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.gateway.deps import get_config
from deerflow.config.app_config import AppConfig
from deerflow.config.sandbox_config import SandboxConfig


def test_get_config_reloads_and_updates_app_state(monkeypatch):
    """get_config should prefer the current file-backed AppConfig."""
    app = FastAPI()
    startup_config = AppConfig(sandbox=SandboxConfig(use="test"), log_level="info")
    reloaded_config = AppConfig(sandbox=SandboxConfig(use="test"), log_level="debug")
    app.state.config = startup_config
    monkeypatch.setattr("app.gateway.deps.get_app_config", lambda: reloaded_config)

    @app.get("/probe")
    def probe(cfg: AppConfig = Depends(get_config)):
        return {"same_identity": cfg is reloaded_config, "log_level": cfg.log_level}

    client = TestClient(app)
    response = client.get("/probe")

    assert response.status_code == 200
    assert response.json() == {"same_identity": True, "log_level": "debug"}
    assert app.state.config is reloaded_config


def test_get_config_falls_back_to_app_state_when_reload_fails(monkeypatch):
    """A reload failure should not break a running gateway with startup config."""
    app = FastAPI()
    app.state.config = AppConfig(sandbox=SandboxConfig(use="test"), log_level="info")
    monkeypatch.setattr("app.gateway.deps.get_app_config", lambda: (_ for _ in ()).throw(RuntimeError("reload failed")))

    @app.get("/log-level")
    def log_level(cfg: AppConfig = Depends(get_config)):
        return {"level": cfg.log_level}

    client = TestClient(app)
    assert client.get("/log-level").json() == {"level": "info"}
