# アプリ5287のカスタマイズJSを差し替えてデプロイ
import base64
import json
import time
from pathlib import Path

import requests

SCRATCH = Path(__file__).parent  # tenken_embed.js と同じフォルダ
cfg = json.loads(Path(r"C:\Users\EMA_RYOSUKE.SUYAMA\.claude\garoon_config.json").read_text(encoding="utf-8"))
auth = base64.b64encode(f"{cfg['username']}:{cfg['password']}".encode()).decode()
H = {"X-Cybozu-Authorization": auth}
HJ = {"X-Cybozu-Authorization": auth, "Content-Type": "application/json; charset=utf-8"}
BASE = "https://symgrp.cybozu.com/k/v1"
APP = 5287

def upload():
    with open(SCRATCH / "tenken_embed.js", "rb") as fp:
        r = requests.post(f"{BASE}/file.json", headers=H,
                          files={"file": ("tenken_embed.js", fp, "text/javascript")}, timeout=30)
    print("upload:", r.status_code)
    r.raise_for_status()
    return r.json()["fileKey"]

# fileKeyは1回しか使えないのでPC用・スマホ用で別々にアップロード
file_key = upload()
file_key_m = upload()

r = requests.put(f"{BASE}/preview/app/customize.json", headers=HJ, json={
    "app": APP,
    "scope": "ALL",
    "desktop": {"js": [{"type": "FILE", "file": {"fileKey": file_key}}], "css": []},
    "mobile": {"js": [{"type": "FILE", "file": {"fileKey": file_key_m}}], "css": []},
}, timeout=30)
print("customize:", r.status_code, r.text[:120])
r.raise_for_status()

r = requests.post(f"{BASE}/preview/app/deploy.json", headers=HJ, json={"apps": [{"app": APP}]}, timeout=30)
print("deploy:", r.status_code)
r.raise_for_status()
for _ in range(20):
    time.sleep(3)
    r = requests.get(f"{BASE}/preview/app/deploy.json", headers=H, params={"apps[0]": APP}, timeout=30)
    st = r.json()["apps"][0]["status"]
    print("status:", st)
    if st != "PROCESSING":
        break
