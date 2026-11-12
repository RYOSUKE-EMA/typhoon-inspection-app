# 共通設定アプリ（5831）：点検項目（台風・災害時・足場10種類）と手引き（Vercel版から説明文・画像を移行）
import html
import json
import re
import tempfile
from pathlib import Path

import requests

from kapi import ids, get, send, upload, HERE

conf = ids()["tenken_conf"]
CATS = json.loads((HERE / "assets" / "categories.json").read_text(encoding="utf-8"))
VERCEL = "https://typhoon-inspection-app.vercel.app"
Q = {"kintone_user": "江間", "kintone_code": "c0114101"}

existing = get("records.json", app=conf, query="limit 500")["records"]
have = {(r["kind"]["value"], r["category"]["value"], r["subtype"]["value"], r["item_name"]["value"]) for r in existing}
recs = []
for key, c in CATS.items():
    if "subtypes" in c:
        for sk, s in c["subtypes"].items():
            if ("点検項目", c["label"], s["label"], "") not in have:
                recs.append({"kind": {"value": "点検項目"}, "category": {"value": c["label"]},
                             "subtype": {"value": s["label"]}, "body": {"value": "\n".join(s["items"])}})
    elif ("点検項目", c["label"], "", "") not in have:
        recs.append({"kind": {"value": "点検項目"}, "category": {"value": c["label"]}, "body": {"value": "\n".join(c["items"])}})

# 手引き
tmp = Path(tempfile.mkdtemp())
for key, c in CATS.items():
    pages = [(sk, s["label"]) for sk, s in c["subtypes"].items()] if "subtypes" in c else [(None, "")]
    for sk, slabel in pages:
        params = dict(Q, **({"subtype": sk} if sk else {}))
        h = requests.get(f"{VERCEL}/guides/{key}", params=params, timeout=60).text
        for card in h.split('<div class="card">')[1:]:
            m = re.search(r'name="item_name" value="([^"]*)"', card)
            if not m:
                continue
            item = html.unescape(m.group(1))
            desc = re.search(r'<textarea name="description"[^>]*>(.*?)</textarea>', card, re.S)
            desc = html.unescape(desc.group(1)).strip() if desc else ""
            imgs = re.findall(r'<img src="/guide-image/(\d+)"', card)
            if not desc and not imgs:
                continue
            if ("手引き", c["label"], slabel, item) in have:
                continue
            files = []
            for iid in imgs:
                r = requests.get(f"{VERCEL}/guide-image/{iid}", timeout=60)
                ext = {"image/png": ".png", "image/webp": ".webp"}.get(r.headers.get("Content-Type", ""), ".jpg")
                p = tmp / f"guide_{iid}{ext}"
                p.write_bytes(r.content)
                files.append({"fileKey": upload(p, mime=r.headers.get("Content-Type", "image/jpeg"))})
            recs.append({"kind": {"value": "手引き"}, "category": {"value": c["label"]}, "subtype": {"value": slabel},
                         "item_name": {"value": item}, "body": {"value": desc}, "images": {"value": files}})
            print("guide:", c["label"], slabel, item[:20], len(files), "images")

for i in range(0, len(recs), 100):
    send("POST", "records.json", {"app": conf, "records": recs[i:i + 100]})
print("added", len(recs))
