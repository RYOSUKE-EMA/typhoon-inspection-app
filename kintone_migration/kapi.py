# kintone REST API ヘルパー（ログイン認証。認証情報は ~/.claude/garoon_config.json）
import base64
import json
import time
from pathlib import Path

import requests

_cfg = json.loads(Path(r"C:\Users\EMA_RYOSUKE.SUYAMA\.claude\garoon_config.json").read_text(encoding="utf-8"))
AUTH = base64.b64encode(f"{_cfg['username']}:{_cfg['password']}".encode()).decode()
H = {"X-Cybozu-Authorization": AUTH}
HJ = {"X-Cybozu-Authorization": AUTH, "Content-Type": "application/json"}
BASE = "https://symgrp.cybozu.com/k/v1/"
HERE = Path(__file__).parent
IDS_FILE = HERE / "app_ids.json"


def ids():
    return json.loads(IDS_FILE.read_text(encoding="utf-8")) if IDS_FILE.exists() else {}


def save_ids(d):
    IDS_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def get(path, **params):
    r = requests.get(BASE + path, headers=H, params=params, timeout=60)
    if not r.ok:
        raise RuntimeError(f"GET {path} {r.status_code} {r.text[:400]}")
    return r.json()


def send(method, path, body):
    r = requests.request(method, BASE + path, headers=HJ, json=body, timeout=120)
    if not r.ok:
        raise RuntimeError(f"{method} {path} {r.status_code} {r.text[:800]}")
    return r.json()


def upload(path, name=None, mime="application/octet-stream"):
    with open(path, "rb") as fp:
        r = requests.post(BASE + "file.json", headers=H, files={"file": (name or Path(path).name, fp, mime)}, timeout=300)
    if not r.ok:
        raise RuntimeError(f"upload {path} {r.status_code} {r.text[:300]}")
    return r.json()["fileKey"]


def deploy(app):
    send("POST", "preview/app/deploy.json", {"apps": [{"app": app}]})
    for _ in range(60):
        time.sleep(2)
        st = get("preview/app/deploy.json", **{"apps[0]": app})["apps"][0]["status"]
        if st != "PROCESSING":
            print(f"deploy app {app}: {st}")
            if st != "SUCCESS":
                raise RuntimeError(st)
            return
    raise RuntimeError("deploy timeout")
