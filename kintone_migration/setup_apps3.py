# 案2（元の画面の再現）用のフィールド追加
#  - 各点検アプリ：承認記録（approvals）・差し戻し履歴（returns）サブテーブル、点検者（文字）inspector_name
#  - 承認者フィールドの候補制限を外す（候補は名簿から画面側で出す）
#  - 共通設定5831：種別「名簿」と、役割・メンバー・ブロック・担当工事№
#  - 画面の置き場所：準備用アプリ「点検アプリ（新・準備中）」（江間さんのみ）
from kapi import ids, save_ids, get, send, deploy

d = ids()


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


SUBTABLES = {
    "inspector_name": {"type": "SINGLE_LINE_TEXT", "code": "inspector_name", "label": "点検者（氏名）"},
    "approvals": {"type": "SUBTABLE", "code": "approvals", "label": "承認記録", "fields": {
        "ap_step": {"type": "NUMBER", "code": "ap_step", "label": "段", "digit": False},
        "ap_role": {"type": "SINGLE_LINE_TEXT", "code": "ap_role", "label": "役割"},
        "ap_name": {"type": "SINGLE_LINE_TEXT", "code": "ap_name", "label": "承認者"},
        "ap_code": {"type": "SINGLE_LINE_TEXT", "code": "ap_code", "label": "承認者ログイン名"},
        "ap_comment": {"type": "SINGLE_LINE_TEXT", "code": "ap_comment", "label": "コメント"},
        "ap_at": {"type": "DATETIME", "code": "ap_at", "label": "承認日時"},
    }},
    "returns": {"type": "SUBTABLE", "code": "returns", "label": "差し戻し履歴", "fields": {
        "rt_role": {"type": "SINGLE_LINE_TEXT", "code": "rt_role", "label": "役割"},
        "rt_by": {"type": "SINGLE_LINE_TEXT", "code": "rt_by", "label": "差し戻した人"},
        "rt_reason": {"type": "MULTI_LINE_TEXT", "code": "rt_reason", "label": "理由"},
        "rt_at": {"type": "DATETIME", "code": "rt_at", "label": "差し戻し日時"},
        "rt_resub_at": {"type": "DATETIME", "code": "rt_resub_at", "label": "再提出日時"},
    }},
}
FREE = {"entities": []}

for key in ("junpo", "typhoon", "disaster", "scaffold"):
    app = d[key]
    cur = get("preview/app/form/fields.json", app=app)["properties"]
    props = dict(SUBTABLES)
    if key == "scaffold":
        props = {"inspector_name": SUBTABLES["inspector_name"]}
    for f in ("approver_tl", "approver_gl", "approver_bl"):
        if f in cur:
            props[f] = {**cur[f], **FREE}
    put_fields(app, props)
    deploy(app)

conf = d["tenken_conf"]
put_fields(conf, {
    "kind": {"type": "DROP_DOWN", "code": "kind", "label": "種別", "required": True,
             "options": opts(["点検項目", "手引き", "名簿", "資料"]), "defaultValue": "点検項目"},
    "category": {"type": "DROP_DOWN", "code": "category", "label": "点検の種類", "required": False,
                 "options": opts(["安全旬報", "台風養生点検", "災害時現場点検", "足場点検記録"]), "defaultValue": ""},
    "role": {"type": "DROP_DOWN", "code": "role", "label": "役割（名簿）", "options": opts(["TL", "GL", "BL", "安全検査室"]), "defaultValue": ""},
    "member": {"type": "USER_SELECT", "code": "member", "label": "メンバー（名簿）"},
    "block": {"type": "SINGLE_LINE_TEXT", "code": "block", "label": "ブロック（名簿・空欄＝全ブロック共通）"},
    "koji_nos": {"type": "SINGLE_LINE_TEXT", "code": "koji_nos", "label": "担当工事№（名簿・カンマ区切り）"},
    "title": {"type": "SINGLE_LINE_TEXT", "code": "title", "label": "タイトル（資料）"},
})
deploy(conf)

# 準備用アプリ（画面の置き場所）。本番切替時は同じJSを app 5287 の「点検アプリ」ビューに登録する
if "spa" not in d:
    d["spa"] = int(send("POST", "preview/app.json", {"name": "点検アプリ（新・準備中）", "space": 16, "thread": 17})["app"])
    save_ids(d)
spa = d["spa"]
put_fields(spa, {"memo": {"type": "SINGLE_LINE_TEXT", "code": "memo", "label": "メモ"}})
auto = get("preview/app/views.json", app=spa)["views"]
send("PUT", "preview/app/views.json", {"app": spa, "views": {
    "点検アプリ": {"type": "CUSTOM", "name": "点検アプリ", "index": "0", "pager": False,
                   "html": '<div id="tenken-app"></div>'}}})
full = {k: True for k in ("appEditable", "recordViewable", "recordAddable", "recordEditable",
                          "recordDeletable", "recordImportable", "recordExportable")}
send("PUT", "preview/app/acl.json", {"app": spa, "rights": [{"entity": {"type": "USER", "code": "c0114101"}, "includeSubs": False, **full}]})
deploy(spa)
print(d)
