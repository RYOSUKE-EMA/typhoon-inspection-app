/*
 * 安全旬報（kintone版）カスタマイズ
 *  - 新規作成：点検項目の自動展開、前回入力のプレフィル、保存＝提出（プロセス管理「提出する」を自動実行）
 *  - 差し戻す：理由を入力（任意）して「差し戻し理由」へ
 *  - 詳細：PDF出力／この工事の旬報を一括PDF（様式PDFに重ね書き）
 *  - 提出状況ビュー：対象現場 × 上旬・中旬・下旬
 * 依存：pdf-lib.min.js / fontkit.umd.min.js（このJSより先に読み込む）
 */
(function () {
  'use strict';

  var CONF_APP = 5830;        // 安全旬報 設定（提出状況・点検項目・PDF資材）
  var MASTER_APP = 269;       // 工事マスタ
  var PERIODS = ['上旬', '中旬', '下旬'];
  var ACT_SUBMIT = '提出する';
  var ACT_RETURN = '差し戻す';

  // ───────── 共通 ─────────
  function isMobile() { return location.pathname.indexOf('/k/m/') === 0; }
  function appId() { return isMobile() ? kintone.mobile.app.getId() : kintone.app.getId(); }
  function api(path, method, body) { return kintone.api(kintone.api.url(path, true), method, body); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function userNames(v) { return (v || []).map(function (u) { return u.name; }).join('、'); }

  // $id カーソルで全件取得
  function fetchAll(app, query, fields) {
    var out = [];
    function next(lastId) {
      var q = (query ? '(' + query + ') and ' : '') + '$id > ' + lastId + ' order by $id asc limit 500';
      var params = { app: app, query: q };
      if (fields) params.fields = fields.concat(['$id']);
      return api('/k/v1/records', 'GET', params).then(function (r) {
        out = out.concat(r.records);
        if (r.records.length === 500) return next(r.records[r.records.length - 1].$id.value);
        return out;
      });
    }
    return next(0);
  }

  var confCache = null;
  function loadConf() {
    if (!confCache) confCache = fetchAll(CONF_APP, '', null);
    return confCache;
  }

  // 点検項目の既定（設定アプリに「点検項目」レコードが無い場合）
  var DEFAULT_ITEMS = null; // 設定アプリが正本。空のときだけ使う（下で埋め込み）

  function loadItems() {
    return loadConf().then(function (recs) {
      var r = recs.filter(function (x) { return x.kind.value === '点検項目'; })[0];
      var lines = r ? r.body.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
      return lines.length ? lines : (DEFAULT_ITEMS || []);
    });
  }

  function defaultPeriod(d) {
    var day = d.getDate();
    return day <= 10 ? '上旬' : (day <= 20 ? '中旬' : '下旬');
  }

  // ───────── 新規作成 ─────────
  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
    var rec = event.record;
    var now = new Date();
    rec.report_month.value = String(now.getMonth() + 1);
    rec.report_period.value = defaultPeriod(now);
    hideFields(['return_reason', 'legacy_id', 'legacy_note'], false);
    var me = kintone.getLoginUser();
    var lastQ = '作成者 in ("' + me.code + '") order by $id desc limit 1';
    return Promise.all([
      loadItems(),
      api('/k/v1/records', 'GET', { app: appId(), query: lastQ,
        fields: ['koji_no', 'site_manager', 'approver_tl', 'report_round'] })
    ]).then(function (res) {
      var items = res[0];
      var last = res[1].records[0];
      rec.checklist.value = items.map(function (name, i) {
        return { value: {
          item_no: { type: 'NUMBER', value: String(i + 1), disabled: true },
          item_name: { type: 'SINGLE_LINE_TEXT', value: name, disabled: true },
          result: { type: 'DROP_DOWN', value: '' },
          note: { type: 'SINGLE_LINE_TEXT', value: '' }
        } };
      });
      if (last && !rec.koji_no.value) {
        rec.koji_no.value = last.koji_no.value;
        rec.koji_no.lookup = true;
        rec.site_manager.value = last.site_manager.value;
        rec.approver_tl.value = last.approver_tl.value;
        if (last.report_round.value) rec.report_round.value = String(Number(last.report_round.value) + 1);
      }
      return event;
    }).catch(function (e) { console.error(e); return event; });
  });

  kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
    (event.record.checklist.value || []).forEach(function (row) {
      row.value.item_no.disabled = true;
      row.value.item_name.disabled = true;
    });
    if (!event.record.legacy_id.value) hideFields(['legacy_id', 'legacy_note'], false);
    return event;
  });

  function hideFields(codes, show) {
    codes.forEach(function (c) {
      try {
        if (isMobile()) kintone.mobile.app.record.setFieldShown(c, show);
        else kintone.app.record.setFieldShown(c, show);
      } catch (e) { /* 無視 */ }
    });
  }

  // 保存＝提出：保存直後にプロセス管理の「提出する」を実行
  kintone.events.on(['app.record.create.submit.success', 'mobile.app.record.create.submit.success'], function (event) {
    return api('/k/v1/record/status', 'PUT', { app: appId(), id: event.recordId, action: ACT_SUBMIT })
      .then(function () { return event; })
      .catch(function (e) {
        alert('保存しましたが、提出（TLへの通知）に失敗しました。レコード画面の「提出する」ボタンを押してください。\n' +
              ((e && e.message) || ''));
        return event;
      });
  });

  // 差し戻し：理由を入力（任意）
  kintone.events.on(['app.record.detail.process.proceed', 'mobile.app.record.detail.process.proceed'], function (event) {
    if (event.action.value !== ACT_RETURN) return event;
    var reason = window.prompt('差し戻し理由を入力してください（空欄のままでも差し戻せます）', '');
    if (reason === null) return false;   // キャンセル
    event.record.return_reason.value = reason;
    return event;
  });

  // ───────── 詳細：PDFボタン ─────────
  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    var rec = event.record;
    if (!rec.legacy_id.value) hideFields(['legacy_id', 'legacy_note'], false);
    if (!rec.return_reason.value) hideFields(['return_reason'], false);
    var space = isMobile() ? kintone.mobile.app.record.getHeaderSpaceElement()
                           : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space || space.querySelector('.junpo-btns')) return event;
    var box = document.createElement('span');
    box.className = 'junpo-btns';
    box.appendChild(button('PDF出力', function (b) {
      return withBusy(b, buildPdf([rec]).then(function (bytes) {
        saveBytes(bytes, pdfName(rec));
      }));
    }));
    box.appendChild(button('この工事の旬報を一括PDF', function (b) {
      return withBusy(b, bulkPdf(rec.koji_no.value));
    }));
    space.appendChild(box);
    return event;
  });

  function button(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = 'junpo-btn';
    b.onclick = function () { onClick(b); };
    return b;
  }
  function withBusy(b, p) {
    var t = b.textContent;
    b.disabled = true;
    b.textContent = '作成中...';
    return p.catch(function (e) { console.error(e); alert('PDFの作成に失敗しました：' + ((e && e.message) || e)); })
      .then(function () { b.disabled = false; b.textContent = t; });
  }

  // ───────── PDF ─────────
  var PAGE_H = 841.68;
  var LEFT_BOTTOMS = [135.0, 152.6, 166.1, 187.6, 205.1, 218.7, 236.2, 253.7, 275.2, 288.8,
    306.3, 345.3, 358.9, 376.4, 393.9, 411.4, 429.0, 446.5, 464.0, 481.5,
    499.1, 516.6, 534.2, 551.7, 569.3];
  var RIGHT_BOTTOMS = [131.2, 148.7, 166.2, 183.6, 201.2, 218.7, 236.3, 253.7, 271.2, 288.8,
    306.3, 323.8, 341.4, 358.9, 376.4, 402.8, 429.0, 446.6, 464.1, 481.7,
    499.1, 516.6, 534.1, 551.7, 569.1, 586.7, 604.2, 621.7, 639.4, 656.8,
    674.3, 691.9, 709.3, 726.8, 744.5];
  var RESULT_POS = LEFT_BOTTOMS.map(function (b) { return [255.1, b]; })
    .concat(RIGHT_BOTTOMS.map(function (b) { return [486.05, b]; }));

  var assetCache = null;
  function downloadFile(fileKey) {
    return fetch(kintone.api.url('/k/v1/file', true) + '?fileKey=' + encodeURIComponent(fileKey), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) throw new Error('資材ファイルの取得に失敗しました（' + r.status + '）');
      return r.arrayBuffer();
    });
  }
  function loadAssets() {
    if (assetCache) return assetCache;
    assetCache = loadConf().then(function (recs) {
      var r = recs.filter(function (x) { return x.kind.value === 'PDF資材'; })[0];
      if (!r) throw new Error('設定アプリにPDF資材がありません');
      var font = r.files.value.filter(function (f) { return /\.(ttf|otf)$/i.test(f.name); })[0];
      var tmpl = r.files.value.filter(function (f) { return /\.pdf$/i.test(f.name); })[0];
      return Promise.all([downloadFile(font.fileKey), downloadFile(tmpl.fileKey)]);
    }).then(function (res) { return { font: res[0], template: res[1] }; });
    assetCache.catch(function () { assetCache = null; });
    return assetCache;
  }

  function pdfName(rec) {
    var y = (rec.inspect_date.value || '').slice(0, 4);
    return rec.koji_no.value + '_安全旬報' + y + '年' + rec.report_month.value + '月' + rec.report_period.value + '.pdf';
  }

  // 1レコード分のページを doc に追加
  function addPage(doc, tmplDoc, font, rec) {
    var PDFLib = window.PDFLib;
    return doc.copyPages(tmplDoc, [0]).then(function (pages) {
      var page = doc.addPage(pages[0]);
      var black = PDFLib.rgb(0, 0, 0);
      var white = PDFLib.rgb(1, 1, 1);
      function Y(fy) { return PAGE_H - fy; }
      function w(t, s) { return font.widthOfTextAtSize(String(t), s); }
      function text(t, x, y, s) { if (t !== '' && t != null) page.drawText(String(t), { x: x, y: y, size: s, font: font, color: black }); }
      function center(t, x, y, s) { text(t, x - w(t, s) / 2, y, s); }
      function right(t, x, y, s) { text(t, x - w(t, s), y, s); }
      function rect(x, y, ww, hh) { page.drawRectangle({ x: x, y: y, width: ww, height: hh, color: white }); }

      // ヘッダー
      text(rec.koji_no.value, 80, Y(101.5), 9);
      var name = rec.koji_name.value || '';
      var nameW = 120, size = 9;
      while (size > 7 && w(name, size) > nameW) size -= 0.5;
      if (w(name, size) <= nameW) {
        text(name, 172, Y(101.5), size);
      } else {
        size = 6.5;
        while (size > 4.5 && w(name, size) > nameW * 2) size -= 0.5;
        var line1 = '';
        for (var i = 0; i < name.length; i++) {
          if (w(line1 + name[i], size) > nameW) break;
          line1 += name[i];
        }
        var line2 = name.slice(line1.length);
        while (line2 && w(line2, size) > nameW) line2 = line2.slice(0, -1);
        text(line1, 172, Y(100.5 - size - 0.8), size);
        text(line2, 172, Y(100.5), size);
      }
      text(rec.site_manager.value, 348, Y(101.5), 9);
      text(userNames(rec.inspector.value), 438, Y(101.5), 9);

      // タイトル
      rect(76, Y(81.6), 124, 9.6);
      var title = rec.report_month.value ? rec.report_month.value + '月　' + rec.report_period.value + '　安全・環境旬報' : '安全・環境旬報';
      text(title, 79, Y(81.0), 11);

      // 提出月日（作成日時）
      rect(390, Y(81.3), 70, 7.5);
      var c = new Date(rec['作成日時'].value);
      if (!isNaN(c)) text((c.getMonth() + 1) + '月' + c.getDate() + '日提出', 393, Y(81.0), 9);

      if (rec.report_round.value) center(rec.report_round.value, 279.0, Y(81.0), 9);

      // 点検結果
      (rec.checklist.value || []).slice(0, RESULT_POS.length).forEach(function (row, idx) {
        var p = RESULT_POS[idx];
        center(row.value.result.value || '', p[0], Y(p[1]) - 1.5, 9);
      });

      // 災害防止協議会
      if (rec.meeting_date.value) {
        var md = new Date(rec.meeting_date.value + 'T00:00:00');
        rect(186, Y(586.6), 13, 6);
        rect(205, Y(586.6), 14, 6);
        right(String(md.getMonth() + 1), 199, Y(585.5), 8);
        right(String(md.getDate()), 218.5, Y(585.5), 8);
      }
      text((rec.meeting_attendees.value || '').replace(/\r?\n/g, ' '), 85, Y(594.5), 8);
      var notes = (rec.meeting_notes.value || '').replace(/\r?\n/g, '');
      var curY = Y(656.5);
      for (var k = 0; k < notes.length; k += 21) {
        if (curY < Y(750)) break;
        text(notes.slice(k, k + 21), 123, curY, 7.5);
        curY -= 9.5;
      }
    });
  }

  function buildPdf(records) {
    var PDFLib = window.PDFLib;
    if (!PDFLib || !window.fontkit) return Promise.reject(new Error('PDFライブラリが読み込まれていません'));
    return loadAssets().then(function (a) {
      return Promise.all([PDFLib.PDFDocument.create(), PDFLib.PDFDocument.load(a.template)]).then(function (docs) {
        var doc = docs[0], tmpl = docs[1];
        doc.registerFontkit(window.fontkit);
        return doc.embedFont(a.font, { subset: false }).then(function (font) {
          var chain = Promise.resolve();
          records.forEach(function (r) { chain = chain.then(function () { return addPage(doc, tmpl, font, r); }); });
          return chain.then(function () { return doc.save(); });
        });
      });
    });
  }

  function saveBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  function periodOrder(p) { var i = PERIODS.indexOf(p); return i < 0 ? 9 : i; }

  function bulkPdf(kojiNo) {
    return fetchAll(appId(), 'koji_no = "' + kojiNo + '"', null).then(function (recs) {
      if (!recs.length) throw new Error('この工事の旬報がありません');
      recs.sort(function (a, b) {
        var ka = [(a.inspect_date.value || '').slice(0, 4), Number(a.report_month.value || 0), periodOrder(a.report_period.value), Number(a.$id.value)];
        var kb = [(b.inspect_date.value || '').slice(0, 4), Number(b.report_month.value || 0), periodOrder(b.report_period.value), Number(b.$id.value)];
        for (var i = 0; i < 4; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
        return 0;
      });
      return buildPdf(recs).then(function (bytes) {
        var t = new Date();
        saveBytes(bytes, kojiNo + '_安全旬報_一括（' + recs.length + '件）_' + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '.pdf');
      });
    });
  }

  // ───────── 提出状況 ─────────
  var state = { year: null, month: null };

  kintone.events.on('app.record.index.show', function (event) {
    var el = document.getElementById('junpo-status');
    if (!el) return event;
    var now = new Date();
    state.year = state.year || now.getFullYear();
    state.month = state.month || now.getMonth() + 1;
    renderStatus(el);
    return event;
  });

  kintone.events.on('mobile.app.record.index.show', function (event) {
    var sp = kintone.mobile.app.getHeaderSpaceElement();
    if (!sp || sp.querySelector('.junpo-mobile-status')) return event;
    var wrap = document.createElement('div');
    wrap.className = 'junpo-mobile-status';
    var area = document.createElement('div');
    area.id = 'junpo-status';
    area.style.display = 'none';
    wrap.appendChild(button('提出状況を表示', function (b) {
      var open = area.style.display === 'none';
      area.style.display = open ? '' : 'none';
      b.textContent = open ? '提出状況を閉じる' : '提出状況を表示';
      if (open) {
        var now = new Date();
        state.year = state.year || now.getFullYear();
        state.month = state.month || now.getMonth() + 1;
        renderStatus(area);
      }
    }));
    wrap.appendChild(area);
    sp.appendChild(wrap);
    return event;
  });

  var projectCache = null;
  function loadProjects(extras) {
    if (projectCache) return projectCache;
    var today = iso(new Date());
    projectCache = fetchAll(MASTER_APP, '(mkbJsYmd > TODAY() or mkuKsYmd > TODAY())',
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
    projectCache.catch(function () { projectCache = null; });
    return projectCache;
  }

  function renderStatus(el) {
    el.innerHTML = '<div class="junpo-wrap">読み込み中...</div>';
    var y = state.year, m = state.month;
    var lastDay = new Date(y, m, 0).getDate();
    confCache = null;
    loadConf().then(function (conf) {
      var extras = conf.filter(function (r) { return r.kind.value === '追加対象'; }).map(function (r) { return r.koji_no.value.trim(); });
      return Promise.all([
        loadProjects(extras),
        fetchAll(appId(), 'report_month in ("' + m + '") and inspect_date >= "' + y + '-01-01" and inspect_date <= "' + y + '-12-31"',
          ['koji_no', 'koji_name', 'report_period', 'ステータス']),
        Promise.resolve(conf)
      ]);
    }).then(function (res) {
      var projects = res[0], recs = res[1], conf = res[2];
      var periodsConf = {}, excluded = {};
      conf.forEach(function (r) {
        var no = (r.koji_no.value || '').trim();
        if (r.kind.value === '対象期間') periodsConf[no] = r;
        if (r.kind.value === '対象外' && Number(r.year.value) === y && Number(r.month.value) === m) excluded[no + '|' + r.period.value] = r;
      });
      var cells = {}, names = {};
      var rank = { '確認済': 3, '差し戻し': 2, 'TL承認待ち': 1, '未提出': 0 };
      recs.forEach(function (r) {
        var no = String(r.koji_no.value || '');
        names[no] = names[no] || r.koji_name.value;
        var cur = (cells[no] = cells[no] || {})[r.report_period.value];
        var st = r['ステータス'].value;
        if (!cur || rank[st] > rank[cur.st]) cells[no][r.report_period.value] = { st: st, id: r.$id.value };
      });
      var deadlines = { '上旬': 10, '中旬': 20, '下旬': lastDay };
      var ranges = { '上旬': [1, 10], '中旬': [11, 20], '下旬': [21, lastDay] };
      var today = iso(new Date());
      function dstr(d) { return y + '-' + pad(m) + '-' + pad(d); }

      function cellFor(no, per, start, end) {
        var c = (cells[no] || {})[per];
        if (c) return c;
        var lo = dstr(ranges[per][0]), hi = dstr(ranges[per][1]);
        if ((start && start > hi) || (end && end < lo)) return { st: '期間外' };
        var ex = excluded[no + '|' + per];
        if (ex) return { st: '対象外', ex: ex };
        return { st: today > dstr(deadlines[per]) ? '期限超過' : '未提出' };
      }

      var rows = projects.map(function (p) {
        var pc = periodsConf[p.no];
        var start = pc ? (pc.start_date.value || '') : p.start;
        var end = pc ? (pc.end_date.value || '') : p.end;
        var cs = {};
        PERIODS.forEach(function (per) { cs[per] = cellFor(p.no, per, start, end); });
        var allOut = PERIODS.every(function (per) { return cs[per].st === '期間外'; });
        return { no: p.no, name: p.name, start: start, end: end, custom: !!pc, pc: pc, cells: cs, allOut: allOut };
      });
      rows.sort(function (a, b) { return (a.allOut ? 1 : 0) - (b.allOut ? 1 : 0); });
      var listed = {};
      projects.forEach(function (p) { listed[p.no] = 1; });
      var extraRows = Object.keys(cells).filter(function (no) { return !listed[no]; }).sort().map(function (no) {
        var cs = {};
        PERIODS.forEach(function (per) { cs[per] = (cells[no] || {})[per] || { st: '未提出' }; });
        return { no: no, name: names[no] || '', cells: cs, extra: true };
      });
      draw(el, { y: y, m: m, rows: rows, extraRows: extraRows, deadlines: deadlines,
                 active: rows.filter(function (r) { return !r.allOut; }).length });
    }).catch(function (e) {
      console.error(e);
      el.innerHTML = '<div class="junpo-wrap">提出状況の読み込みに失敗しました：' + esc((e && e.message) || e) + '</div>';
    });
  }

  function recordUrl(id) { return isMobile() ? '/k/m/' + appId() + '/show?record=' + id : '/k/' + appId() + '/show#record=' + id; }

  function cellHtml(r, per, c) {
    var label = { '確認済': '承認済', 'TL承認待ち': '提出済', '差し戻し': '差し戻し', '未提出': '未提出' };
    if (c.id) {
      var cls = c.st === '確認済' ? 'ok' : (c.st === '差し戻し' ? 'ng' : (c.st === '未提出' ? 'none' : 'wait'));
      var text = c.st === '未提出' ? '下書き' : label[c.st];
      return '<a class="jb ' + cls + '" href="' + recordUrl(c.id) + '">' + text + '</a>';
    }
    if (c.st === '期間外') return '<span class="out">期間外</span>';
    if (r.extra) return '<span class="jb none">未提出</span>';
    if (c.st === '対象外') {
      return '<span class="jb none" title="' + esc(c.ex['作成者'] ? c.ex['作成者'].value.name : '') + 'が設定">対象外</span>' +
        '<br><button type="button" class="lnk" data-act="unexcl" data-id="' + c.ex.$id.value + '">対象に戻す</button>';
    }
    return '<span class="jb ' + (c.st === '期限超過' ? 'late' : 'none') + '">' + (c.st === '期限超過' ? '未提出（期限超過）' : '未提出') + '</span>' +
      '<br><button type="button" class="lnk" data-act="excl" data-no="' + r.no + '" data-per="' + per + '">対象外にする</button>';
  }

  function draw(el, v) {
    var h = [];
    h.push('<div class="junpo-wrap">');
    h.push('<p class="note">対象現場：工事№の3〜5桁目が「041」（＋設定アプリの追加対象）で、工期終了日が今日より後の工事。対象期間の初期値は工事マスタの工期で、「変更」から現場ごとに設定できます。提出期限：上旬10日・中旬20日・下旬月末。</p>');
    h.push('<div class="nav"><button type="button" class="junpo-btn" data-act="prev">← 前月</button>' +
           '<b>' + v.y + '年' + v.m + '月</b>' +
           '<button type="button" class="junpo-btn" data-act="next">翌月 →</button>' +
           '<span class="cnt">今月の対象 ' + v.active + ' 現場（一覧 ' + v.rows.length + ' 現場）</span></div>');
    h.push('<div class="scroll"><table class="jt"><thead><tr><th>工事№</th><th>工事名</th><th>対象期間</th>');
    PERIODS.forEach(function (p) { h.push('<th class="c">' + p + '<br><small>〜' + v.m + '/' + v.deadlines[p] + '</small></th>'); });
    h.push('</tr></thead><tbody>');
    v.rows.forEach(function (r) {
      h.push('<tr class="' + (r.allOut ? 'rowout' : '') + '"><td>' + r.no +
             '<br><button type="button" class="lnk" data-act="bulk" data-no="' + r.no + '">一括PDF</button></td>' +
             '<td>' + esc(r.name) + '</td>' +
             '<td class="per"><span class="' + (r.custom ? 'custom' : '') + '">' + (r.start || '未定').replace(/-/g, '/') + ' 〜 ' + (r.end || '未定').replace(/-/g, '/') + '</span>' +
             ' <button type="button" class="lnk" data-act="period" data-no="' + r.no + '" data-start="' + (r.start || '') + '" data-end="' + (r.end || '') +
             '" data-id="' + (r.pc ? r.pc.$id.value : '') + '">変更</button></td>');
      PERIODS.forEach(function (p) { h.push('<td class="c">' + cellHtml(r, p, r.cells[p]) + '</td>'); });
      h.push('</tr>');
    });
    if (!v.rows.length) h.push('<tr><td colspan="6">対象現場が取得できませんでした。</td></tr>');
    h.push('</tbody></table></div>');
    if (v.extraRows.length) {
      h.push('<h4>対象リスト外の工事№で提出されたもの</h4><div class="scroll"><table class="jt"><thead><tr><th>工事№</th><th>工事名</th>');
      PERIODS.forEach(function (p) { h.push('<th class="c">' + p + '</th>'); });
      h.push('</tr></thead><tbody>');
      v.extraRows.forEach(function (r) {
        h.push('<tr><td>' + r.no + '<br><button type="button" class="lnk" data-act="bulk" data-no="' + r.no + '">一括PDF</button></td><td>' + esc(r.name) + '</td>');
        PERIODS.forEach(function (p) { h.push('<td class="c">' + cellHtml(r, p, r.cells[p]) + '</td>'); });
        h.push('</tr>');
      });
      h.push('</tbody></table></div>');
    }
    h.push('</div>');
    el.innerHTML = h.join('');
    el.onclick = function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'prev' || act === 'next') {
        var d = new Date(state.year, state.month - 1 + (act === 'next' ? 1 : -1), 1);
        state.year = d.getFullYear();
        state.month = d.getMonth() + 1;
        renderStatus(el);
      } else if (act === 'bulk') {
        withBusy(b, bulkPdf(b.getAttribute('data-no')));
      } else if (act === 'excl') {
        var no = b.getAttribute('data-no'), per = b.getAttribute('data-per');
        if (!confirm(no + ' の' + state.year + '年' + state.month + '月' + per + 'を提出対象外にしますか？')) return;
        api('/k/v1/record', 'POST', { app: CONF_APP, record: {
          kind: { value: '対象外' }, koji_no: { value: no }, year: { value: state.year }, month: { value: state.month }, period: { value: per }
        } }).then(function () { renderStatus(el); }).catch(showErr);
      } else if (act === 'unexcl') {
        api('/k/v1/records', 'DELETE', { app: CONF_APP, ids: [b.getAttribute('data-id')] })
          .then(function () { renderStatus(el); }).catch(showErr);
      } else if (act === 'period') {
        editPeriod(el, b);
      }
    };
  }

  function showErr(e) { alert('保存できませんでした：' + ((e && e.message) || e)); }

  function editPeriod(el, b) {
    var no = b.getAttribute('data-no'), id = b.getAttribute('data-id');
    var s = window.prompt(no + ' の対象期間の開始日（例 2026-11-15）。空欄で工事マスタの工期に戻します。', b.getAttribute('data-start'));
    if (s === null) return;
    s = s.trim();
    if (!s) {
      if (!id) return;
      api('/k/v1/records', 'DELETE', { app: CONF_APP, ids: [id] }).then(function () { renderStatus(el); }).catch(showErr);
      return;
    }
    var e = window.prompt(no + ' の対象期間の終了日（例 2027-03-31）', b.getAttribute('data-end'));
    if (e === null) return;
    e = e.trim();
    var re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(s) || (e && !re.test(e))) { alert('日付は 2026-11-15 の形式で入力してください。'); return; }
    var rec = { kind: { value: '対象期間' }, koji_no: { value: no }, start_date: { value: s }, end_date: { value: e || null } };
    var p = id ? api('/k/v1/record', 'PUT', { app: CONF_APP, id: id, record: rec })
               : api('/k/v1/record', 'POST', { app: CONF_APP, record: rec });
    p.then(function () { renderStatus(el); }).catch(showErr);
  }

  // ───────── スタイル ─────────
  var css = [
    '.junpo-btn{margin:4px 6px 4px 0;padding:6px 14px;border:1px solid #3498db;background:#fff;color:#3498db;border-radius:16px;cursor:pointer;font-size:13px}',
    '.junpo-btn:hover{background:#eaf4fb}.junpo-btn:disabled{opacity:.6;cursor:default}',
    '.junpo-wrap{padding:12px 16px;font-size:13px;color:#333}',
    '.junpo-wrap .note{color:#666;margin:0 0 8px;line-height:1.6}',
    '.junpo-wrap .nav{display:flex;align-items:center;gap:8px;margin:8px 0 12px;flex-wrap:wrap}',
    '.junpo-wrap .nav b{font-size:17px}.junpo-wrap .cnt{margin-left:auto;color:#666}',
    '.junpo-wrap .scroll{overflow-x:auto}',
    '.jt{border-collapse:collapse;min-width:720px;width:100%;background:#fff}',
    '.jt th,.jt td{border:1px solid #e3e7e8;padding:6px 8px;vertical-align:middle}',
    '.jt th{background:#f5f7f8;font-weight:600;white-space:nowrap}.jt .c{text-align:center;width:120px}',
    '.jt td.per{white-space:nowrap;font-size:12px}.jt .custom{color:#1f6fb2;font-weight:700}',
    '.jt tr.rowout td{background:#fafbfb;color:#8a949a}',
    '.jb{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;text-decoration:none;border:1px solid}',
    '.jb.ok{background:#e8f5ec;color:#1f7a3a;border-color:#9fd3ae}',
    '.jb.wait{background:#fff6e0;color:#946200;border-color:#f0d083}',
    '.jb.ng,.jb.late{background:#fdeceb;color:#b3382c;border-color:#e8a39b;font-weight:700}',
    '.jb.none{background:#f3f4f6;color:#8a949a;border-color:#d9dee2}',
    '.jt .out{color:#b0b8bd;font-size:12px}',
    '.lnk{background:none;border:none;color:#7a858c;font-size:11px;text-decoration:underline;cursor:pointer;padding:0;margin-top:3px}',
    '.junpo-mobile-status{padding:8px}'
  ].join('\n');
  window.__junpo = { buildPdf: buildPdf };   // 動作確認用
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
