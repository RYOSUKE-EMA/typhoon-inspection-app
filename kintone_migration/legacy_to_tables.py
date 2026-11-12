# 移行済みレコードの「移行前の提出・承認記録」（文字）を、承認記録・差し戻し履歴のサブテーブルに展開する（元の画面と同じ表示にするため）
import re
from datetime import datetime, timedelta

from kapi import ids, get, send


def utc(s):  # 「2026-11-10 23:10:11」（日本時間）→ kintone の UTC 表記
    d = datetime.strptime(s.strip()[:19], "%Y-%m-%d %H:%M:%S") - timedelta(hours=9)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


for key in ("junpo", "typhoon"):
    app = ids()[key]
    upd = []
    for r in get("records.json", app=app, query='legacy_id != "" limit 500')["records"]:
        if r["approvals"]["value"] or r["returns"]["value"]:
            continue
        aps, rts = [], []
        for line in r["legacy_note"]["value"].splitlines():
            m = re.match(r"承認：(.+?)　(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:　コメント：(.*))?$", line)
            if m:
                aps.append({"value": {"ap_step": {"value": 0}, "ap_role": {"value": "TL"}, "ap_name": {"value": m.group(1)},
                                      "ap_code": {"value": ""}, "ap_comment": {"value": m.group(3) or ""}, "ap_at": {"value": utc(m.group(2))}}})
            m = re.match(r"差し戻し：(\w+)：(.+?)　(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:　理由：(.*?))?　再提出：(.*)$", line)
            if m:
                rts.append({"value": {"rt_role": {"value": m.group(1)}, "rt_by": {"value": m.group(2)}, "rt_reason": {"value": m.group(4) or ""},
                                      "rt_at": {"value": utc(m.group(3))},
                                      "rt_resub_at": {"value": utc(m.group(5)) if re.match(r"\d{4}-", m.group(5)) else None}}})
        if aps or rts:
            upd.append({"id": r["$id"]["value"], "record": {"approvals": {"value": aps}, "returns": {"value": rts}}})
    if upd:
        send("PUT", "records.json", {"app": app, "records": upd})
    print(key, "expanded", len(upd))
