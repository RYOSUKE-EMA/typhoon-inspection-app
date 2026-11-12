# 第2段階：台風養生点検・災害時現場点検・足場点検記録＋共通設定（点検項目・手引き）の kintone アプリを設定
# 何度実行してもよい（作成済みのアプリは app_ids.json のIDを再利用）
import json

from kapi import ids, save_ids, get, send, deploy, HERE

SPACE, THREAD = 16, 17
SRC_ACL_APP = 5287
TLS = ["c0102105", "c0194114", "c0197102", "c0108101", "c0109103"]
GLS = ["c0196108", "c0196105"]
BLS = ["c0195105"]
CATS = json.loads((HERE / "assets" / "categories.json").read_text(encoding="utf-8"))
REASONS = ["組立後", "一部解体", "変更後", "悪天候後", "地震後", "定期", "その他"]

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


def users(codes):
    return [{"type": "USER", "code": c} for c in codes]


def views(app, list_fields, extra=None):
    auto = {k: v for k, v in get("preview/app/views.json", app=app)["views"].items() if "作業者が自分" in k}
    for v in auto.values():
        v["index"] = "9"
    vs = {**auto, "一覧": {"type": "LIST", "name": "一覧", "index": "0", "sort": "inspect_date desc, $id desc",
                           "fields": list_fields}}
    vs.update(extra or {})
    send("PUT", "preview/app/views.json", {"app": app, "views": vs})


def ent(code):
    return {"entity": {"type": "FIELD_ENTITY", "code": code}, "includeSubs": False}


COMMON = {
    "koji_no": {"type": "NUMBER", "code": "koji_no", "label": "工事番号", "required": True, "digit": False,
                "lookup": {"relatedApp": {"app": "269"}, "relatedKeyField": "KojiNo",
                           "fieldMappings": [{"field": "koji_name", "relatedField": "mkbKojiName"}],
                           "lookupPickerFields": ["KojiNo", "mkbKojiName", "mbuBumon"],
                           "filterCond": 'mbuBumon like "建築"', "sort": "KojiNo desc"}},
    "koji_name": {"type": "SINGLE_LINE_TEXT", "code": "koji_name", "label": "工事名", "required": True},
    "inspector": {"type": "USER_SELECT", "code": "inspector", "label": "点検者", "required": True,
                  "defaultValue": [{"code": "LOGINUSER()", "type": "FUNCTION"}]},
    "inspect_date": {"type": "DATE", "code": "inspect_date", "label": "点検日", "required": True, "defaultNowValue": True},
    "checklist": {"type": "SUBTABLE", "code": "checklist", "label": "点検項目", "fields": {
        "item_no": {"type": "NUMBER", "code": "item_no", "label": "No", "digit": False},
        "item_name": {"type": "SINGLE_LINE_TEXT", "code": "item_name", "label": "点検項目"},
        "result": {"type": "DROP_DOWN", "code": "result", "label": "結果", "required": True,
                   "options": opts(["○", "×", "－"]), "defaultValue": ""},
        "note": {"type": "SINGLE_LINE_TEXT", "code": "note", "label": "備考"},
    }},
    "legacy_id": {"type": "SINGLE_LINE_TEXT", "code": "legacy_id", "label": "移行元ID（旧アプリ）"},
    "legacy_note": {"type": "MULTI_LINE_TEXT", "code": "legacy_note", "label": "移行前の提出・承認記録"},
}
APPROVAL = {
    "return_reason": {"type": "MULTI_LINE_TEXT", "code": "return_reason", "label": "差し戻し理由（差し戻し時に入力）"},
    "approval_log": {"type": "MULTI_LINE_TEXT", "code": "approval_log", "label": "承認記録（自動）"},
}

# ── 共通設定（点検項目・手引き） ──
conf = ensure_app("tenken_conf", "点検 共通設定（点検項目・手引き）")
put_fields(conf, {
    "kind": {"type": "DROP_DOWN", "code": "kind", "label": "種別", "required": True,
             "options": opts(["点検項目", "手引き"]), "defaultValue": "点検項目"},
    "category": {"type": "DROP_DOWN", "code": "category", "label": "点検の種類", "required": True,
                 "options": opts(["台風養生点検", "災害時現場点検", "足場点検記録"]), "defaultValue": ""},
    "subtype": {"type": "SINGLE_LINE_TEXT", "code": "subtype", "label": "足場の種類（足場点検のみ）"},
    "item_name": {"type": "SINGLE_LINE_TEXT", "code": "item_name", "label": "点検項目名（手引きのみ）"},
    "body": {"type": "MULTI_LINE_TEXT", "code": "body", "label": "内容（点検項目は1行1項目／手引きは説明文）"},
    "images": {"type": "FILE", "code": "images", "label": "参考画像（手引きのみ）", "thumbnailSize": "250"},
})
send("PUT", "preview/app/views.json", {"app": conf, "views": {
    "一覧": {"type": "LIST", "name": "一覧", "index": "0", "sort": "category asc, kind asc, $id asc",
             "fields": ["kind", "category", "subtype", "item_name", "body", "images"]}}})

# ── 台風養生点検 ──
typhoon = ensure_app("typhoon", "台風養生点検")
put_fields(typhoon, {**COMMON, **APPROVAL,
    "approver_tl": {"type": "USER_SELECT", "code": "approver_tl", "label": "承認するTL", "required": True,
                    "entities": users(TLS), "defaultValue": []}})
send("PUT", "preview/app/status.json", {"app": typhoon, "enable": True, "states": {
    "未提出": {"name": "未提出", "index": "0", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "TL承認待ち": {"name": "TL承認待ち", "index": "1", "assignee": {"type": "ONE", "entities": [ent("approver_tl")]}},
    "差し戻し": {"name": "差し戻し", "index": "2", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "確認済": {"name": "確認済", "index": "3", "assignee": {"type": "ONE", "entities": []}},
}, "actions": [
    {"name": "提出する", "from": "未提出", "to": "TL承認待ち", "filterCond": 'legacy_id = ""'},
    {"name": "承認する", "from": "TL承認待ち", "to": "確認済", "filterCond": ""},
    {"name": "差し戻す", "from": "TL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "再提出する（差し戻し後）", "from": "差し戻し", "to": "TL承認待ち", "filterCond": ""},
    {"name": "移行データ登録", "from": "未提出", "to": "確認済", "filterCond": 'legacy_id != ""'},
]})
views(typhoon, ["koji_no", "koji_name", "inspector", "inspect_date", "approver_tl", "ステータス", "作業者"])

# ── 災害時現場点検（TL → GL・BL 両方の承認で完了） ──
disaster = ensure_app("disaster", "災害時現場点検")
put_fields(disaster, {**COMMON, **APPROVAL,
    "approver_tl": {"type": "USER_SELECT", "code": "approver_tl", "label": "承認するTL", "required": True,
                    "entities": users(TLS), "defaultValue": []},
    "approver_gl": {"type": "USER_SELECT", "code": "approver_gl", "label": "承認するGL", "required": True,
                    "entities": users(GLS), "defaultValue": []},
    "approver_bl": {"type": "USER_SELECT", "code": "approver_bl", "label": "承認するBL", "required": True,
                    "entities": users(BLS), "defaultValue": []}})
send("PUT", "preview/app/status.json", {"app": disaster, "enable": True, "states": {
    "未提出": {"name": "未提出", "index": "0", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "TL承認待ち": {"name": "TL承認待ち", "index": "1", "assignee": {"type": "ONE", "entities": [ent("approver_tl")]}},
    "GL・BL承認待ち": {"name": "GL・BL承認待ち", "index": "2",
                      "assignee": {"type": "ALL", "entities": [ent("approver_gl"), ent("approver_bl")]}},
    "差し戻し": {"name": "差し戻し", "index": "3", "assignee": {"type": "ONE", "entities": [ent("作成者")]}},
    "確認済": {"name": "確認済", "index": "4", "assignee": {"type": "ONE", "entities": []}},
}, "actions": [
    {"name": "提出する", "from": "未提出", "to": "TL承認待ち", "filterCond": 'legacy_id = ""'},
    {"name": "承認する（TL）", "from": "TL承認待ち", "to": "GL・BL承認待ち", "filterCond": ""},
    {"name": "差し戻す", "from": "TL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "承認する（GL・BL）", "from": "GL・BL承認待ち", "to": "確認済", "filterCond": ""},
    {"name": "差し戻す（GL・BL）", "from": "GL・BL承認待ち", "to": "差し戻し", "filterCond": ""},
    {"name": "再提出する（差し戻し後）", "from": "差し戻し", "to": "TL承認待ち", "filterCond": ""},
    {"name": "移行データ登録", "from": "未提出", "to": "確認済", "filterCond": 'legacy_id != ""'},
]})
views(disaster, ["koji_no", "koji_name", "inspector", "inspect_date", "approver_tl", "approver_gl", "approver_bl", "ステータス", "作業者"])

# ── 足場点検記録（承認なし） ──
scaffold = ensure_app("scaffold", "足場点検記録")
sub_labels = [v["label"] for v in CATS["scaffold"]["subtypes"].values()]
put_fields(scaffold, {**COMMON,
    "subtype": {"type": "DROP_DOWN", "code": "subtype", "label": "足場の種類", "required": True,
                "options": opts(sub_labels), "defaultValue": ""},
    "inspect_reason": {"type": "DROP_DOWN", "code": "inspect_reason", "label": "点検実施理由", "required": True,
                       "options": opts(REASONS), "defaultValue": ""},
    "inspect_reason_other": {"type": "SINGLE_LINE_TEXT", "code": "inspect_reason_other", "label": "点検実施理由（その他の内容）"},
    "assembler_name": {"type": "SINGLE_LINE_TEXT", "code": "assembler_name", "label": "組立者氏名"},
    "assembler_qual": {"type": "SINGLE_LINE_TEXT", "code": "assembler_qual", "label": "組立者の資格名"},
    "assembler_qual_no": {"type": "SINGLE_LINE_TEXT", "code": "assembler_qual_no", "label": "組立者の資格番号"},
    "inspector_qual": {"type": "SINGLE_LINE_TEXT", "code": "inspector_qual", "label": "点検者の資格名"},
    "inspector_qual_no": {"type": "SINGLE_LINE_TEXT", "code": "inspector_qual_no", "label": "点検者の資格番号"}})
views(scaffold, ["koji_no", "koji_name", "subtype", "inspect_reason", "inspector", "inspect_date"], {
    "提出状況": {"type": "CUSTOM", "name": "提出状況", "index": "1", "pager": False,
                 "html": '<div id="tenken-status">読み込み中...</div>'}})

rights = get("app/acl.json", app=SRC_ACL_APP)["rights"]
for app in (conf, typhoon, disaster, scaffold):
    send("PUT", "preview/app/acl.json", {"app": app, "rights": rights})
for app in (conf, typhoon, disaster, scaffold):
    deploy(app)
print(d)
