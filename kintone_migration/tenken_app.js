/*
 * 現場点検システム（kintone版・元の画面の再現）
 *   Vercel版（Flask）の画面をそのまま kintone のカスタマイズビュー内に描画する。
 *   データ：安全旬報5829／台風5832／災害時5833／足場5834、設定：5830（旬報）・5831（点検項目・手引き・名簿）
 *   承認・差し戻しは各アプリのプロセス管理を REST API で実行する。
 *   置き場所：<div id="tenken-app"></div> を持つカスタマイズビュー（準備中は app5835、本番は app5287）
 * 依存：pdf-lib.min.js / fontkit.umd.min.js
 */
(function () {
  'use strict';

  var JUNPO_CONF = 5830, TENKEN_CONF = 5831, MASTER_APP = 269;
  var DEV_CODES = ['c0114101'];
  var CATS = {
    safety_patrol: { label: '安全旬報', flow: [['TL']],
      desc: '現場の安全・環境管理状況を定期的に点検します（建築・マンション工事用旬報対応）' },
    scaffold: { label: '足場点検記録', flow: [],
      desc: '足場の組立・変更後や強風後等の点検を行います（労働安全衛生規則対応・足場種類別）' },
    typhoon: { label: '台風養生点検', flow: [['TL']], desc: '台風接近時の養生状況を点検します' },
    disaster: { label: '災害時現場点検', flow: [['TL'], ['GL', 'BL']],
      desc: '地震・台風・異常気象時の現場点検を行います（災害時現場点検報告書・地震異常気象時報告書対応）' }
  };
  var SUBTYPES = ['わく組足場', '単管足場', 'ﾌﾞﾗｹｯﾄ一側足場', 'くさび緊結足場', '低層くさび緊結足場', '張出し足場',
    'つりわく足場', 'つり棚足場', 'わく組式作業構台', '乗入れ構台'];
  var REASONS = ['組立後', '一部解体', '変更後', '悪天候後', '地震後', '定期', 'その他'];
  var OPTIONS = ['○', '×', '－'];
  var LEGEND = '○…異常なし　×…不備あり　－…該当なし　（不備ありの場合は備考欄に処置内容を記載）';
  var PERIODS = ['上旬', '中旬', '下旬'];
  var ROLE_FIELD = { TL: 'approver_tl', GL: 'approver_gl', BL: 'approver_bl' };

  var root = null;
  // データの保存先：この画面が置かれているアプリ（本番 5287／準備用 5835）。4種類の点検を点検種別（category）で区別する
  var APP = (location.pathname.indexOf('/k/m/') === 0 ? kintone.mobile.app : kintone.app).getId();
  function catQ(cat) { return 'category in ("' + CATS[cat].label + '")'; }
  var me = kintone.getLoginUser();

  // ───────── 共通 ─────────
  function api(path, method, body) { return kintone.api(kintone.api.url(path, true), method, body); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dt(v) {   // kintone日時（UTC）→「YYYY-MM-DD HH:MM:SS」（日本時間）
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return v;
    return iso(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function nowIso() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  function fetchAll(app, query, fields) {
    var out = [];
    function next(lastId) {
      var params = { app: app, query: (query ? '(' + query + ') and ' : '') + '$id > ' + lastId + ' order by $id asc limit 500' };
      if (fields) params.fields = fields.concat(['$id']);
      return api('/k/v1/records', 'GET', params).then(function (r) {
        out = out.concat(r.records);
        return r.records.length === 500 ? next(r.records[r.records.length - 1].$id.value) : out;
      });
    }
    return next(0);
  }
  function users(v) { return (v || []).map(function (u) { return u.name; }).join('、'); }
  function firstCode(v) { return v && v.length ? v[0].code : ''; }
  function isDev() { return DEV_CODES.indexOf(me.code) >= 0; }

  function go(hash) { location.hash = hash; }
  // プロセス管理のアクション実行（次の作業者が1人に決まる場合は assignee を指定する）
  function statusAction(app, id, action, assignee) {
    var body = { app: app, id: id, action: action };
    if (assignee) body.assignee = assignee;
    return api('/k/v1/record/status', 'PUT', body);
  }
  function overlay(msg) {
    var ov = document.getElementById('tk-overlay');
    if (!msg) { ov.classList.remove('show'); return; }
    ov.querySelector('.msg').textContent = msg;
    ov.classList.add('show');
  }
  function fail(e) {
    overlay(null);
    console.error(e);
    var m = (e && e.message) || String(e);
    if (e && e.errors) m += '\n' + JSON.stringify(e.errors);
    alert('処理できませんでした。\n' + m);
  }

  // 設定（名簿・点検項目・手引き）
  var cache = {};
  function loadConf() {
    if (!cache.conf) cache.conf = fetchAll(TENKEN_CONF, '', null);
    return cache.conf;
  }
  function loadRoster() {
    return loadConf().then(function (recs) {
      return recs.filter(function (r) { return r.kind.value === '名簿' && r.member.value.length; }).map(function (r) {
        return { id: r.$id.value, role: r.role.value, code: r.member.value[0].code, name: r.member.value[0].name,
                 block: r.block.value || '', koji: r.koji_nos.value || '' };
      });
    });
  }
  function loadItems(cat, subtype) {
    if (cat === 'safety_patrol') {
      return api('/k/v1/records', 'GET', { app: JUNPO_CONF, query: 'kind in ("点検項目") limit 1' }).then(function (r) {
        return r.records[0] ? splitLines(r.records[0].body.value) : [];
      });
    }
    return loadConf().then(function (recs) {
      var r = recs.filter(function (x) {
        return x.kind.value === '点検項目' && x.category.value === CATS[cat].label && (x.subtype.value || '') === (subtype || '');
      })[0];
      return r ? splitLines(r.body.value) : [];
    });
  }
  function splitLines(s) { return (s || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function loadGuides(cat, subtype) {
    return loadConf().then(function (recs) {
      var map = {};
      recs.forEach(function (r) {
        if (r.kind.value === '手引き' && r.category.value === CATS[cat].label && (r.subtype.value || '') === (subtype || '')) {
          map[r.item_name.value] = r;
        }
      });
      return map;
    });
  }

  // 所属ブロック（cybozu組織の「○○Ｂ」）
  function loadMyBlock() {
    if (!cache.block) {
      cache.block = fetch('/v1/user/organizations.json?code=' + encodeURIComponent(me.code), {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
      }).then(function (r) { return r.ok ? r.json() : { organizationTitles: [] }; }).then(function (j) {
        var t = (j.organizationTitles || []).map(function (x) { return x.organization.name; })
          .filter(function (n) { return /^[^\s　]+Ｂ$/.test(n); })[0];
        return t || '';
      }).catch(function () { return ''; });
    }
    return cache.block;
  }

  // 稼働中の工事（工事マスタ：建築・完成日なし）
  function loadProjects() {
    if (!cache.projects) {
      cache.projects = fetchAll(MASTER_APP, 'mbuBumon like "建築" and mkuSYmd = ""', ['KojiNo', 'mkbKojiName']).then(function (recs) {
        var seen = {}, out = [];
        recs.forEach(function (r) {
          var no = String(r.KojiNo.value || '').split('.')[0];
          if (no && r.mkbKojiName.value && !seen[no]) { seen[no] = 1; out.push({ no: no, name: r.mkbKojiName.value }); }
        });
        out.sort(function (a, b) { return a.no < b.no ? 1 : -1; });
        return out;
      }).catch(function () { cache.projects = null; return []; });
    }
    return cache.projects;
  }

  // kintoneレコード → 画面用
  function toReport(cat, r) {
    var rep = {
      id: r.$id.value, cat: cat, project_no: (r.project_no && r.project_no.value) || r.koji_no.value || '',
      project_name: (r.project_name && r.project_name.value) || r.koji_name.value || '',
      inspect_date: r.inspect_date.value || '',
      inspector: r.inspector.value || '',
      status: r['ステータス'] ? r['ステータス'].value : '', assignees: r['作業者'] ? r['作業者'].value.map(function (u) { return u.code; }) : [],
      creator: r['作成者'] ? r['作成者'].value : {}, created_at: r['作成日時'] ? r['作成日時'].value : '',
      raw: r
    };
    ['site_manager', 'report_month', 'report_period', 'report_round', 'meeting_date', 'meeting_attendees', 'meeting_notes',
     'subtype', 'inspect_reason', 'inspect_reason_other', 'assembler_name', 'assembler_qual', 'assembler_qual_no',
     'inspector_qual', 'inspector_qual_no', 'legacy_note'].forEach(function (k) { if (r[k]) rep[k] = r[k].value || ''; });
    if (cat === 'scaffold') {
      rep.reason_text = rep.inspect_reason === 'その他' ? 'その他（' + (rep.inspect_reason_other || '') + '）' : (rep.inspect_reason || '');
    }
    ['approver_tl', 'approver_gl', 'approver_bl', 'safety_officer'].forEach(function (k) { if (r[k]) rep[k] = r[k].value; });
    rep.items = r.checklist ? r.checklist.value.map(function (row) {
      return { item_name: row.value.item_name.value, result: row.value.item_result.value, note: row.value.item_note.value };
    }) : [];
    rep.approvals = r.approvals ? r.approvals.value.map(function (row) {
      return { step: Number(row.value.ap_step.value || 0), role: row.value.ap_role.value, name: row.value.ap_name.value,
               code: row.value.ap_code.value, comment: row.value.ap_comment.value, at: row.value.ap_at.value };
    }) : [];
    rep.returns = r.returns ? r.returns.value.map(function (row) {
      return { role: row.value.rt_role.value, by: row.value.rt_by.value, reason: row.value.rt_reason.value,
               at: row.value.rt_at.value, resub_at: row.value.rt_resub_at.value };
    }) : [];
    return rep;
  }
  function statusLabel(st) { return st === '未提出' ? '下書き' : st; }
  function statusBadge(st) {
    if (st === '確認済') return '<span class="badge badge-done">確認済</span>';
    if (st === '差し戻し') return '<span class="badge badge-returned">差し戻し中</span>';
    return '<span class="badge badge-pending">' + esc(statusLabel(st)) + '</span>';
  }

  // ───────── 画面の枠 ─────────
  function page(html) {
    root.innerHTML = '<div class="tk-root"><header><h1><span>■</span> 現場点検システム</h1><a href="#/">トップ</a></header>' +
      '<div class="container">' + html + '</div></div>';
    window.scrollTo(0, Math.max(0, root.getBoundingClientRect().top + window.scrollY - 60));
  }
  function loading() { page('<div class="card">読み込み中...</div>'); }
  function backBtn(cat) { return '<a class="btn btn-secondary" href="#/reports/' + cat + '">一覧に戻る</a>'; }

  // ───────── ルーター ─────────
  function route() {
    if (!root) return;
    overlay(null);
    var h = (location.hash || '#/').slice(1);
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (p) { var kv = p.split('='); q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); }); h = h.slice(0, qi); }
    var m;
    try {
      if (h === '/' || h === '') return viewIndex();
      if ((m = h.match(/^\/reports\/(\w+)$/)) && CATS[m[1]]) return viewList(m[1]);
      if ((m = h.match(/^\/reports\/(\w+)\/new$/)) && CATS[m[1]]) return viewForm(m[1], null, q);
      if ((m = h.match(/^\/reports\/(\w+)\/(\d+)\/edit$/)) && CATS[m[1]]) return viewForm(m[1], m[2], q);
      if ((m = h.match(/^\/reports\/(\w+)\/(\d+)\/return$/)) && CATS[m[1]]) return viewReturn(m[1], m[2], q);
      if ((m = h.match(/^\/reports\/(\w+)\/(\d+)$/)) && CATS[m[1]]) return viewDetail(m[1], m[2]);
      if (h === '/safety_patrol/status') return viewJunpoStatus(q);
      if (h === '/scaffold/status') return viewScaffoldStatus(q);
      if ((m = h.match(/^\/guides\/(\w+)$/)) && CATS[m[1]]) return viewGuides(m[1], q);
      if ((m = h.match(/^\/guides\/(\w+)\/items$/)) && CATS[m[1]]) return viewChecklistEdit(m[1], q);
      if ((m = h.match(/^\/resources\/(\w+)$/)) && CATS[m[1]]) return viewResources(m[1]);
      if (h === '/approvers') return viewApprovers();
    } catch (e) { console.error(e); }
    viewIndex();
  }

  // ───────── トップ ─────────
  function viewIndex() {
    var keys = Object.keys(CATS);
    var html = '<div class="card"><h2>現場点検システム</h2><p>工事現場の各種点検記録を作成・共有し、上司への報告を行うためのシステムです。</p></div><div class="menu-grid">';
    keys.forEach(function (k) {
      html += '<a class="menu-card" href="#/reports/' + k + '"><span class="badge badge-pending pending-badge" data-cnt="' + k + '" style="display:none"></span>' +
        '<div class="title">' + CATS[k].label + '</div><div class="desc">' + esc(CATS[k].desc) + '</div></a>';
    });
    html += '</div>';
    if (isDev()) html += '<div class="flex" style="margin-top:18px;"><a class="btn btn-secondary" href="#/approvers">承認者・通知先の名簿設定</a></div>';
    page(html);
    keys.forEach(function (k) {
      if (!CATS[k].flow.length) return;
      api('/k/v1/records', 'GET', { app: APP, query: catQ(k) + ' and ステータス in ("TL承認待ち", "GL・BL承認待ち") limit 1', totalCount: true, fields: ['$id'] })
        .then(function (r) {
          var n = Number(r.totalCount || 0);
          var b = root.querySelector('[data-cnt="' + k + '"]');
          if (b && n) { b.textContent = '確認待ち ' + n; b.style.display = ''; }
        }).catch(function () {});
    });
  }

  // ───────── 一覧 ─────────
  function viewList(cat) {
    loading();
    var info = CATS[cat];
    Promise.all([fetchAll(APP, catQ(cat), null), loadRoster()]).then(function (res) {
      var reports = res[0].map(function (r) { return toReport(cat, r); });
      var roster = res[1];
      var codes = {};
      roster.forEach(function (u) { (codes[u.role] = codes[u.role] || {})[u.code] = 1; });
      var scope = 'self';
      if ((codes.GL || {})[me.code] || (codes.BL || {})[me.code] || (codes['安全検査室'] || {})[me.code] || isDev()) scope = 'all';
      else if ((codes.TL || {})[me.code]) scope = 'tl';
      var canEdit = isDev() || roster.some(function (u) { return u.code === me.code; });
      function mine(r) {
        if (r.creator.code === me.code) return true;
        return scope === 'tl' && firstCode(r.approver_tl) === me.code;
      }
      // グループ化
      var groups = {}, order = [];
      reports.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || '') || Number(b.id) - Number(a.id); });
      reports.forEach(function (r) {
        var key, label, sortKey;
        if (cat === 'safety_patrol') {
          key = (r.report_month || '') + '|' + (r.report_period || '');
          label = r.report_month ? r.report_month + '月 ' + r.report_period : '対象期間未設定';
          sortKey = [-(Number(r.report_month) || -1), PERIODS.indexOf(r.report_period) < 0 ? 9 : PERIODS.indexOf(r.report_period)];
        } else {
          var ym = (r.inspect_date || '').slice(0, 7);
          key = ym;
          label = ym.length === 7 ? ym.slice(0, 4) + '年' + Number(ym.slice(5, 7)) + '月' : '点検日未設定';
          sortKey = [ym ? -Number(ym.replace('-', '')) : 0, 0];
        }
        if (!groups[key]) { groups[key] = { label: label, sortKey: sortKey, reports: [] }; order.push(key); }
        groups[key].reports.push(r);
      });
      var list = order.map(function (k) { return groups[k]; }).sort(function (a, b) {
        return a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1];
      });
      var h = '<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 一覧</h2><div class="flex" style="margin-bottom:14px;">' +
        '<a class="btn btn-primary" href="#/reports/' + cat + '/new">＋ 新規作成</a>' +
        (cat === 'safety_patrol' ? '<a class="btn btn-secondary" href="#/safety_patrol/status">提出状況</a>' : '') +
        (cat === 'scaffold' ? '<a class="btn btn-secondary" href="#/scaffold/status">提出状況</a>' : '') +
        '<a class="btn btn-secondary" href="#/resources/' + cat + '">資料集</a>' +
        (canEdit ? '<a class="btn btn-secondary" href="#/guides/' + cat + '">項目の手引き編集</a>' : '') +
        '<a class="btn btn-secondary" href="#/">トップに戻る</a></div>';
      if (!list.length) {
        h += '<p>まだ報告書がありません。</p></div>';
        page(h);
        return;
      }
      h += '<div class="filter-bar"><input type="text" id="search-input" class="search-input" placeholder="工事名・工事ナンバー・点検者で検索">';
      if (scope !== 'all') {
        h += '<label class="filter-label" style="display:flex; align-items:center; gap:6px; cursor:pointer; margin:0;"><input type="checkbox" id="mine-only" checked style="width:auto;">' +
          (scope === 'tl' ? '自分が承認担当の分のみ' : '自分が提出した分のみ') + '</label>';
      }
      h += '<span class="filter-label">提出月</span><select id="month-filter"><option value="">すべて</option>' +
        list.map(function (g) { return '<option value="' + esc(g.label) + '">' + esc(g.label) + '</option>'; }).join('') +
        '</select></div><p id="no-match" class="no-match-msg" style="display:none;">該当する報告書がありません。</p>';
      list.forEach(function (g, gi) {
        h += '<details class="month-group" data-label="' + esc(g.label) + '"' + (gi === 0 ? ' open' : '') + '><summary>' + esc(g.label) +
          '<span class="group-count">（' + g.reports.length + '件）</span></summary><div class="table-wrap"><table class="list-table"><thead><tr>' +
          '<th class="col-no">工事ナンバー</th><th>工事名</th>' + (cat === 'scaffold' ? '<th>足場の種類</th>' : '') +
          '<th>点検者</th><th>点検日</th>' + (info.flow.length ? '<th>状態</th>' : '') + '<th></th></tr></thead><tbody>';
        g.reports.forEach(function (r) {
          h += '<tr class="report-row" data-href="#/reports/' + cat + '/' + r.id + '" style="cursor:pointer;" data-mine="' + (mine(r) ? 1 : 0) +
            '" data-search="' + esc((r.project_no + ' ' + r.project_name + ' ' + r.inspector).toLowerCase()) + '">' +
            '<td>' + esc(r.project_no) + '</td><td>' + esc(r.project_name) + '</td>' +
            (cat === 'scaffold' ? '<td>' + esc(r.subtype) + '</td>' : '') +
            '<td style="white-space:nowrap;">' + esc(r.inspector) + '</td><td style="white-space:nowrap;">' + esc(r.inspect_date) + '</td>' +
            (info.flow.length ? '<td style="white-space:nowrap;">' + statusBadge(r.status) + '</td>' : '') +
            '<td style="white-space:nowrap;"><a class="btn btn-primary btn-sm" href="#/reports/' + cat + '/' + r.id + '">詳細</a></td></tr>';
        });
        h += '</tbody></table></div></details>';
      });
      h += '</div>';
      page(h);
      var search = root.querySelector('#search-input'), month = root.querySelector('#month-filter'), mineOnly = root.querySelector('#mine-only');
      var noMatch = root.querySelector('#no-match');
      function apply() {
        var q = search.value.trim().toLowerCase(), mo = month.value, any = false;
        root.querySelectorAll('.month-group').forEach(function (g) {
          var monthOk = !mo || g.dataset.label === mo, cnt = 0;
          g.querySelectorAll('.report-row').forEach(function (row) {
            var show = monthOk && (!q || row.dataset.search.indexOf(q) !== -1) &&
              (!mineOnly || !mineOnly.checked || q || row.dataset.mine === '1');
            row.style.display = show ? '' : 'none';
            if (show) cnt++;
          });
          if (monthOk && cnt) { g.style.display = ''; any = true; if (q || mo) g.open = true; } else { g.style.display = 'none'; }
        });
        noMatch.style.display = any ? 'none' : '';
      }
      search.addEventListener('input', apply);
      month.addEventListener('change', apply);
      if (mineOnly) { mineOnly.addEventListener('change', apply); apply(); }
      root.querySelectorAll('.report-row').forEach(function (row) {
        row.addEventListener('click', function (e) { if (!e.target.closest('a,button,input,select')) go(row.dataset.href); });
      });
    }).catch(fail);
  }

  // ───────── 新規作成・編集 ─────────
  function viewForm(cat, id, q) {
    var info = CATS[cat];
    if (cat === 'scaffold' && !id && !q.subtype) {
      page('<div class="card"><h2><span class="accent-bar"></span>' + info.label + '（新規作成）</h2><p class="footer-note">点検する足場の種類を選択してください。</p>' +
        '<div class="menu-grid" style="margin-top:14px;">' + SUBTYPES.map(function (s) {
          return '<a class="menu-card" href="#/reports/scaffold/new?subtype=' + encodeURIComponent(s) + '"><div class="title">' + esc(s) + '</div></a>';
        }).join('') + '</div><div class="flex" style="margin-top:20px;">' + backBtn(cat) + '</div></div>');
      return;
    }
    loading();
    var getRec = id ? api('/k/v1/record', 'GET', { app: APP, id: id }).then(function (r) { return toReport(cat, r.record); }) : Promise.resolve(null);
    getRec.then(function (edit) {
      var subtype = edit ? edit.subtype : q.subtype;
      var lastQ = '作成者 in ("' + me.code + '") order by $id desc limit 1';
      return Promise.all([
        Promise.resolve(edit),
        edit ? Promise.resolve(edit.items.map(function (x) { return x.item_name; })) : loadItems(cat, subtype),
        loadGuides(cat, cat === 'scaffold' ? subtype : ''),
        edit ? Promise.resolve(null) : api('/k/v1/records', 'GET', { app: APP, query: catQ(cat) + ' and ' + lastQ }).then(function (r) { return r.records[0] ? toReport(cat, r.records[0]) : null; }),
        loadRoster(), loadMyBlock(), Promise.resolve(subtype)
      ]);
    }).then(function (res) {
      renderForm(cat, res[0], res[1], res[2], res[3], res[4], res[5], res[6]);
    }).catch(fail);
  }

  function renderForm(cat, edit, checklist, guides, last, roster, block, subtype) {
    var info = CATS[cat];
    var resubmit = edit && edit.status === '差し戻し';
    var pf = { project_no: '', project_name: '', site_manager: '', inspector: me.name };
    if (last) { pf.project_no = last.project_no; pf.project_name = last.project_name; pf.site_manager = last.site_manager || ''; }
    var v = function (k, dflt) { return esc(edit ? (edit[k] || '') : (dflt || '')); };
    var now = new Date();
    var flowRoles = [].concat.apply([], info.flow);
    var byRole = {};
    roster.forEach(function (u) {
      if (block && u.block && u.block !== block) return;
      (byRole[u.role] = byRole[u.role] || []).push(u);
    });
    function notifySel(role, name, label) {
      var list = byRole[role] || [];
      return '<div class="form-row" style="flex:1; min-width:200px;"><label>' + label + '</label><select name="' + name + '"' + (list.length ? ' required' : '') + '>' +
        '<option value="" selected disabled hidden>選択してください</option>' +
        list.map(function (u) { return '<option value="' + esc(u.code) + '" data-koji="' + esc(u.koji) + '">' + esc(u.name) + '</option>'; }).join('') +
        '</select>' + (list.length ? '' : '<p class="footer-note">名簿が未登録です</p>') + '</div>';
    }
    var h = '<div class="card"><h2><span class="accent-bar"></span>' + info.label + (subtype ? '（' + esc(subtype) + '）' : '') + (edit ? '（編集）' : '（新規作成）') + '</h2>' +
      '<form id="tk-form" novalidate>' +
      '<div class="flex"><div class="form-row" style="flex:1; min-width:200px; position:relative;"><label>工事ナンバー（№・工事名で検索）</label>' +
      '<input type="text" name="project_no" id="project-no" autocomplete="off" placeholder="№か工事名の一部を入力" value="' + v('project_no', pf.project_no) + '" required>' +
      '<div id="project-suggest" class="suggest" style="display:none;"></div></div>' +
      '<div class="form-row" style="flex:2; min-width:220px;"><label>工事名</label><input type="text" name="project_name" id="project-name" value="' + v('project_name', pf.project_name) + '" required></div></div>' +
      '<div class="flex"><div class="form-row" style="flex:1; min-width:220px;"><label>点検日</label><input type="date" name="inspect_date" value="' + (edit ? esc(edit.inspect_date) : iso(now)) + '" required></div>' +
      '<div class="form-row" style="flex:1; min-width:160px;"><label>点検者</label><input type="text" name="inspector" value="' + v('inspector', pf.inspector) + '" required></div></div>';

    if (!edit && info.flow.length) {
      h += '<h2 style="margin-top:24px;"><span class="accent-bar"></span>提出先（kintone通知）</h2>' +
        (block ? '<p class="footer-note" style="margin:-4px 0 10px;">' + esc(block) + 'の名簿から表示しています（ログイン者の所属ブロックで自動判定）</p>' : '') + '<div class="flex">';
      if (flowRoles.indexOf('TL') >= 0) h += notifySel('TL', 'notify_tl', '承認するTL');
      if (flowRoles.indexOf('GL') >= 0) h += notifySel('GL', 'notify_gl', '承認するGL');
      if (flowRoles.indexOf('BL') >= 0) h += notifySel('BL', 'notify_bl', '承認するBL');
      if (cat === 'safety_patrol') h += notifySel('安全検査室', 'notify_safety', '安全検査室（同時通知）');
      h += '</div>';
    }

    if (cat === 'scaffold') {
      var cur = edit ? edit.inspect_reason : '';
      h += '<h2 style="margin-top:24px;"><span class="accent-bar"></span>点検実施理由</h2><div class="flex" style="align-items:flex-end;">' +
        '<div class="form-row" style="min-width:200px;"><label>点検実施理由（必須）</label><select name="inspect_reason" id="inspect-reason" required>' +
        '<option value=""' + (cur ? '' : ' selected') + ' disabled hidden>選択してください</option>' +
        REASONS.map(function (r) { return '<option value="' + r + '"' + (cur === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-row" id="inspect-reason-other-row" style="flex:1; min-width:220px;' + (cur === 'その他' ? '' : ' display:none;') + '"><label>その他の内容（必須）</label>' +
        '<input type="text" name="inspect_reason_other" id="inspect-reason-other" value="' + v('inspect_reason_other') + '" placeholder="例：外部足場のメッシュシート張替え後"></div></div>' +
        '<h2 style="margin-top:24px;"><span class="accent-bar"></span>組立者・点検者の資格情報</h2><div class="flex">' +
        '<div class="form-row" style="flex:1; min-width:160px;"><label>組立者氏名</label><input type="text" name="assembler_name" value="' + v('assembler_name') + '"></div>' +
        '<div class="form-row" style="flex:1; min-width:200px;"><label>組立者の資格名</label><input type="text" name="assembler_qual" placeholder="例：足場の組立て等作業主任者" value="' + v('assembler_qual') + '"></div>' +
        '<div class="form-row" style="flex:1; min-width:160px;"><label>組立者の資格番号</label><input type="text" name="assembler_qual_no" value="' + v('assembler_qual_no') + '"></div></div>' +
        '<div class="flex"><div class="form-row" style="flex:1; min-width:200px;"><label>点検者の資格名</label><input type="text" name="inspector_qual" placeholder="例：足場の組立て等作業主任者（能力向上教育修了）" value="' + v('inspector_qual') + '"></div>' +
        '<div class="form-row" style="flex:1; min-width:160px;"><label>点検者の資格番号</label><input type="text" name="inspector_qual_no" value="' + v('inspector_qual_no') + '"></div></div>';
    }

    if (cat === 'safety_patrol') {
      var curMonth = edit ? edit.report_month : String(now.getMonth() + 1);
      var curPeriod = edit ? edit.report_period : '';
      h += '<div class="flex"><div class="form-row" style="flex:1; min-width:160px;"><label>作業所長</label><input type="text" name="site_manager" value="' + v('site_manager', pf.site_manager) + '"></div>' +
        '<div class="form-row" style="flex:1; min-width:120px;"><label>対象月</label><select name="report_month">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return '<option value="' + m + '"' + (String(m) === curMonth ? ' selected' : '') + '>' + m + '月</option>'; }).join('') + '</select></div>' +
        '<div class="form-row" style="flex:1; min-width:120px;"><label>旬</label><select name="report_period">' +
        PERIODS.map(function (p) { return '<option value="' + p + '"' + (curPeriod === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-row" style="flex:1; min-width:120px;"><label>第○回</label><input type="number" name="report_round" min="1" placeholder="回数" value="' + v('report_round') + '"></div></div>' +
        '<h2 style="margin-top:24px;"><span class="accent-bar"></span>災害防止協議会及び教育</h2><div class="flex">' +
        '<div class="form-row" style="flex:1; min-width:160px;"><label>実施日</label><input type="date" name="meeting_date" value="' + v('meeting_date') + '"></div>' +
        '<div class="form-row" style="flex:2; min-width:220px;"><label>参加者名</label><input type="text" name="meeting_attendees" placeholder="参加者名を記入" value="' + v('meeting_attendees') + '"></div></div>' +
        '<div class="form-row"><label>協議事項・管理重点事項</label><textarea name="meeting_notes" rows="3">' + v('meeting_notes') + '</textarea></div>';
    }

    h += '<h2 style="margin-top:24px;"><span class="accent-bar"></span>点検項目</h2><div class="legend">' + LEGEND + '</div>' +
      '<div class="table-wrap"><table class="item-table"><thead><tr><th style="width:42px;">No</th><th>点検項目</th><th style="width:120px;">点検結果</th><th>備考</th></tr></thead><tbody>';
    checklist.forEach(function (item, i) {
      var curR = edit && edit.items[i] ? edit.items[i].result : '';
      h += '<tr><td class="no">' + (i + 1) + '</td><td>' + esc(item) +
        (guides[item] ? '<button type="button" class="guide-link" data-item="' + esc(item) + '">解説</button>' : '') + '</td>' +
        '<td><select name="result_' + i + '" required><option value=""' + (curR ? '' : ' selected') + ' disabled hidden>選択</option>' +
        OPTIONS.map(function (o) { return '<option value="' + o + '"' + (curR === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></td>' +
        '<td><input type="text" name="note_' + i + '" placeholder="必要に応じて記入" value="' + esc(edit && edit.items[i] ? edit.items[i].note : '') + '"></td></tr>';
    });
    if (!checklist.length) h += '<tr><td colspan="4">点検項目が設定されていません（共通設定アプリを確認してください）。</td></tr>';
    h += '</tbody></table></div><div class="flex" style="margin-top:20px;">';
    if (resubmit) h += '<button type="submit" class="btn btn-primary">修正して再提出（TLへ通知）</button><a href="#/reports/' + cat + '/' + edit.id + '" class="btn btn-secondary">キャンセル</a>';
    else if (edit) h += '<button type="submit" class="btn btn-primary">更新する</button><a href="#/reports/' + cat + '/' + edit.id + '" class="btn btn-secondary">キャンセル</a>';
    else h += '<button type="submit" class="btn btn-primary">報告書を提出</button>' + backBtn(cat).replace('一覧に戻る', 'キャンセル');
    h += '</div></form></div>';
    page(h);

    var form = root.querySelector('#tk-form');
    bindGuideLinks(guides);
    bindProjectSuggest(form);
    if (cat === 'scaffold') {
      var sel = form.querySelector('#inspect-reason'), row = form.querySelector('#inspect-reason-other-row'), inp = form.querySelector('#inspect-reason-other');
      var sync = function () { var o = sel.value === 'その他'; row.style.display = o ? '' : 'none'; inp.required = o; };
      sel.addEventListener('change', function () { sync(); if (sel.value === 'その他') inp.focus(); });
      sync();
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      saveForm(cat, edit, checklist, subtype, form).catch(fail);
    });
  }

  function bindProjectSuggest(form) {
    var noInput = form.querySelector('#project-no'), nameInput = form.querySelector('#project-name'), box = form.querySelector('#project-suggest');
    var list = [], names = {};
    loadProjects().then(function (l) { list = l; l.forEach(function (p) { names[p.no] = p.name; }); });
    function render() {
      var q = noInput.value.trim().toLowerCase();
      if (!q || !list.length) { box.style.display = 'none'; return; }
      var hits = list.filter(function (p) { return p.no.indexOf(q) !== -1 || p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 20);
      if (!hits.length) { box.style.display = 'none'; return; }
      box.innerHTML = hits.map(function (p) {
        return '<div class="sg-row" data-no="' + esc(p.no) + '"><span style="font-weight:700; margin-right:10px;">' + esc(p.no) + '</span><span>' + esc(p.name) + '</span></div>';
      }).join('');
      box.style.display = 'block';
    }
    box.addEventListener('mousedown', function (e) {
      var r = e.target.closest('.sg-row');
      if (!r) return;
      e.preventDefault();
      noInput.value = r.dataset.no;
      box.style.display = 'none';
      apply();
    });
    function apply() {
      var no = noInput.value.trim(), name = names[no];
      if (!name) return;
      nameInput.value = name;
      ['notify_tl', 'notify_gl', 'notify_bl', 'notify_safety'].forEach(function (fn) {
        var sel = form.querySelector('select[name="' + fn + '"]');
        if (!sel || sel.value) return;
        for (var i = 0; i < sel.options.length; i++) {
          var koji = sel.options[i].dataset ? sel.options[i].dataset.koji : '';
          if (koji && koji.split(/[،,、\s]+/).indexOf(no) !== -1) {
            sel.value = sel.options[i].value;
            sel.style.borderColor = '#b3382c';
            sel.style.background = '#fbeeec';
            var note = sel.parentNode.querySelector('.auto-note');
            if (!note) { note = document.createElement('p'); note.className = 'footer-note auto-note'; note.style.color = '#b3382c'; sel.parentNode.appendChild(note); }
            note.textContent = '工事№の担当として「' + sel.options[i].textContent + '」を自動選択しました。違う場合は変更してください。';
            sel.addEventListener('change', function () {
              this.style.borderColor = ''; this.style.background = '';
              var n = this.parentNode.querySelector('.auto-note'); if (n) n.remove();
            }, { once: true });
            break;
          }
        }
      });
    }
    noInput.addEventListener('input', function () { render(); apply(); });
    noInput.addEventListener('focus', render);
    noInput.addEventListener('change', apply);
    noInput.addEventListener('blur', function () { setTimeout(function () { box.style.display = 'none'; }, 150); });
    noInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.style.display = 'none'; });
  }

  function saveForm(cat, edit, checklist, subtype, form) {
    var info = CATS[cat];
    var f = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var no = f('project_no');
    var rec = {
      project_no: { value: no }, project_name: { value: f('project_name') }, inspect_date: { value: f('inspect_date') },
      inspector: { value: f('inspector') },
      checklist: { value: checklist.map(function (item, i) {
        return { value: { item_no: { value: i + 1 }, item_name: { value: item }, item_result: { value: f('result_' + i) }, item_note: { value: f('note_' + i) } } };
      }) }
    };
    if (!edit) rec.category = { value: info.label };
    if (cat === 'safety_patrol') {
      ['site_manager', 'report_month', 'report_period', 'report_round', 'meeting_attendees', 'meeting_notes'].forEach(function (k) { rec[k] = { value: f(k) }; });
      rec.meeting_date = { value: f('meeting_date') || null };
    }
    if (cat === 'scaffold') {
      rec.subtype = { value: subtype };
      ['inspect_reason', 'assembler_name', 'assembler_qual', 'assembler_qual_no', 'inspector_qual', 'inspector_qual_no'].forEach(function (k) { rec[k] = { value: f(k) }; });
      rec.inspect_reason_other = { value: f('inspect_reason') === 'その他' ? f('inspect_reason_other') : '' };
    }
    if (!edit && info.flow.length) {
      rec.approver_tl = { value: [{ code: f('notify_tl') }] };
      if (cat === 'disaster') { rec.approver_gl = { value: [{ code: f('notify_gl') }] }; rec.approver_bl = { value: [{ code: f('notify_bl') }] }; }
      if (cat === 'safety_patrol') rec.safety_officer = { value: f('notify_safety') ? [{ code: f('notify_safety') }] : [] };
    }
    overlay('送信中...');
    var p;
    if (edit) {
      var resub = edit.status === '差し戻し';
      if (resub && edit.returns.length) {
        rec.returns = { value: edit.raw.returns.value.map(function (row, i, arr) {
          var v = JSON.parse(JSON.stringify(row));
          delete v.id;
          if (i === arr.length - 1) v.value.rt_resub_at = { value: nowIso() };
          return { value: v.value };
        }) };
      }
      p = api('/k/v1/record', 'PUT', { app: APP, id: edit.id, record: rec }).then(function () {
        if (resub) return statusAction(APP, edit.id, '再提出する（差し戻し後）', firstCode(edit.approver_tl));
      }).then(function () { return edit.id; });
    } else {
      p = api('/k/v1/record', 'POST', { app: APP, record: rec }).then(function (r) {
        if (!info.flow.length) return statusAction(APP, r.id, '記録する', null).then(function () { return r.id; });
        return statusAction(APP, r.id, '提出する', f('notify_tl')).then(function () { return r.id; });
      });
    }
    return p.then(function (rid) { go('#/reports/' + cat + '/' + rid); });
  }

  // ───────── 手引きモーダル ─────────
  function bindGuideLinks(guides) {
    root.querySelectorAll('.guide-link').forEach(function (b) {
      b.addEventListener('click', function () { showGuide(b.dataset.item, guides[b.dataset.item]); });
    });
  }
  function downloadBlob(fileKey) {
    return fetch(kintone.api.url('/k/v1/file', true) + '?fileKey=' + encodeURIComponent(fileKey), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
    }).then(function (r) { if (!r.ok) throw new Error('ファイルの取得に失敗しました（' + r.status + '）'); return r.blob(); });
  }
  function showGuide(item, g) {
    var m = document.getElementById('tk-guide');
    m.querySelector('.g-title').textContent = item;
    var imgs = m.querySelector('.g-images'), desc = m.querySelector('.g-desc'), empty = m.querySelector('.g-empty');
    imgs.innerHTML = '';
    desc.textContent = g ? g.body.value : '';
    desc.style.display = g && g.body.value ? 'block' : 'none';
    empty.style.display = g && (g.body.value || g.images.value.length) ? 'none' : 'block';
    (g ? g.images.value : []).forEach(function (f) {
      downloadBlob(f.fileKey).then(function (b) {
        var img = document.createElement('img');
        img.className = 'g-image';
        img.alt = '参考画像';
        img.src = URL.createObjectURL(b);
        imgs.appendChild(img);
      }).catch(function () {});
    });
    m.classList.add('show');
  }

  // ───────── 詳細 ─────────
  function currentStep(info, rep) {
    if (rep.status === 'TL承認待ち') return 0;
    if (rep.status === 'GL・BL承認待ち') return 1;
    return null;
  }
  function canApprove(rep, role) {
    var code = firstCode(rep[ROLE_FIELD[role]]);
    if (code !== me.code) return false;
    return rep.assignees.indexOf(me.code) >= 0;
  }

  function viewDetail(cat, id) {
    loading();
    var info = CATS[cat];
    Promise.all([api('/k/v1/record', 'GET', { app: APP, id: id }), loadGuides(cat, null)]).then(function (res) {
      var rep = toReport(cat, res[0].record);
      return loadGuides(cat, cat === 'scaffold' ? rep.subtype : '').then(function (g) { renderDetail(cat, rep, g); });
    }).catch(fail);
  }

  function renderDetail(cat, rep, guides) {
    var info = CATS[cat];
    var flow = info.flow;
    var tr = function (k, v) { return '<tr><th style="width:160px;">' + k + '</th><td>' + v + '</td></tr>'; };
    var q = function (n, no) { return esc(n || '') + (no ? '（資格番号：' + esc(no) + '）' : ''); };
    var h = '<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 詳細</h2><table style="margin-bottom:20px;">' +
      tr('工事名', esc(rep.project_name)) + tr('工事ナンバー', esc(rep.project_no)) +
      (cat === 'scaffold' ? tr('足場の種類', esc(rep.subtype)) : '') +
      tr('点検日', esc(rep.inspect_date)) + tr('点検者', esc(rep.inspector));
    if (cat === 'scaffold') {
      h += tr('点検実施理由', esc(rep.reason_text)) + tr('点検者の資格', q(rep.inspector_qual, rep.inspector_qual_no)) +
        tr('組立者', esc(rep.assembler_name)) + tr('組立者の資格', q(rep.assembler_qual, rep.assembler_qual_no));
    }
    if (cat === 'safety_patrol') {
      h += tr('作業所長', esc(rep.site_manager)) + tr('対象期間', rep.report_month ? esc(rep.report_month + '月 ' + rep.report_period) : '') +
        tr('第○回', esc(rep.report_round));
    }
    var names = [];
    [['TL', 'approver_tl'], ['GL', 'approver_gl'], ['BL', 'approver_bl'], ['安全検査室', 'safety_officer']].forEach(function (x) {
      if (rep[x[1]] && rep[x[1]].length) names.push(x[0] + '：' + users(rep[x[1]]));
    });
    if (names.length) h += tr('提出先（通知先）', esc(names.join('　／　')));
    if (flow.length) h += tr('状態', statusBadge(rep.status));
    h += '</table>';
    var lr = rep.returns[rep.returns.length - 1];
    if (rep.status === '差し戻し' && lr) {
      h += '<div class="return-box"><div class="return-title">差し戻されています（' + esc(lr.role) + '：' + esc(lr.by) + '　' + dt(lr.at) + '）</div>' +
        (lr.reason ? '<div class="return-reason">' + esc(lr.reason) + '</div>' : '') +
        '<a class="btn btn-primary btn-sm" href="#/reports/' + cat + '/' + rep.id + '/edit">修正して再提出する</a></div>';
    }
    h += '<h2><span class="accent-bar"></span>点検項目</h2><div class="legend">' + LEGEND + '</div>' +
      '<div class="table-wrap"><table class="item-table"><thead><tr><th style="width:42px;">No</th><th>点検項目</th><th style="width:100px;">点検結果</th><th>備考</th></tr></thead><tbody>';
    rep.items.forEach(function (it, i) {
      h += '<tr><td class="no">' + (i + 1) + '</td><td>' + esc(it.item_name) +
        (guides[it.item_name] ? '<button type="button" class="guide-link" data-item="' + esc(it.item_name) + '">解説</button>' : '') +
        '</td><td style="text-align:center; font-weight:700;">' + esc(it.result) + '</td><td>' + esc(it.note) + '</td></tr>';
    });
    h += '</tbody></table></div></div>';

    if (cat === 'safety_patrol') {
      h += '<div class="card"><h2><span class="accent-bar"></span>災害防止協議会及び教育</h2><table>' +
        tr('実施日', esc(rep.meeting_date)) + tr('参加者名', esc(rep.meeting_attendees)) +
        tr('協議事項・管理重点事項', esc(rep.meeting_notes).replace(/\n/g, '<br>')) + '</table></div>';
    }

    if (flow.length) {
      var label = flow.map(function (s) { return s.join('・'); }).join(' → ');
      var cur = currentStep(info, rep);
      h += '<div class="card"><h2><span class="accent-bar"></span>承認欄（' + label + '）</h2>';
      if (!rep.approvals.length && rep.status === '確認済' && rep.legacy_note) {
        h += '<table>' + tr('移行前の記録', esc(rep.legacy_note).replace(/\n/g, '<br>')) + '</table>';
      } else {
        flow.forEach(function (roles, si) {
          h += '<div style="border:1px solid var(--line); border-radius:4px; padding:14px 16px; margin-bottom:12px;"><div style="font-weight:700; margin-bottom:8px;">' +
            (si + 1) + '. ' + roles.join('・') + '承認' + (roles.length > 1 ? '（両者の承認で完了・順不同）' : '') + '</div>';
          roles.forEach(function (role) {
            var a = rep.approvals.filter(function (x) { return x.step === si && x.role === role; })[0];
            h += '<div style="' + (roles.length > 1 ? 'border-top:1px dashed var(--line); padding-top:10px; margin-top:10px;' : '') + '">' +
              (roles.length > 1 ? '<div style="font-weight:500; margin-bottom:6px;">' + role + '</div>' : '');
            if (a) {
              h += '<table>' + tr('承認者', esc(a.name)) + tr('承認日時', dt(a.at)) + tr('コメント', esc(a.comment)) + '</table>';
            } else if (cur === si && !canApprove(rep, role)) {
              h += '<p class="footer-note">担当の' + role + 'のみ承認できます（承認待ち）。</p>';
            } else if (cur === si) {
              h += '<form class="approve-form" data-role="' + role + '" data-step="' + si + '"><div class="form-row">' +
                '<label style="font-size:0.95rem; display:flex; align-items:center; gap:8px; cursor:pointer;"><input type="checkbox" name="approve_check" required style="width:auto; transform:scale(1.4);">' +
                '内容を確認し、' + role + 'として承認します（承認者：' + esc(me.name) + '・承認日は自動記録）</label></div>' +
                '<div class="form-row"><label>コメント（任意）</label><textarea name="comment" rows="2"></textarea></div>' +
                '<div class="flex"><button type="submit" class="btn btn-success">' + role + '承認する</button>' +
                '<a class="btn btn-return" href="#/reports/' + cat + '/' + rep.id + '/return?role=' + role + '">差し戻し</a></div></form>';
            } else if (rep.status === '差し戻し' || rep.status === '未提出') {
              h += '<p class="footer-note">' + (rep.status === '差し戻し' ? '差し戻し中です（再提出後に承認できます）。' : '提出前です。') + '</p>';
            } else {
              h += '<p class="footer-note">前の段階の承認待ちです。</p>';
            }
            h += '</div>';
          });
          h += '</div>';
        });
      }
      h += '</div>';
    }

    if (rep.returns.length) {
      h += '<div class="card"><h2><span class="accent-bar"></span>差し戻し履歴</h2><table><thead><tr><th style="width:150px;">差し戻し日時</th><th style="width:150px;">差し戻した人</th><th>理由</th><th style="width:150px;">再提出日時</th></tr></thead><tbody>' +
        rep.returns.map(function (r) {
          return '<tr><td>' + dt(r.at) + '</td><td>' + esc(r.role) + '：' + esc(r.by) + '</td><td style="white-space:pre-wrap;">' + esc(r.reason) + '</td><td>' + (r.resub_at ? dt(r.resub_at) : '未再提出') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    h += '<div class="flex">' + backBtn(cat) + '<button type="button" class="btn btn-primary" id="btn-pdf">PDF保存</button>' +
      (cat === 'safety_patrol' && rep.project_no ? '<button type="button" class="btn btn-secondary" id="btn-bulk">この工事の旬報を一括PDF</button>' : '') +
      '<a href="#/reports/' + cat + '/' + rep.id + '/edit" class="btn btn-secondary">編集</a>' +
      '<button type="button" class="btn btn-danger" id="btn-del">削除</button></div>';
    page(h);
    bindGuideLinks(guides);

    root.querySelectorAll('.approve-form').forEach(function (fm) {
      fm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!fm.reportValidity()) return;
        approve(cat, rep, fm.dataset.role, Number(fm.dataset.step), fm.elements.comment.value.trim()).catch(fail);
      });
    });
    root.querySelector('#btn-pdf').addEventListener('click', function () {
      overlay('PDF作成中...');
      (cat === 'safety_patrol' ? junpoPdf([rep]) : tablePdf(cat, rep)).then(function (bytes) {
        overlay(null);
        saveBytes(bytes, pdfName(cat, rep));
      }).catch(fail);
    });
    var bulk = root.querySelector('#btn-bulk');
    if (bulk) bulk.addEventListener('click', function () { junpoBulk(rep.project_no).catch(fail); });
    root.querySelector('#btn-del').addEventListener('click', function () {
      if (!confirm('この報告書を削除しますか？この操作は取り消せません。')) return;
      overlay('削除中...');
      api('/k/v1/records', 'DELETE', { app: APP, ids: [rep.id] }).then(function () { go('#/reports/' + cat); }).catch(fail);
    });
  }

  function approve(cat, rep, role, step, comment) {
    var info = CATS[cat];
    overlay('送信中...');
    var rows = rep.raw.approvals.value.map(function (r) { return { value: r.value }; });
    rows.push({ value: { ap_step: { value: step }, ap_role: { value: role }, ap_name: { value: me.name }, ap_code: { value: me.code },
                         ap_comment: { value: comment }, ap_at: { value: nowIso() } } });
    var action = step === 1 ? '承認する（GL・BL）' : (cat === 'disaster' ? '承認する（TL）' : '承認する');
    return api('/k/v1/record', 'PUT', { app: APP, id: rep.id, record: { approvals: { value: rows } } })
      .then(function () { return statusAction(APP, rep.id, action, null); })
      .then(function () { route(); });
  }

  // ───────── 差し戻し ─────────
  function viewReturn(cat, id, q) {
    loading();
    var info = CATS[cat], role = q.role || 'TL';
    api('/k/v1/record', 'GET', { app: APP, id: id }).then(function (r) {
      var rep = toReport(cat, r.record);
      if (currentStep(info, rep) === null || !canApprove(rep, role)) { go('#/reports/' + cat + '/' + id); return; }
      var tr = function (k, v) { return '<tr><th style="width:140px;">' + k + '</th><td>' + v + '</td></tr>'; };
      page('<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 差し戻し</h2><table style="margin-bottom:18px;">' +
        tr('工事名', esc(rep.project_name)) + tr('工事ナンバー', esc(rep.project_no)) +
        (rep.report_month ? tr('対象期間', esc(rep.report_month + '月 ' + rep.report_period)) : '') +
        tr('点検者', esc(rep.inspector)) + tr('差し戻す人', esc(role + '：' + me.name)) + '</table>' +
        '<p class="footer-note">差し戻すと提出者にkintone通知が届き、承認は最初（TL）からやり直しになります。提出者が修正して再提出すると、TLへ「差し戻し後の再提出」として通知されます。</p>' +
        '<form id="ret-form" style="margin-top:12px;"><div class="form-row"><label>差し戻し理由（任意）</label>' +
        '<textarea name="reason" rows="5" placeholder="例：No.12 の点検結果が未記入です。備考に是正内容を記載してください。"></textarea></div>' +
        '<div class="flex"><button type="submit" class="btn btn-danger">差し戻す</button><a class="btn btn-secondary" href="#/reports/' + cat + '/' + id + '">キャンセル</a></div></form></div>');
      root.querySelector('#ret-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var reason = e.target.elements.reason.value.trim();
        overlay('送信中...');
        var rets = rep.raw.returns.value.map(function (x) { return { value: x.value }; });
        rets.push({ value: { rt_role: { value: role }, rt_by: { value: me.name }, rt_reason: { value: reason }, rt_at: { value: nowIso() }, rt_resub_at: { value: null } } });
        var action = currentStep(info, rep) === 1 ? '差し戻す（GL・BL）' : '差し戻す';
        api('/k/v1/record', 'PUT', { app: APP, id: id, record: { returns: { value: rets }, approvals: { value: [] }, return_reason: { value: reason } } })
          .then(function () { return statusAction(APP, id, action, rep.creator.code); })
          .then(function () { go('#/reports/' + cat + '/' + id); }).catch(fail);
      });
    }).catch(fail);
  }

  // ───────── 提出状況（安全旬報・足場） ─────────
  function loadStatusConf() {
    return fetchAll(JUNPO_CONF, 'kind in ("対象期間", "対象外", "追加対象")', null);
  }
  function loadTargets(extras) {
    var key = 'targets:' + extras.join(',');
    if (!cache[key]) {
      var today = iso(new Date());
      cache[key] = fetchAll(MASTER_APP, '(mkbJsYmd > TODAY() or mkuKsYmd > TODAY())',
        ['KojiNo', 'mkbKojiName', 'mkbJsYmd', 'mkuKsYmd', 'mkbJkYmd', 'mkuKkYmd']).then(function (recs) {
        var map = {};
        recs.forEach(function (r) {
          var no = String(r.KojiNo.value || '').split('.')[0];
          var end = r.mkbJsYmd.value || r.mkuKsYmd.value || '';
          if (no.length !== 8 || (no.slice(2, 5) !== '041' && extras.indexOf(no) < 0) || end <= today) return;
          if (!map[no]) map[no] = { no: no, name: r.mkbKojiName.value || '', start: r.mkbJkYmd.value || r.mkuKkYmd.value || '', end: end };
        });
        return Object.keys(map).sort().map(function (k) { return map[k]; });
      });
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }
  function ymFrom(q) {
    var n = new Date();
    var y = Number(q.year) || n.getFullYear(), m = Number(q.month) || n.getMonth() + 1;
    var prev = m === 1 ? [y - 1, 12] : [y, m - 1], next = m === 12 ? [y + 1, 1] : [y, m + 1];
    return { y: y, m: m, prev: prev, next: next, last: new Date(y, m, 0).getDate() };
  }

  function viewJunpoStatus(q) {
    loading();
    var t = ymFrom(q), y = t.y, m = t.m, last = t.last;
    loadStatusConf().then(function (conf) {
      var extras = conf.filter(function (r) { return r.kind.value === '追加対象'; }).map(function (r) { return r.koji_no.value.trim(); });
      return Promise.all([loadTargets(extras),
        fetchAll(APP, catQ('safety_patrol') + ' and report_month = ' + m + ' and inspect_date >= "' + y + '-01-01" and inspect_date <= "' + y + '-12-31"',
          ['project_no', 'project_name', 'report_period', 'ステータス']), conf]);
    }).then(function (res) {
      var projects = res[0], recs = res[1], conf = res[2];
      var periods = {}, excluded = {};
      conf.forEach(function (r) {
        var no = (r.koji_no.value || '').trim();
        if (r.kind.value === '対象期間') periods[no] = r;
        if (r.kind.value === '対象外' && Number(r.year.value) === y && Number(r.month.value) === m) excluded[no + '|' + r.period.value] = r;
      });
      var rank = { '確認済': 3, '差し戻し': 2, 'TL承認待ち': 1, '未提出': 0 };
      var cells = {}, names = {};
      recs.forEach(function (r) {
        var no = String(r.project_no.value || '').trim();
        names[no] = names[no] || r.project_name.value;
        var st = r['ステータス'].value, cur = (cells[no] = cells[no] || {})[r.report_period.value];
        if (!cur || rank[st] > rank[cur.raw]) {
          cells[no][r.report_period.value] = { raw: st, id: r.$id.value,
            status: st === '確認済' ? '承認済' : (st === '差し戻し' ? '差し戻し' : '提出済') };
        }
      });
      var deadlines = { '上旬': 10, '中旬': 20, '下旬': last };
      var ranges = { '上旬': [1, 10], '中旬': [11, 20], '下旬': [21, last] };
      var today = iso(new Date());
      var ds = function (d) { return y + '-' + pad(m) + '-' + pad(d); };
      function cellFor(no, per, start, end) {
        var c = (cells[no] || {})[per];
        if (c) return c;
        if ((start && start > ds(ranges[per][1])) || (end && end < ds(ranges[per][0]))) return { status: '期間外' };
        if (excluded[no + '|' + per]) return { status: '対象外', ex: excluded[no + '|' + per] };
        return { status: today > ds(deadlines[per]) ? '期限超過' : '未提出' };
      }
      var rows = projects.map(function (p) {
        var pc = periods[p.no];
        var start = pc ? pc.start_date.value || '' : p.start, end = pc ? pc.end_date.value || '' : p.end;
        var cs = {};
        PERIODS.forEach(function (per) { cs[per] = cellFor(p.no, per, start, end); });
        return { no: p.no, name: p.name, start: start, end: end, custom: !!pc, pc: pc, cells: cs,
                 allOut: PERIODS.every(function (per) { return cs[per].status === '期間外'; }) };
      });
      rows.sort(function (a, b) { return (a.allOut ? 1 : 0) - (b.allOut ? 1 : 0); });
      var listed = {};
      projects.forEach(function (p) { listed[p.no] = 1; });
      var extra = Object.keys(cells).filter(function (no) { return !listed[no]; }).sort();

      function cell(no, per, c, editable) {
        var h = '<td class="status-cell">';
        if (c.id) {
          h += '<a href="#/reports/safety_patrol/' + c.id + '" class="badge ' + (c.status === '承認済' ? 'badge-done' : (c.status === '差し戻し' ? 'badge-overdue' : 'badge-pending')) + '">' + c.status + '</a>';
        } else if (c.status === '期間外') {
          h += '<span class="period-out">期間外</span>';
        } else if (c.status === '対象外') {
          h += '<span class="badge badge-none" title="' + esc(c.ex['作成者'].value.name) + 'が対象外に設定">対象外</span>' +
            (editable ? '<div class="excl-form"><button type="button" class="excl-btn" data-act="unexcl" data-id="' + c.ex.$id.value + '">対象に戻す</button></div>' : '');
        } else {
          h += '<span class="badge ' + (c.status === '期限超過' ? 'badge-overdue' : 'badge-none') + '">' + (c.status === '未提出' ? '未提出' : '未提出（期限超過）') + '</span>' +
            (editable ? '<div class="excl-form"><button type="button" class="excl-btn" data-act="excl" data-no="' + no + '" data-per="' + per + '">対象外にする</button></div>' : '');
        }
        return h + '</td>';
      }
      var h = '<div class="card"><h2><span class="accent-bar"></span>安全旬報 提出状況</h2>' +
        '<p class="footer-note">対象現場：工事№の3〜5桁目が「041」（＋個別指定の小工事）で、工期終了日が今日より後の工事（工事マスタより・1時間ごとに更新）<br>' +
        '対象期間：初期値は工事マスタの工期（開始〜終了）。「変更」から現場ごとに設定でき、期間外の旬は「期間外」となり赤表示されません。<br>' +
        '提出期限：上旬 ' + m + '/10、中旬 ' + m + '/20、下旬 ' + m + '/' + last + '。期限を過ぎた未提出は赤く表示します。</p>' +
        '<div class="flex" style="align-items:center; margin:12px 0 16px;"><a class="btn btn-secondary btn-sm" href="#/safety_patrol/status?year=' + t.prev[0] + '&month=' + t.prev[1] + '">← 前月</a>' +
        '<span style="font-size:1.25rem; font-weight:700;">' + y + '年' + m + '月</span><a class="btn btn-secondary btn-sm" href="#/safety_patrol/status?year=' + t.next[0] + '&month=' + t.next[1] + '">翌月 →</a>' +
        '<span style="margin-left:auto;" class="footer-note">今月の対象 ' + rows.filter(function (r) { return !r.allOut; }).length + ' 現場（一覧 ' + rows.length + ' 現場）</span></div>' +
        '<div class="table-wrap"><table class="list-table"><thead><tr><th class="col-no">工事ナンバー</th><th>工事名</th><th style="width:190px;">対象期間</th>' +
        PERIODS.map(function (p) { return '<th style="width:150px; text-align:center;">' + p + '<br><span style="font-weight:400; font-size:0.75rem;">〜' + m + '/' + deadlines[p] + '</span></th>'; }).join('') +
        '</tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr class="' + (r.allOut ? 'row-out' : '') + '"><td>' + r.no + '<br><button type="button" class="excl-btn" data-act="bulk" data-no="' + r.no + '">一括PDF</button></td>' +
          '<td>' + esc(r.name) + '</td><td class="period-cell"><span class="' + (r.custom ? 'custom' : '') + '" title="' + (r.custom ? '手動設定' : '工事マスタの工期') + '">' +
          (r.start || '未定').replace(/-/g, '/') + ' 〜 ' + (r.end || '未定').replace(/-/g, '/') + '</span> <button type="button" class="excl-btn" data-act="toggle">変更</button>' +
          '<div class="period-form" data-no="' + r.no + '" data-id="' + (r.pc ? r.pc.$id.value : '') + '"><input type="date" name="start_date" value="' + r.start + '"> 〜<br>' +
          '<input type="date" name="end_date" value="' + r.end + '"><div style="margin-top:4px;"><button type="button" class="btn btn-primary btn-sm" data-act="psave">保存</button>' +
          (r.custom ? ' <button type="button" class="btn btn-secondary btn-sm" data-act="preset">工期に戻す</button>' : '') + '</div></div></td>' +
          PERIODS.map(function (per) { return cell(r.no, per, r.cells[per], true); }).join('') + '</tr>';
      });
      if (!rows.length) h += '<tr><td colspan="6">対象現場が取得できませんでした。</td></tr>';
      h += '</tbody></table></div>';
      if (extra.length) {
        h += '<h3 style="margin-top:22px; font-size:1rem;">対象リスト外の工事№で提出されたもの</h3><div class="table-wrap"><table class="list-table"><thead><tr><th class="col-no">工事ナンバー</th><th>工事名</th>' +
          PERIODS.map(function (p) { return '<th style="width:130px; text-align:center;">' + p + '</th>'; }).join('') + '</tr></thead><tbody>' +
          extra.map(function (no) {
            return '<tr><td>' + esc(no) + '<br><button type="button" class="excl-btn" data-act="bulk" data-no="' + esc(no) + '">一括PDF</button></td><td>' + esc(names[no]) + '</td>' +
              PERIODS.map(function (per) { return cell(no, per, (cells[no] || {})[per] || { status: '未提出' }, false); }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }
      h += '</div><div class="flex">' + backBtn('safety_patrol') + '</div>';
      page(h);
      root.querySelector('.container').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.dataset.act, reload = function () { route(); };
        if (act === 'toggle') b.nextElementSibling.classList.toggle('open');
        else if (act === 'bulk') junpoBulk(b.dataset.no).catch(fail);
        else if (act === 'excl') {
          if (!confirm(b.dataset.no + ' の' + y + '年' + m + '月' + b.dataset.per + 'を提出対象外にしますか？')) return;
          overlay('送信中...');
          api('/k/v1/record', 'POST', { app: JUNPO_CONF, record: { kind: { value: '対象外' }, koji_no: { value: b.dataset.no },
            year: { value: y }, month: { value: m }, period: { value: b.dataset.per } } }).then(reload).catch(fail);
        } else if (act === 'unexcl') {
          overlay('送信中...');
          api('/k/v1/records', 'DELETE', { app: JUNPO_CONF, ids: [b.dataset.id] }).then(reload).catch(fail);
        } else if (act === 'psave' || act === 'preset') {
          var fm = b.closest('.period-form'), id = fm.dataset.id;
          var s = fm.querySelector('[name=start_date]').value, en = fm.querySelector('[name=end_date]').value;
          overlay('送信中...');
          var p;
          if (act === 'preset' || (!s && !en)) p = id ? api('/k/v1/records', 'DELETE', { app: JUNPO_CONF, ids: [id] }) : Promise.resolve();
          else {
            var rec = { kind: { value: '対象期間' }, koji_no: { value: fm.dataset.no }, start_date: { value: s || null }, end_date: { value: en || null } };
            p = id ? api('/k/v1/record', 'PUT', { app: JUNPO_CONF, id: id, record: rec }) : api('/k/v1/record', 'POST', { app: JUNPO_CONF, record: rec });
          }
          p.then(reload).catch(fail);
        }
      });
    }).catch(fail);
  }

  function viewScaffoldStatus(q) {
    loading();
    var t = ymFrom(q), y = t.y, m = t.m, last = t.last, ym = y + '-' + pad(m);
    loadStatusConf().then(function (conf) {
      var extras = conf.filter(function (r) { return r.kind.value === '追加対象'; }).map(function (r) { return r.koji_no.value.trim(); });
      return Promise.all([loadTargets(extras),
        fetchAll(APP, catQ('scaffold') + ' and inspect_date >= "' + ym + '-01" and inspect_date <= "' + ym + '-' + pad(last) + '"',
          ['project_no', 'project_name', 'subtype', 'inspect_reason', 'inspect_reason_other', 'inspect_date']),
        api('/k/v1/records', 'GET', { app: APP, query: catQ('scaffold') + ' order by inspect_date desc limit 500', fields: ['project_no', 'inspect_date'] }),
        conf]);
    }).then(function (res) {
      var projects = res[0], recs = res[1], lastRecs = res[2].records, conf = res[3];
      var periods = {};
      conf.forEach(function (r) { if (r.kind.value === '対象期間') periods[r.koji_no.value.trim()] = r; });
      var lastBy = {};
      lastRecs.forEach(function (r) { var no = String(r.project_no.value); if (!lastBy[no]) lastBy[no] = r.inspect_date.value; });
      var byDay = {}, names = {};
      recs.forEach(function (r) {
        var no = String(r.project_no.value);
        names[no] = names[no] || r.project_name.value;
        var d = Number(r.inspect_date.value.slice(8, 10));
        var reason = r.inspect_reason.value === 'その他' ? 'その他（' + r.inspect_reason_other.value + '）' : r.inspect_reason.value;
        ((byDay[no] = byDay[no] || {})[d] = byDay[no][d] || []).push({ id: r.$id.value, label: r.subtype.value + (reason ? '（' + reason + '）' : '') });
      });
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var todayIso = iso(today), wd = '月火水木金土日';
      function row(no, name, start, end, custom) {
        var cells = [], count = 0;
        for (var d = 1; d <= last; d++) {
          var di = ym + '-' + pad(d), rs = (byDay[no] || {})[d] || [];
          count += rs.length;
          cells.push({ d: d, recs: rs, out: !!((start && di < start) || (end && di > end)), today: di === todayIso });
        }
        var l = lastBy[no] || '';
        return { no: no, name: name, start: start, end: end, custom: custom, cells: cells, count: count, last: l,
                 elapsed: l ? Math.round((today - new Date(l + 'T00:00:00')) / 86400000) : null,
                 allOut: cells.every(function (c) { return c.out; }) };
      }
      var rows = projects.map(function (p) {
        var pc = periods[p.no];
        return row(p.no, p.name, pc ? pc.start_date.value || '' : p.start, pc ? pc.end_date.value || '' : p.end, !!pc);
      });
      rows.sort(function (a, b) { return (a.allOut ? 1 : 0) - (b.allOut ? 1 : 0); });
      var listed = {};
      projects.forEach(function (p) { listed[p.no] = 1; });
      var extra = Object.keys(byDay).filter(function (no) { return !listed[no]; }).sort().map(function (no) { return row(no, names[no] || '', '', '', false); });
      function head(withName) {
        var h = '<thead><tr><th>工事№</th><th>' + (withName ? '工事名・対象期間' : '工事名') + '</th><th>今月<br>件数</th><th>最終点検</th>';
        for (var d = 1; d <= last; d++) {
          var w = wd[(new Date(y, m - 1, d).getDay() + 6) % 7];
          h += '<th class="day ' + (w === '土' ? 'sat' : (w === '日' ? 'sun' : '')) + '">' + d + '<br>' + w + '</th>';
        }
        return h + '</tr></thead>';
      }
      function calrow(r) {
        var h = '<tr class="' + (r.allOut ? 'row-out' : '') + '"><td class="left">' + esc(r.no) + '</td><td class="name">' + esc(r.name) +
          ((r.start || r.end) ? '<br><span class="period-small"><span class="' + (r.custom ? 'custom' : '') + '">' + (r.start || '未定').replace(/-/g, '/') + ' 〜 ' + (r.end || '未定').replace(/-/g, '/') + '</span></span>' : '') +
          '</td><td>' + r.count + '</td><td class="left">' + (r.last ? r.last.replace(/-/g, '/') : '－') +
          (r.elapsed !== null ? '<br><span class="' + (r.elapsed >= 7 && !r.allOut ? 'elapsed-warn' : 'period-small') + '">' + r.elapsed + '日前</span>' : '') + '</td>';
        r.cells.forEach(function (c) {
          h += '<td class="' + (c.out ? 'out' : '') + ' ' + (c.today ? 'today' : '') + '">' + (c.recs.length
            ? '<a class="dot" title="' + esc(c.recs.map(function (x) { return x.label; }).join(' ')) + '" href="#/reports/scaffold/' + c.recs[c.recs.length - 1].id + '">' + c.recs.length + '</a>' : '') + '</td>';
        });
        return h + '</tr>';
      }
      var h = '<div class="card"><h2><span class="accent-bar"></span>足場点検記録 提出状況</h2>' +
        '<p class="footer-note">対象現場と対象期間は安全旬報の提出状況と共通です（期間の変更は安全旬報の提出状況画面から）。<br>' +
        '点検記録がある日に緑の印（数字は件数）を表示し、クリックするとその記録を開きます。灰色は対象期間外です。最終点検から7日以上空いている現場は経過日数を赤で表示します。</p>' +
        '<div class="flex" style="align-items:center; margin:12px 0 16px;"><a class="btn btn-secondary btn-sm" href="#/scaffold/status?year=' + t.prev[0] + '&month=' + t.prev[1] + '">← 前月</a>' +
        '<span style="font-size:1.25rem; font-weight:700;">' + y + '年' + m + '月</span><a class="btn btn-secondary btn-sm" href="#/scaffold/status?year=' + t.next[0] + '&month=' + t.next[1] + '">翌月 →</a>' +
        '<span style="margin-left:auto;" class="footer-note">今月の対象 ' + rows.filter(function (r) { return !r.allOut; }).length + ' 現場（一覧 ' + rows.length + ' 現場）</span></div>' +
        '<div class="table-wrap" style="overflow-x:auto;"><table class="cal">' + head(true) + '<tbody>' + rows.map(calrow).join('') +
        (rows.length ? '' : '<tr><td colspan="' + (4 + last) + '">対象現場が取得できませんでした。</td></tr>') + '</tbody></table></div>';
      if (extra.length) h += '<h3 style="margin-top:22px; font-size:1rem;">対象リスト外の工事№で記録されたもの</h3><div class="table-wrap" style="overflow-x:auto;"><table class="cal">' + head(false) + '<tbody>' + extra.map(calrow).join('') + '</tbody></table></div>';
      h += '</div><div class="flex">' + backBtn('scaffold') + '</div>';
      page(h);
    }).catch(fail);
  }
  // ───────── 管理画面（手引き・点検項目・資料集・名簿） ─────────
  function canEditAsync() {
    return loadRoster().then(function (r) { return isDev() || r.some(function (u) { return u.code === me.code; }); });
  }
  function denied(what) {
    page('<div class="card"><p>' + what + 'は、承認者名簿に登録されたTL以上のメンバーのみ行えます。</p><p style="margin-top:10px;"><a href="javascript:history.back()">戻る</a></p></div>');
  }
  function uploadFile(file) {
    var fd = new FormData();
    fd.append('__REQUEST_TOKEN__', kintone.getRequestToken());
    fd.append('file', file, file.name);
    return fetch(kintone.api.url('/k/v1/file', true), { method: 'POST', body: fd, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'アップロードに失敗しました'); return j.fileKey; });
    });
  }
  function keepFiles(files, dropKey) {
    return (files || []).filter(function (f) { return f.fileKey !== dropKey; }).map(function (f) { return { fileKey: f.fileKey }; });
  }
  function subtypeTabs(base, cur) {
    return '<div class="filter-bar" style="margin-top:14px;"><span class="filter-label">足場の種類</span>' + SUBTYPES.map(function (s) {
      return '<a class="btn btn-sm ' + (s === cur ? 'btn-primary' : 'btn-secondary') + '" href="' + base + '?subtype=' + encodeURIComponent(s) + '">' + esc(s) + '</a>';
    }).join('') + '</div>';
  }
  function itemsRecord(cat, subtype) {
    if (cat === 'safety_patrol') {
      return api('/k/v1/records', 'GET', { app: JUNPO_CONF, query: 'kind in ("点検項目") limit 1' }).then(function (r) { return { app: JUNPO_CONF, rec: r.records[0] }; });
    }
    cache.conf = null;
    return loadConf().then(function (recs) {
      return { app: TENKEN_CONF, rec: recs.filter(function (x) {
        return x.kind.value === '点検項目' && x.category.value === CATS[cat].label && (x.subtype.value || '') === (subtype || '');
      })[0] };
    });
  }

  function viewGuides(cat, q) {
    loading();
    var info = CATS[cat];
    var subtype = cat === 'scaffold' ? (q.subtype || SUBTYPES[0]) : '';
    canEditAsync().then(function (ok) {
      if (!ok) return denied('項目の手引きの編集');
      cache.conf = null;
      return Promise.all([loadItems(cat, subtype), loadGuides(cat, subtype)]).then(function (res) {
        var items = res[0], guides = res[1];
        var h = '<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 項目の手引き編集' + (subtype ? '（' + esc(subtype) + '）' : '') + '</h2>' +
          '<p class="footer-note">各点検項目に参考画像と説明文を登録できます。登録すると、点検入力・詳細画面の項目に「解説」ボタンが表示されます。</p>' +
          (cat === 'scaffold' ? subtypeTabs('#/guides/scaffold', subtype) : '') +
          '<div class="flex" style="margin:14px 0;"><a class="btn btn-primary" href="#/guides/' + cat + '/items' + (subtype ? '?subtype=' + encodeURIComponent(subtype) : '') + '">点検項目の文章を編集</a>' +
          backBtn(cat) + '</div></div>';
        items.forEach(function (item, i) {
          var g = guides[item];
          var imgs = g ? g.images.value : [];
          h += '<div class="card" data-item="' + esc(item) + '"><div style="font-weight:700; margin-bottom:12px;">' + (i + 1) + '. ' + esc(item) + '</div>';
          if (imgs.length) {
            h += '<div class="form-row"><label>登録済みの参考画像（' + imgs.length + '枚）</label><div class="flex" style="align-items:flex-start;">' +
              imgs.map(function (f) {
                return '<div style="text-align:center;"><img data-key="' + f.fileKey + '" alt="参考画像" style="max-width:150px; max-height:150px; border:1px solid var(--line); border-radius:4px; display:block;">' +
                  '<button type="button" class="btn btn-danger btn-sm" style="margin-top:4px;" data-act="delimg" data-key="' + f.fileKey + '">削除</button></div>';
              }).join('') + '</div></div>';
          }
          h += '<form class="guide-form"><div class="flex" style="align-items:flex-start;"><div style="flex:1; min-width:220px;"><div class="form-row"><label>参考画像を追加（複数選択可）</label>' +
            '<input type="file" name="images" accept="image/*" multiple></div></div><div style="flex:2; min-width:260px;"><div class="form-row"><label>説明文</label>' +
            '<textarea name="description" rows="5" placeholder="点検のポイント・判断基準・是正例などを記入">' + esc(g ? g.body.value : '') + '</textarea></div></div></div>' +
            '<button type="submit" class="btn btn-primary">この項目を保存</button></form></div>';
        });
        h += '<div class="flex">' + backBtn(cat) + '</div>';
        page(h);
        root.querySelectorAll('img[data-key]').forEach(function (img) {
          downloadBlob(img.dataset.key).then(function (b) { img.src = URL.createObjectURL(b); }).catch(function () {});
        });
        root.querySelectorAll('.card[data-item]').forEach(function (card) {
          var item = card.dataset.item, g = guides[item];
          var save = function (files, body) {
            var rec = { kind: { value: '手引き' }, category: { value: info.label }, subtype: { value: subtype }, item_name: { value: item },
                        body: { value: body }, images: { value: files } };
            return g ? api('/k/v1/record', 'PUT', { app: TENKEN_CONF, id: g.$id.value, record: { body: rec.body, images: rec.images } })
                     : api('/k/v1/record', 'POST', { app: TENKEN_CONF, record: rec });
          };
          card.querySelector('.guide-form').addEventListener('submit', function (e) {
            e.preventDefault();
            overlay('送信中...');
            var files = [].slice.call(e.target.elements.images.files);
            Promise.all(files.map(uploadFile)).then(function (keys) {
              return save(keepFiles(g ? g.images.value : []).concat(keys.map(function (k) { return { fileKey: k }; })), e.target.elements.description.value);
            }).then(function () { route(); }).catch(fail);
          });
          card.querySelectorAll('[data-act=delimg]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (!confirm('この画像を削除しますか？')) return;
              overlay('送信中...');
              save(keepFiles(g.images.value, b.dataset.key), g.body.value).then(function () { route(); }).catch(fail);
            });
          });
        });
      });
    }).catch(fail);
  }

  function viewChecklistEdit(cat, q) {
    loading();
    var info = CATS[cat];
    var subtype = cat === 'scaffold' ? (q.subtype || SUBTYPES[0]) : '';
    canEditAsync().then(function (ok) {
      if (!ok) return denied('点検項目の編集');
      return itemsRecord(cat, subtype).then(function (x) {
        var items = x.rec ? splitLines(x.rec.body.value) : [];
        page('<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 点検項目の編集' + (subtype ? '（' + esc(subtype) + '）' : '') + '</h2>' +
          '<p class="footer-note">1行に1項目を書いてください。行の順番がそのまま点検表の順番になります。文章の修正・追加・削除・並べ替えができ、保存後に作成する点検から反映されます（既に提出済みの点検は変わりません）。<br>' +
          '項目数を変えずに文章だけ直した場合は、登録済みの「解説」（手引き）もそのまま引き継がれます。</p>' +
          (cat === 'scaffold' ? subtypeTabs('#/guides/scaffold/items', subtype) : '') +
          (q.saved ? '<p style="color:#1f7a3a; font-weight:700; margin-top:12px;">保存しました。次回の点検入力から反映されます。</p>' : '') +
          '<form id="items-form" style="margin-top:14px;"><div class="form-row"><label>点検項目（' + items.length + '件）</label>' +
          '<textarea name="items" rows="' + Math.max(items.length + 3, 12) + '" style="width:100%; line-height:1.7;">' + esc(items.join('\n')) + '</textarea></div>' +
          '<div class="flex"><button type="submit" class="btn btn-primary">保存</button><a class="btn btn-secondary" href="#/guides/' + cat + (subtype ? '?subtype=' + encodeURIComponent(subtype) : '') + '">手引き編集に戻る</a></div></form></div>');
        root.querySelector('#items-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var next = splitLines(e.target.elements.items.value);
          if (!next.length) { alert('点検項目が空です。'); return; }
          overlay('送信中...');
          var body = { body: { value: next.join('\n') } };
          var p = x.rec ? api('/k/v1/record', 'PUT', { app: x.app, id: x.rec.$id.value, record: body })
            : api('/k/v1/record', 'POST', { app: x.app, record: Object.assign(body, x.app === JUNPO_CONF ? { kind: { value: '点検項目' } }
                : { kind: { value: '点検項目' }, category: { value: info.label }, subtype: { value: subtype } }) });
          p.then(function () {
            if (next.length !== items.length) return;
            // 文章だけ直した場合は手引きの紐付けも追従
            return loadGuides(cat, subtype).then(function (guides) {
              var ups = [];
              items.forEach(function (old, i) {
                if (old !== next[i] && guides[old]) ups.push({ id: guides[old].$id.value, record: { item_name: { value: next[i] } } });
              });
              if (ups.length) return api('/k/v1/records', 'PUT', { app: TENKEN_CONF, records: ups });
            });
          }).then(function () { cache.conf = null; go('#/guides/' + cat + '/items?saved=1' + (subtype ? '&subtype=' + encodeURIComponent(subtype) : '')); }).catch(fail);
        });
      });
    }).catch(fail);
  }

  function viewResources(cat) {
    loading();
    var info = CATS[cat];
    cache.conf = null;
    Promise.all([loadConf(), canEditAsync()]).then(function (res) {
      var list = res[0].filter(function (r) { return r.kind.value === '資料' && r.category.value === info.label; });
      var canEdit = res[1];
      var h = '<div class="card"><h2><span class="accent-bar"></span>' + info.label + ' 資料集</h2><p class="footer-note">' + info.label + 'に関する参考例・手順書・チェックリストなどを共有できます。</p>';
      if (list.length) {
        h += '<table style="margin-top:14px;"><thead><tr><th>プレビュー</th><th>タイトル</th><th>説明</th><th>登録者</th><th>登録日時</th><th></th><th></th></tr></thead><tbody>' +
          list.map(function (r) {
            var f = r.images.value[0];
            var isImg = f && /^image\//.test(f.contentType);
            return '<tr><td>' + (isImg ? '<img data-key="' + f.fileKey + '" style="max-width:80px; max-height:80px; border-radius:4px;">' : '-') + '</td>' +
              '<td>' + esc(r.title.value) + '</td><td>' + esc(r.body.value) + '</td><td>' + esc(r['作成者'].value.name) + '</td><td>' + dt(r['作成日時'].value) + '</td>' +
              '<td>' + (f ? '<button type="button" class="btn btn-primary btn-sm" data-act="open" data-key="' + f.fileKey + '" data-name="' + esc(f.name) + '">開く</button>' : '') + '</td>' +
              '<td>' + (canEdit ? '<button type="button" class="btn btn-secondary btn-sm" data-act="del" data-id="' + r.$id.value + '">削除</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>';
      } else h += '<p style="margin-top:14px;">まだ資料が登録されていません。</p>';
      h += '</div>';
      if (canEdit) {
        h += '<div class="card"><h2><span class="accent-bar"></span>資料を追加</h2><form id="res-form">' +
          '<div class="form-row"><label>タイトル</label><input type="text" name="title" required></div>' +
          '<div class="form-row"><label>説明（任意）</label><textarea name="description" rows="2"></textarea></div>' +
          '<div class="form-row"><label>ファイル</label><input type="file" name="file" required></div>' +
          '<button type="submit" class="btn btn-primary">登録</button></form></div>';
      }
      h += '<div class="flex">' + backBtn(cat) + '</div>';
      page(h);
      root.querySelectorAll('img[data-key]').forEach(function (img) { downloadBlob(img.dataset.key).then(function (b) { img.src = URL.createObjectURL(b); }); });
      root.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.act === 'open') {
            downloadBlob(b.dataset.key).then(function (blob) { window.open(URL.createObjectURL(blob), '_blank'); }).catch(fail);
          } else if (confirm('削除しますか？')) {
            overlay('送信中...');
            api('/k/v1/records', 'DELETE', { app: TENKEN_CONF, ids: [b.dataset.id] }).then(function () { route(); }).catch(fail);
          }
        });
      });
      var fm = root.querySelector('#res-form');
      if (fm) fm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!fm.reportValidity()) return;
        overlay('送信中...');
        uploadFile(fm.elements.file.files[0]).then(function (key) {
          return api('/k/v1/record', 'POST', { app: TENKEN_CONF, record: { kind: { value: '資料' }, category: { value: info.label },
            title: { value: fm.elements.title.value.trim() }, body: { value: fm.elements.description.value.trim() }, images: { value: [{ fileKey: key }] } } });
        }).then(function () { route(); }).catch(fail);
      });
    }).catch(fail);
  }

  function cybozu(path) {
    return fetch(path, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('ユーザー情報を取得できませんでした（' + r.status + '）');
      return r.json();
    });
  }
  function allPages(path, key) {
    var out = [];
    function next(off) {
      return cybozu(path + '?offset=' + off + '&size=100').then(function (j) {
        out = out.concat(j[key]);
        return j[key].length === 100 ? next(off + 100) : out;
      });
    }
    return next(0);
  }

  function viewApprovers() {
    if (!isDev()) return denied('名簿の設定');
    loading();
    cache.conf = null;
    Promise.all([loadRoster(),
      allPages('/v1/users.json', 'users').catch(function () { return []; }),
      allPages('/v1/organizations.json', 'organizations').then(function (o) {
        return o.map(function (x) { return x.name; }).filter(function (n) { return /^[^\s　]+Ｂ$/.test(n); });
      }).catch(function () { return ['都市Ｂ', 'マンションＢ', '環境Ｂ', '設計Ｂ', '調達Ｂ', '総務Ｂ']; })
    ]).then(function (res) {
      var roster = res[0], us = res[1].filter(function (u) { return u.valid !== false; }), blocks = res[2];
      var roles = ['TL', 'GL', 'BL', '安全検査室'];
      var blockSel = function (cur, attrs) {
        return '<select ' + attrs + ' style="width:auto; min-width:140px;"><option value=""' + (cur ? '' : ' selected') + '>全ブロック共通</option>' +
          blocks.map(function (b) { return '<option value="' + esc(b) + '"' + (cur === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
          (cur && blocks.indexOf(cur) < 0 ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>' : '') + '</select>';
      };
      var h = '<div class="card"><h2><span class="accent-bar"></span>承認者・通知先の名簿</h2><p class="footer-note">報告書の提出・承認時にkintone通知を送る相手を登録します。メンバーはブロックごとに登録し、報告書の作成画面には提出者（ログイン者）の所属ブロックのメンバーだけが表示されます。「全ブロック共通」にしたメンバーはどのブロックにも表示されます。担当工事№を登録すると、報告書作成時に工事№からTL/GL・BLが自動選択されます。</p>';
      roles.forEach(function (role) {
        var list = roster.filter(function (u) { return u.role === role; });
        h += '<h2 style="margin-top:22px;"><span class="accent-bar"></span>' + role + '</h2>';
        h += list.length ? '<table style="max-width:820px;"><thead><tr><th style="width:170px;">ブロック</th><th>表示名</th><th>kintoneログイン名</th><th>担当工事№</th><th style="width:80px;"></th></tr></thead><tbody>' +
          list.map(function (u) {
            return '<tr><td>' + blockSel(u.block, 'data-block="' + u.id + '"') + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.code) + '</td><td>' + esc(u.koji) + '</td>' +
              '<td><button type="button" class="btn btn-danger btn-sm" data-del="' + u.id + '">削除</button></td></tr>';
          }).join('') + '</tbody></table>' : '<p class="footer-note">まだ登録されていません。</p>';
      });
      h += '</div><div class="card"><h2><span class="accent-bar"></span>追加</h2><form id="ap-form"><div class="flex">' +
        '<div class="form-row" style="min-width:150px;"><label>ブロック</label>' + blockSel('都市Ｂ', 'name="block"') + '</div>' +
        '<div class="form-row" style="min-width:140px;"><label>役割</label><select name="role">' + roles.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-row" style="flex:2; min-width:240px;"><label>kintoneユーザー（名前の一部を入力すると候補が出ます）</label>' +
        '<input type="text" name="pick" list="tk-user-list" autocomplete="off" placeholder="例：江間 と入力して候補から選択" required><datalist id="tk-user-list">' +
        us.map(function (u) { return '<option value="' + esc(u.name) + '（' + esc(u.code) + '）"></option>'; }).join('') + '</datalist></div>' +
        '<div class="form-row" style="flex:1; min-width:200px;"><label>担当工事№（カンマ区切り・任意）</label><input type="text" name="koji" placeholder="例：81044081,81043081"></div>' +
        '</div><button type="submit" class="btn btn-primary">追加する</button></form></div><div class="flex"><a class="btn btn-secondary" href="#/">トップに戻る</a></div>';
      page(h);
      root.querySelectorAll('[data-block]').forEach(function (s) {
        s.addEventListener('change', function () {
          overlay('送信中...');
          api('/k/v1/record', 'PUT', { app: TENKEN_CONF, id: s.dataset.block, record: { block: { value: s.value } } }).then(function () { cache.conf = null; route(); }).catch(fail);
        });
      });
      root.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('削除しますか？')) return;
          overlay('送信中...');
          api('/k/v1/records', 'DELETE', { app: TENKEN_CONF, ids: [b.dataset.del] }).then(function () { cache.conf = null; route(); }).catch(fail);
        });
      });
      root.querySelector('#ap-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target.elements, pick = f.pick.value.trim();
        var m = pick.match(/（([^）]+)）\s*$/);
        var code = m ? m[1] : (us.filter(function (u) { return u.name === pick || u.code === pick; })[0] || {}).code || pick;
        overlay('送信中...');
        api('/k/v1/record', 'POST', { app: TENKEN_CONF, record: { kind: { value: '名簿' }, role: { value: f.role.value },
          member: { value: [{ code: code }] }, block: { value: f.block.value }, koji_nos: { value: f.koji.value.trim() } } })
          .then(function () { cache.conf = null; route(); }).catch(fail);
      });
    }).catch(fail);
  }

  function viewAdminLink(title, label) {
    page('<div class="card"><h2><span class="accent-bar"></span>' + esc(label + ' ' + title) + '</h2><p>この画面は準備中です。</p>' +
      '<div class="flex" style="margin-top:14px;"><a class="btn btn-secondary" href="javascript:history.back()">戻る</a></div></div>');
  }

  // ───────── PDF ─────────
  var fontCache = null;
  function loadFont() {
    if (!fontCache) {
      fontCache = api('/k/v1/records', 'GET', { app: JUNPO_CONF, query: 'kind in ("PDF資材") limit 1' }).then(function (r) {
        var files = r.records[0] ? r.records[0].files.value : [];
        var font = files.filter(function (x) { return /\.(ttf|otf)$/i.test(x.name); })[0];
        var tmpl = files.filter(function (x) { return /\.pdf$/i.test(x.name); })[0];
        return Promise.all([downloadBlob(font.fileKey).then(function (b) { return b.arrayBuffer(); }),
                            downloadBlob(tmpl.fileKey).then(function (b) { return b.arrayBuffer(); })]);
      }).then(function (x) { return { font: x[0], template: x[1] }; });
      fontCache.catch(function () { fontCache = null; });
    }
    return fontCache;
  }
  function pdfName(cat, rep) {
    if (cat === 'safety_patrol') return rep.project_no + '_安全旬報' + rep.inspect_date.slice(0, 4) + '年' + rep.report_month + '月' + rep.report_period + '.pdf';
    return CATS[cat].label + '_' + rep.project_no + '_' + rep.inspect_date + '.pdf';
  }
  function saveBytes(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function wrap(font, text, size, width) {
    var lines = [];
    String(text || '').split(/\r?\n/).forEach(function (para) {
      var line = '';
      for (var i = 0; i < para.length; i++) {
        if (font.widthOfTextAtSize(line + para[i], size) > width && line) { lines.push(line); line = ''; }
        line += para[i];
      }
      lines.push(line);
    });
    return lines;
  }

  // 安全旬報：公式様式に重ね書き
  var PAGE_H = 841.68;
  var LB = [135.0, 152.6, 166.1, 187.6, 205.1, 218.7, 236.2, 253.7, 275.2, 288.8, 306.3, 345.3, 358.9, 376.4, 393.9, 411.4, 429.0, 446.5, 464.0, 481.5, 499.1, 516.6, 534.2, 551.7, 569.3];
  var RB = [131.2, 148.7, 166.2, 183.6, 201.2, 218.7, 236.3, 253.7, 271.2, 288.8, 306.3, 323.8, 341.4, 358.9, 376.4, 402.8, 429.0, 446.6, 464.1, 481.7, 499.1, 516.6, 534.1, 551.7, 569.1, 586.7, 604.2, 621.7, 639.4, 656.8, 674.3, 691.9, 709.3, 726.8, 744.5];
  var RPOS = LB.map(function (b) { return [255.1, b]; }).concat(RB.map(function (b) { return [486.05, b]; }));

  function junpoPdf(reps) {
    var PDFLib = window.PDFLib;
    return loadFont().then(function (a) {
      return Promise.all([PDFLib.PDFDocument.create(), PDFLib.PDFDocument.load(a.template)]).then(function (docs) {
        var doc = docs[0], tmpl = docs[1];
        doc.registerFontkit(window.fontkit);
        return doc.embedFont(a.font, { subset: false }).then(function (font) {
          var chain = Promise.resolve();
          reps.forEach(function (rep) {
            chain = chain.then(function () {
              return doc.copyPages(tmpl, [0]).then(function (pages) {
                var pg = doc.addPage(pages[0]);
                var black = PDFLib.rgb(0, 0, 0), white = PDFLib.rgb(1, 1, 1);
                var Y = function (y) { return PAGE_H - y; };
                var w = function (t, s) { return font.widthOfTextAtSize(String(t), s); };
                var text = function (t, x, y, s) { if (t !== '' && t != null) pg.drawText(String(t), { x: x, y: y, size: s, font: font, color: black }); };
                var center = function (t, x, y, s) { text(t, x - w(t, s) / 2, y, s); };
                var right = function (t, x, y, s) { text(t, x - w(t, s), y, s); };
                var rect = function (x, y, ww, hh) { pg.drawRectangle({ x: x, y: y, width: ww, height: hh, color: white }); };
                text(rep.project_no, 80, Y(101.5), 9);
                var name = rep.project_name || '', nw = 120, size = 9;
                while (size > 7 && w(name, size) > nw) size -= 0.5;
                if (w(name, size) <= nw) text(name, 172, Y(101.5), size);
                else {
                  size = 6.5;
                  while (size > 4.5 && w(name, size) > nw * 2) size -= 0.5;
                  var l1 = '';
                  for (var i = 0; i < name.length; i++) { if (w(l1 + name[i], size) > nw) break; l1 += name[i]; }
                  var l2 = name.slice(l1.length);
                  while (l2 && w(l2, size) > nw) l2 = l2.slice(0, -1);
                  text(l1, 172, Y(100.5 - size - 0.8), size);
                  text(l2, 172, Y(100.5), size);
                }
                text(rep.site_manager, 348, Y(101.5), 9);
                text(rep.inspector, 438, Y(101.5), 9);
                rect(76, Y(81.6), 124, 9.6);
                text(rep.report_month ? rep.report_month + '月　' + rep.report_period + '　安全・環境旬報' : '安全・環境旬報', 79, Y(81.0), 11);
                rect(390, Y(81.3), 70, 7.5);
                var c = new Date(rep.created_at);
                if (!isNaN(c)) text((c.getMonth() + 1) + '月' + c.getDate() + '日提出', 393, Y(81.0), 9);
                if (rep.report_round) center(rep.report_round, 279.0, Y(81.0), 9);
                rep.items.slice(0, RPOS.length).forEach(function (it, idx) { center(it.result || '', RPOS[idx][0], Y(RPOS[idx][1]) - 1.5, 9); });
                if (rep.meeting_date) {
                  var md = new Date(rep.meeting_date + 'T00:00:00');
                  rect(186, Y(586.6), 13, 6); rect(205, Y(586.6), 14, 6);
                  right(String(md.getMonth() + 1), 199, Y(585.5), 8);
                  right(String(md.getDate()), 218.5, Y(585.5), 8);
                }
                text((rep.meeting_attendees || '').replace(/\r?\n/g, ' '), 85, Y(594.5), 8);
                var notes = (rep.meeting_notes || '').replace(/\r?\n/g, ''), cy = Y(656.5);
                for (var k = 0; k < notes.length; k += 21) { if (cy < Y(750)) break; text(notes.slice(k, k + 21), 123, cy, 7.5); cy -= 9.5; }
              });
            });
          });
          return chain.then(function () { return doc.save(); });
        });
      });
    });
  }
  function junpoBulk(no) {
    overlay('PDF作成中...');
    return fetchAll(APP, catQ('safety_patrol') + ' and project_no = "' + no + '"', null).then(function (recs) {
      var reps = recs.map(function (r) { return toReport('safety_patrol', r); });
      reps.sort(function (a, b) {
        var ka = [a.inspect_date.slice(0, 4), Number(a.report_month || 0), PERIODS.indexOf(a.report_period), Number(a.id)];
        var kb = [b.inspect_date.slice(0, 4), Number(b.report_month || 0), PERIODS.indexOf(b.report_period), Number(b.id)];
        for (var i = 0; i < 4; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
        return 0;
      });
      return junpoPdf(reps).then(function (bytes) {
        overlay(null);
        var t = new Date();
        saveBytes(bytes, no + '_安全旬報_一括（' + reps.length + '件）_' + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '.pdf');
      });
    });
  }

  // 台風・災害時・足場：A4縦の表形式
  function tablePdf(cat, rep) {
    var PDFLib = window.PDFLib;
    return loadFont().then(function (a) {
      return PDFLib.PDFDocument.create().then(function (doc) {
        doc.registerFontkit(window.fontkit);
        return doc.embedFont(a.font, { subset: false }).then(function (font) {
          var W = 595.28, H = 841.89, M = 36, black = PDFLib.rgb(0, 0, 0), gray = PDFLib.rgb(0.45, 0.45, 0.45);
          var line = PDFLib.rgb(0.6, 0.6, 0.6), fill = PDFLib.rgb(0.94, 0.95, 0.96);
          var pg, y;
          function newPage() { pg = doc.addPage([W, H]); y = H - M; }
          function txt(t, x, yy, s, c) { if (t) pg.drawText(String(t), { x: x, y: yy, size: s, font: font, color: c || black }); }
          function box(x, yy, w, h, f) { pg.drawRectangle({ x: x, y: yy, width: w, height: h, borderColor: line, borderWidth: 0.6, color: f || undefined }); }
          newPage();
          var title = CATS[cat].label + (cat === 'scaffold' && rep.subtype ? '（' + rep.subtype + '）' : '');
          txt(title, (W - font.widthOfTextAtSize(title, 16)) / 2, y - 16, 16);
          y -= 34;
          var q = function (n, no) { return (n || '') + (no ? '（資格番号：' + no + '）' : ''); };
          var info = [['工事名', rep.project_name, '工事番号', rep.project_no], ['点検日', rep.inspect_date, '点検者', rep.inspector]];
          if (cat === 'scaffold') {
            info.push(['点検実施理由', rep.reason_text, '組立者', rep.assembler_name]);
            info.push(['点検者の資格', q(rep.inspector_qual, rep.inspector_qual_no), '組立者の資格', q(rep.assembler_qual, rep.assembler_qual_no)]);
          } else info.push(['状態', rep.status, '', '']);
          var lw = 70, vw = (W - 2 * M - 2 * lw) / 2;
          info.forEach(function (r) {
            var l1 = wrap(font, r[1], 9, vw - 8), l3 = wrap(font, r[3], 9, vw - 8), hh = Math.max(l1.length, l3.length) * 12 + 8, x = M;
            [[lw, [r[0]], true], [vw, l1], [lw, [r[2]], true], [vw, l3]].forEach(function (c) {
              box(x, y - hh, c[0], hh, c[2] ? fill : null);
              c[1].forEach(function (t, i) { txt(t, x + 4, y - 13 - i * 12, 9); });
              x += c[0];
            });
            y -= hh;
          });
          y -= 10; txt(LEGEND, M, y - 9, 8, gray); y -= 18;
          var cols = [26, 300, 40, W - 2 * M - 366];
          function head() {
            var x = M;
            ['No', '点検項目', '結果', '備考'].forEach(function (t, i) {
              box(x, y - 18, cols[i], 18, fill);
              txt(t, x + (i === 0 || i === 2 ? (cols[i] - font.widthOfTextAtSize(t, 9)) / 2 : 4), y - 13, 9);
              x += cols[i];
            });
            y -= 18;
          }
          head();
          rep.items.forEach(function (it, idx) {
            var nm = wrap(font, it.item_name, 9, cols[1] - 8), nt = wrap(font, it.note, 8.5, cols[3] - 8), hh = Math.max(nm.length, nt.length) * 12 + 8;
            if (y - hh < M + 20) { newPage(); head(); }
            var x = M;
            [[String(idx + 1), true], [nm], [it.result || '', true], [nt]].forEach(function (c, i) {
              box(x, y - hh, cols[i], hh);
              if (c[1]) txt(c[0], x + (cols[i] - font.widthOfTextAtSize(c[0], 10)) / 2, y - 14, 10);
              else c[0].forEach(function (t, k) { txt(t, x + 4, y - 13 - k * 12, i === 3 ? 8.5 : 9); });
              x += cols[i];
            });
            y -= hh;
          });
          var logs = rep.approvals.map(function (a) { return a.role + '承認：' + a.name + '　' + dt(a.at) + (a.comment ? '　' + a.comment : ''); });
          if (!logs.length && rep.legacy_note) logs = rep.legacy_note.split(/\n/);
          if (logs.length) {
            var ls = wrap(font, logs.join('\n'), 8.5, W - 2 * M - 8);
            if (y - (ls.length * 12 + 30) < M) newPage();
            y -= 12; txt('承認欄', M, y - 10, 10); y -= 16;
            box(M, y - ls.length * 12 - 8, W - 2 * M, ls.length * 12 + 8);
            ls.forEach(function (t, i) { txt(t, M + 4, y - 12 - i * 12, 8.5); });
          }
          return doc.save();
        });
      });
    });
  }

  // ───────── 起動 ─────────
  function mount(el) {
    root = el;
    if (!document.getElementById('tk-overlay')) {
      var ov = document.createElement('div');
      ov.innerHTML = '<div id="tk-overlay" class="tk-root"><div class="box"><div class="spinner"></div><div class="msg">送信中...</div><div class="sub">画面が切り替わるまでお待ちください</div></div></div>' +
        '<div id="tk-guide" class="tk-root"><div class="g-box"><div class="g-head"><div class="g-title"></div><button type="button" class="g-close" aria-label="閉じる">×</button></div>' +
        '<div class="g-body"><div class="g-images"></div><div class="g-desc"></div><div class="g-empty" style="display:none;">この項目の手引きはまだ登録されていません。</div></div></div></div>';
      while (ov.firstChild) document.body.appendChild(ov.firstChild);
      var gm = document.getElementById('tk-guide');
      gm.addEventListener('click', function (e) { if (e.target === gm || e.target.classList.contains('g-close')) gm.classList.remove('show'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') gm.classList.remove('show'); });
      window.addEventListener('hashchange', route);
    }
    route();
  }

  kintone.events.on('app.record.index.show', function (event) {
    var el = document.getElementById('tenken-app');
    if (el) mount(el);
    return event;
  });
  kintone.events.on('mobile.app.record.index.show', function (event) {
    var sp = kintone.mobile.app.getHeaderSpaceElement();
    if (sp && !sp.querySelector('#tenken-app')) {
      var el = document.createElement('div');
      el.id = 'tenken-app';
      sp.appendChild(el);
      mount(el);
    }
    return event;
  });

  window.__tenkenApp = { toReport: toReport, junpoPdf: junpoPdf, tablePdf: tablePdf, CATS: CATS };   // 動作確認用

  // ───────── スタイル（元のアプリのCSSを .tk-root 配下に限定して移植） ─────────
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap';
  document.head.appendChild(link);
  var css = [
    '.tk-root{--accent:#b3382c;--accent-dark:#8f2c22;--ink:#1f2427;--ink-soft:#5b656b;--line:#d9dee1;--line-soft:#e8ecee;--bg:#eef1f3;--panel:#fff;font-family:"Noto Sans JP",sans-serif;color:var(--ink);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}',
    '.tk-root *{box-sizing:border-box}',
    '#tenken-app .tk-root{background:var(--bg);min-height:600px;padding-bottom:20px}',
    '.tk-root header{background:var(--panel);border-bottom:2px solid var(--accent);padding:14px 24px;display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}',
    '.tk-root header h1{font-size:1.15rem;font-weight:700;letter-spacing:.04em;color:var(--ink);margin:0}',
    '.tk-root header h1 span{color:var(--accent)}.tk-root header a{color:var(--ink-soft);text-decoration:none;font-size:.85rem}.tk-root header a:hover{color:var(--accent)}',
    '.tk-root .container{max-width:1120px;margin:26px auto;padding:0 18px}',
    '.tk-root .card{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:26px;margin-bottom:20px}',
    '.tk-root h2{color:var(--ink);font-size:1.08rem;font-weight:700;margin:0 0 18px;padding-bottom:10px;border-bottom:1px solid var(--line);letter-spacing:.02em}',
    '.tk-root h2 .accent-bar{display:inline-block;width:4px;height:1em;background:var(--accent);margin-right:10px;transform:translateY(2px)}',
    '.tk-root p{margin:0}',
    '.tk-root .btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 20px;border-radius:3px;border:1px solid transparent;cursor:pointer;font-family:inherit;font-size:.9rem;font-weight:500;text-decoration:none;transition:background .12s,border-color .12s;line-height:1.6}',
    '.tk-root .btn-primary{background:var(--accent);color:#fff}.tk-root .btn-primary:hover{background:var(--accent-dark);color:#fff}',
    '.tk-root .btn-success{background:#1e7d47;color:#fff}.tk-root .btn-success:hover{background:#176337}',
    '.tk-root .btn-secondary{background:#fff;color:var(--ink);border-color:var(--line)}.tk-root .btn-secondary:hover{border-color:var(--ink-soft)}',
    '.tk-root .btn-danger{background:#fff;color:var(--accent);border-color:var(--accent)}.tk-root .btn-danger:hover{background:var(--accent);color:#fff}',
    '.tk-root .btn-return{background:#fff;color:#b3382c;border:1px solid #b3382c}.tk-root .btn-return:hover{background:#fdeceb}',
    '.tk-root .btn-sm{padding:5px 12px;font-size:.8rem}',
    '.tk-root input[type=text],.tk-root input[type=date],.tk-root input[type=number],.tk-root textarea,.tk-root select{font-family:inherit;border:1px solid var(--line);border-radius:3px;padding:8px 11px;font-size:.9rem;width:100%;background:#fff;color:var(--ink);height:auto;box-shadow:none;margin:0}',
    '.tk-root input:focus,.tk-root textarea:focus,.tk-root select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px rgba(179,56,44,.12)}',
    '.tk-root table{width:100%;border-collapse:collapse;font-size:.88rem}',
    '.tk-root th{background:#f4f6f7;color:var(--ink-soft);font-weight:700;padding:9px 8px;text-align:center;border-bottom:2px solid var(--line);font-size:.82rem;letter-spacing:.02em}',
    '.tk-root td{padding:9px 8px;border-bottom:1px solid var(--line-soft);vertical-align:middle}',
    '.tk-root tr:hover td{background:#faf6f5}',
    '.tk-root .list-table th,.tk-root .list-table td{border-right:1px solid var(--line-soft)}.tk-root .list-table th:last-child,.tk-root .list-table td:last-child{border-right:none}',
    '.tk-root .list-table .col-no{width:110px}.tk-root .list-table tbody tr.report-row:hover td{background:#eef3f8}',
    '.tk-root .flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}',
    '.tk-root .badge{display:inline-block;padding:3px 10px;border-radius:2px;font-size:.76rem;font-weight:500;border:1px solid}',
    '.tk-root .badge-pending{background:#fff5ea;color:#b5670c;border-color:#e6b877}.tk-root .badge-done{background:#eef7f1;color:#1e7d47;border-color:#9dccb0}',
    '.tk-root .badge-returned{background:#fdeceb;color:#b3382c;border-color:#e8a39b;font-weight:700}.tk-root .badge-none{background:#f3f4f6;color:#8a949a;border-color:#d9dee2}',
    '.tk-root .menu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}',
    '.tk-root .menu-card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:26px 22px;text-decoration:none;color:var(--ink);transition:border-color .12s,transform .12s;position:relative;border-left:3px solid var(--accent)}',
    '.tk-root .menu-card:hover{transform:translateY(-2px);border-color:var(--accent)}',
    '.tk-root .menu-card .title{font-size:1.02rem;font-weight:700;color:var(--ink)}.tk-root .menu-card .desc{font-size:.83rem;color:var(--ink-soft);margin-top:6px;line-height:1.5}',
    '.tk-root .menu-card .pending-badge{position:absolute;top:12px;right:12px}',
    '.tk-root label{display:block;font-size:.82rem;color:var(--ink-soft);margin-bottom:5px;font-weight:500}',
    '.tk-root .form-row{margin-bottom:15px}',
    '.tk-root .item-table th,.tk-root .item-table td{text-align:left}.tk-root .item-table td.no{text-align:center;width:42px;color:var(--ink-soft)}',
    '.tk-root .item-table select{width:auto;min-width:104px}.tk-root .item-table tbody tr:hover td{background:#faf6f5}',
    '.tk-root .footer-note{font-size:.82rem;color:var(--ink-soft);margin-top:8px}',
    '.tk-root .legend{background:#f7f9fa;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:3px;padding:11px 15px;margin-bottom:16px;font-size:.86rem;color:var(--ink)}',
    '.tk-root .filter-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;padding:12px 14px;background:#f7f9fa;border:1px solid var(--line);border-radius:3px}',
    '.tk-root .filter-bar input,.tk-root .filter-bar select{width:auto}.tk-root .filter-bar .search-input{min-width:240px;flex:1}',
    '.tk-root .filter-bar .filter-label{font-size:.82rem;color:var(--ink-soft);font-weight:500}',
    '.tk-root .no-match-msg{color:var(--ink-soft);font-size:.9rem;padding:10px 2px}',
    '.tk-root details.month-group{border:1px solid var(--line);border-radius:4px;margin-bottom:10px;overflow:hidden}',
    '.tk-root details.month-group>summary{cursor:pointer;font-weight:700;font-size:.98rem;padding:12px 16px;background:#f4f6f7;list-style:none;display:flex;align-items:center;gap:8px}',
    '.tk-root details.month-group>summary::-webkit-details-marker{display:none}',
    '.tk-root details.month-group>summary::before{content:"▸";color:var(--accent);font-size:.8rem;transition:transform .12s}',
    '.tk-root details.month-group[open]>summary::before{transform:rotate(90deg)}',
    '.tk-root details.month-group .group-count{color:var(--ink-soft);font-weight:500;font-size:.85rem}',
    '.tk-root details.month-group .table-wrap{padding:6px 12px 12px}',
    '.tk-root .suggest{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid var(--line);border-radius:3px;box-shadow:0 6px 20px rgba(0,0,0,.12);max-height:280px;overflow-y:auto}',
    '.tk-root .sg-row{padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--line-soft);font-size:.88rem}.tk-root .sg-row:hover{background:#faf6f5}',
    '.tk-root .return-box{border:1px solid #e8a39b;background:#fdf4f3;border-radius:6px;padding:14px 16px;margin:0 0 20px}',
    '.tk-root .return-title{font-weight:700;color:#b3382c;margin-bottom:6px}.tk-root .return-reason{white-space:pre-wrap;margin-bottom:10px}',
    '.tk-root .guide-link{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:1px 8px;font-family:inherit;font-size:.72rem;font-weight:500;color:var(--accent);background:#fff;border:1px solid var(--accent);border-radius:2px;cursor:pointer;vertical-align:middle;white-space:nowrap}',
    '.tk-root .guide-link:hover{background:var(--accent);color:#fff}',
    '#tk-overlay{display:none;position:fixed;inset:0;background:rgba(31,36,39,.72);z-index:9999;align-items:center;justify-content:center}',
    '#tk-overlay.show{display:flex}#tk-overlay .box{background:#fff;border-radius:6px;padding:40px 56px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}',
    '#tk-overlay .spinner{width:52px;height:52px;border:5px solid var(--line);border-top-color:var(--accent);border-radius:50%;margin:0 auto 20px;animation:tkspin .8s linear infinite}',
    '@keyframes tkspin{to{transform:rotate(360deg)}}',
    '#tk-overlay .msg{font-size:1.4rem;font-weight:700;color:var(--ink);letter-spacing:.05em}#tk-overlay .sub{font-size:.9rem;color:var(--ink-soft);margin-top:10px}',
    '#tk-guide{display:none;position:fixed;inset:0;background:rgba(31,36,39,.6);z-index:9998;align-items:center;justify-content:center;padding:20px}',
    '#tk-guide.show{display:flex}#tk-guide .g-box{background:#fff;border-radius:6px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;box-shadow:0 12px 44px rgba(0,0,0,.32)}',
    '#tk-guide .g-head{display:flex;align-items:flex-start;gap:12px;padding:18px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff}',
    '#tk-guide .g-title{font-size:1rem;font-weight:700;line-height:1.5;flex:1}#tk-guide .g-close{border:none;background:none;font-size:1.5rem;line-height:1;color:var(--ink-soft);cursor:pointer;padding:0 4px}',
    '#tk-guide .g-body{padding:20px 22px}#tk-guide .g-image{width:100%;border:1px solid var(--line);border-radius:4px;margin-bottom:16px;display:block}',
    '#tk-guide .g-desc{font-size:.92rem;line-height:1.75;white-space:pre-wrap;color:var(--ink)}#tk-guide .g-empty{color:var(--ink-soft);font-size:.9rem}',
    '.tk-root .status-cell{text-align:center;vertical-align:middle;white-space:nowrap}.tk-root .status-cell .badge{white-space:nowrap}.tk-root .badge-overdue{background:#fdeceb;color:#b3382c;border-color:#e8a39b;font-weight:700}',
    '.tk-root .excl-form{margin-top:4px}.tk-root .excl-btn{background:none;border:none;color:#7a858c;font-size:.75rem;cursor:pointer;text-decoration:underline;padding:0;font-family:inherit}.tk-root .excl-btn:hover{color:#2f3b42}',
    '.tk-root .period-out{color:#b0b8bd;font-size:.8rem}.tk-root tr.row-out td{background:#fafbfb;color:#8a949a}',
    '.tk-root .period-cell{white-space:nowrap;font-size:.82rem}.tk-root .period-cell .custom{color:#1f6fb2;font-weight:700}',
    '.tk-root .period-form{display:none;margin-top:6px;text-align:left}.tk-root .period-form input[type=date]{width:auto;font-size:.8rem;padding:3px 4px}.tk-root .period-form.open{display:block}',
    '.tk-root .cal{border-collapse:collapse;font-size:.8rem;width:auto}.tk-root .cal th,.tk-root .cal td{border:1px solid var(--line-soft);padding:4px 3px;text-align:center}',
    '.tk-root .cal th.day{width:26px;min-width:26px;font-weight:500}.tk-root .cal th.sat{color:#1f6fb2}.tk-root .cal th.sun{color:#b3382c}',
    '.tk-root .cal td.left{text-align:left;white-space:nowrap;padding:4px 8px}.tk-root .cal td.name{text-align:left;min-width:220px;max-width:320px;white-space:normal;padding:4px 8px}',
    '.tk-root .cal td.out{background:#f3f4f6}.tk-root .cal td.today{outline:2px solid #1f6fb2;outline-offset:-2px}',
    '.tk-root .cal a.dot{display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:#1f7a3a;color:#fff;font-size:.72rem;font-weight:700;text-decoration:none}',
    '.tk-root .cal tr.row-out td{color:#8a949a}.tk-root .elapsed-warn{color:#b3382c;font-weight:700}.tk-root .period-small{font-size:.75rem;color:#5b656b}.tk-root .period-small .custom{color:#1f6fb2;font-weight:700}',
    '@media (max-width:640px){.tk-root{font-size:14px}.tk-root header{padding:10px 14px;gap:12px}.tk-root header h1{font-size:1rem}.tk-root .container{margin:12px auto;padding:0 10px}',
    '.tk-root .card{padding:14px 12px;margin-bottom:14px}.tk-root h2{font-size:1rem}.tk-root .btn{padding:9px 12px}.tk-root .menu-grid{grid-template-columns:1fr;gap:10px}',
    '.tk-root table{font-size:.82rem}.tk-root th,.tk-root td{padding:6px}.tk-root .item-table select{min-width:84px}',
    '.tk-root input[type=text],.tk-root input[type=date],.tk-root input[type=number],.tk-root textarea,.tk-root select{font-size:16px}',
    '.tk-root .filter-bar .search-input{width:100%}.tk-root .table-wrap{overflow-x:auto}}'
  ].join('\n');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
