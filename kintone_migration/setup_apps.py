# 安全旬報 kintone版：アプリ作成・フィールド・プロセス管理・通知・一覧・権限の設定
# 何度実行してもよい（既に作成済みのアプリはIDを app_ids.json から再利用）
from kapi import ids, save_ids, get, send, deploy

SPACE, THREAD = 16, 17           # 「建築G 各種点検記録」スペース（app 5287 と同じ場所）
SRC_ACL_APP = 5287               # 権限はこのアプリと同じにする
TLS = ["c0102105", "c0194114", "c0197102", "c0108101", "c0109103"]   # 承認者名簿のTL
SAFETY_OFFICER = "c0100109"      # 安全検査室

d = ids()


def ensure_app(key, name):
    if key not in d:
        d[key] = int(send("POST", "preview/app.json", {"name": name, "space": SPACE, "thread": THREAD})["app"])
        save_ids(d)
        print("created", key, d[key])
    return d[key]


def put_fields(app, props):
    cur = get("preview/app/form/fields.json", app=app)["properties"]
    add = {k: v for k, v in props.items() if k not in cur}
    upd = {k: v for k, v in props.items() if k in cur}
    if add:
        send("POST", "preview/app/form/fields.json", {"app": app, "properties": add})
    if upd:
        send("PUT", "preview/app/form/fields.json", {"app": app, "properties": upd})


def opts(values):
    return {v: {"label": v, "index": str(i)} for i, v in enumerate(values)}


junpo = ensure_app("junpo", "安全旬報")
conf = ensure_app("junpo_conf", "安全旬報 設定（提出状況・点検項目）")

# ── 設定アプリ ──
put_fields(conf, {
    "kind": {"type": "DROP_DOWN", "code": "kind", "label": "種別", "required": True,
             "options": opts(["対象期間", "対象外", "追加対象", "点検項目", "PDF資材"]), "defaultValue": "対象期間"},
    "koji_no": {"type": "SINGLE_LINE_TEXT", "code": "koji_no", "label": "工事番号"},
    "start_date": {"type": "DATE", "code": "start_date", "label": "開始日"},
    "end_date": {"type": "DATE", "code": "end_date", "label": "終了日"},
    "year": {"type": "NUMBER", "code": "year", "label": "年"},
    "month": {"type": "NUMBER", "code": "month", "label": "月"},
    "period": {"type": "DROP_DOWN", "code": "period", "label": "旬", "options": opts(["上旬", "中旬", "下旬"]), "defaultValue": ""},
    "body": {"type": "MULTI_LINE_TEXT", "code": "body", "label": "内容（点検項目は1行1項目）"},
    "files": {"type": "FILE", "code": "files", "label": "ファイル"},
    "memo": {"type": "SINGLE_LINE_TEXT", "code": "memo", "label": "メモ"},
})

# ── 安全旬報アプリ ──
put_fields(junpo, {
    "koji_no": {"type": "NUMBER", "code": "koji_no", "label": "工事番号", "required": True, "digit": False,
                "lookup": {"relatedApp": {"app": "269"}, "relatedKeyField": "KojiNo",
                           "fieldMappings": [{"field": "koji_name", "relatedField": "mkbKojiName"}],
                           "lookupPickerFields": ["KojiNo", "mkbKojiName", "mbuBumon"],
                           "filterCond": 'mbuBumon like "建築"', "sort": "KojiNo desc"}},
    "koji_name": {"type": "SINGLE_LINE_TEXT", "code": "koji_name", "label": "工事名", "required": True},
    "site_manager": {"type": "SINGLE_LINE_TEXT", "code": "site_manager", "label": "作業所長"},
    "inspector": {"type": "USER_SELECT", "code": "inspector", "label": "点検者", "required": True,
                  "defaultValue": [{"code": "LOGINUSER()", "type": "FUNCTION"}]},
    "inspect_date": {"type": "DATE", "code": "inspect_date", "label": "点検日", "required": True, "defaultNowValue": True},
    "report_month": {"type": "DROP_DOWN", "code": "report_month", "label": "対象月", "required": True,
                     "options": opts([str(m) for m in range(1, 13)]), "defaultValue": ""},
    "report_period": {"type": "DROP_DOWN", "code": "report_period", "label": "旬", "required": True,
                      "options": opts(["上旬", "中旬", "下旬"]), "defaultValue": ""},
    "report_round": {"type": "NUMBER", "code": "report_round", "label": "第○回", "digit": False},
    "approver_tl": {"type": "USER_SELECT", "code": "approver_tl", "label": "承認するTL", "required": True,
                    "entities": [{"type": "USER", "code": c} for c in TLS], "defaultValue": []},
    "safety_officer": {"type": "USER_SELECT", "code": "safety_officer", "label": "安全検査室（提出時に通知）",
                       "defaultValue": [{"code": SAFETY_OFFICER, "type": "USER"}]},
    "checklist": {"type": "SUBTABLE", "code": "checklist", "label": "点検項目", "fields": {
        "item_no": {"type": "NUMBER", "code": "item_no", "label": "No", "digit": False},
        "item_name": {"type": "SINGLE_LINE_TEXT", "code": "item_name", "label": "点検項目"},
        "result": {"type": "DROP_DOWN", "code": "result", "label": "結果", "required": True,
                   "options": opts(["○", "×", "－"]), "defaultValue": ""},
        "note": {"type": "SINGLE_LINE_TEXT", "code": "note", "label": "備考"},
    }},
    "meeting_date": {"type": "DATE", "code": "meeting_date", "label": "災害防止協議会・教育 実施日"},
    "meeting_attendees": {"type": "MULTI_LINE_TEXT", "code": "meeting_attendees", "label": "参加業者名"},
    "meeting_notes": {"type": "MULTI_LINE_TEXT", "code": "meeting_notes", "label": "協議事項・管理重点事項"},
    "return_reason": {"type": "MULTI_LINE_TEXT", "code": "return_reason", "label": "差し戻し理由（差し戻し時に入力）"},
    "legacy_id": {"type": "SINGLE_LINE_TEXT", "code": "legacy_id", "label": "移行元ID（旧アプリ）"},
    "legacy_note": {"type": "MULTI_LINE_TEXT", "code": "legacy_note", "label": "移行前の提出・承認記録"},
})

# プロセス管理
send("PUT", "preview/app/status.json", {"app": junpo, "enable": True, "states": {
    "未提出": {"name": "未提出", "index": "0", "assignee": {"type": "ONE", "entities": [
        {"entity": {"type": "FIELD_ENTITY", "code": "作成者"}, "includeSubs": False}]}},
    "TL承認待ち": {"name": "TL承認待ち", "index": "1", "assignee": {"type": "ONE", "entities": [
        {"entity": {"type": "FIELD_ENTITY", "code": "approver_tl"}, "includeSubs": False}]}},
    "差し戻し": {"name": "差し戻し", "index": "2", "assignee": {"type": "ONE", "entities": [
        {"entity": {"type": "FIELD_ENTITY", "code": "作成者"}, "includeSubs": False}]}},
    "確認済": {"name": "確認済", "index": "3", "assignee": {"type": "ONE", "entities": []}},
}, "actions": [
    {"name": "提出する", "from": "未提出", "to": "TL承認待ち", "filterCond": 'legacy_id = ""'},
    {"name": "承認する", "from": "TL承認待ち", "to": "確認済", "filterCond": ""},
    {"name": "差し戻す", "from": "TL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "再提出する（差し戻し後）", "from": "差し戻し", "to": "TL承認待ち", "filterCond": ""},
    {"name": "移行データ登録", "from": "未提出", "to": "確認済", "filterCond": 'legacy_id != ""'},
]})

# 一覧
_auto = {k: v for k, v in get("preview/app/views.json", app=junpo)["views"].items() if "作業者が自分" in k}
for v in _auto.values():
    v["index"] = "2"
send("PUT", "preview/app/views.json", {"app": junpo, "views": {**_auto,
    "一覧": {"type": "LIST", "name": "一覧", "index": "0", "sort": "inspect_date desc, $id desc",
             "fields": ["koji_no", "koji_name", "report_month", "report_period", "inspector", "inspect_date",
                        "approver_tl", "ステータス", "作業者"]},
    "提出状況": {"type": "CUSTOM", "name": "提出状況", "index": "1", "pager": False,
                 "html": '<div id="junpo-status">読み込み中...</div>'},
}})
send("PUT", "preview/app/views.json", {"app": conf, "views": {
    "一覧": {"type": "LIST", "name": "一覧", "index": "0", "sort": "kind asc, koji_no asc",
             "fields": ["kind", "koji_no", "start_date", "end_date", "year", "month", "period", "memo", "作成者"]},
}})

# 安全検査室への提出通知（ステータスがTL承認待ちになったとき）
send("PUT", "preview/app/notifications/perRecord.json", {"app": junpo, "notifications": [
    {"filterCond": 'ステータス in ("TL承認待ち")', "title": "安全旬報が提出されました",
     "targets": [{"entity": {"type": "FIELD_ENTITY", "code": "safety_officer"}, "includeSubs": False}]},
]})

# 権限：app 5287 と同じ
rights = get("app/acl.json", app=SRC_ACL_APP)["rights"]
for app in (junpo, conf):
    send("PUT", "preview/app/acl.json", {"app": app, "rights": rights})

for app in (junpo, conf):
    deploy(app)
print(d)
