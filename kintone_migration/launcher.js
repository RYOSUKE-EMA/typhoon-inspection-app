/*
 * 建築G 各種点検記録（app 5287）：点検アプリの入口メニュー（kintone版の各アプリへ）
 * 2026-11 Vercel版の埋め込みを廃止。旧レコードは参照用として残す。
 */
(function () {
  'use strict';

  var APPS = [
    { id: 5829, label: '安全旬報', desc: '安全・環境旬報（上旬・中旬・下旬）。TL承認', status: '13465128' },
    { id: 5832, label: '台風養生点検', desc: '台風接近時の養生状況の点検。TL承認' },
    { id: 5833, label: '災害時現場点検', desc: '地震・異常気象時の現場点検。TL → GL・BL承認' },
    { id: 5834, label: '足場点検記録', desc: '組立後・変更後・悪天候後などの足場点検', status: '13465301' }
  ];

  function isMobile() { return location.pathname.indexOf('/k/m/') === 0; }
  function base(id) { return (isMobile() ? '/k/m/' : '/k/') + id + '/'; }

  function render(el) {
    var h = ['<div class="tl-wrap"><p class="tl-note">点検アプリはkintoneの各アプリに移りました。下のメニューから開いてください（「承認待ち」は自分が作業者になっている件数です）。</p><div class="tl-grid">'];
    APPS.forEach(function (a) {
      h.push('<div class="tl-card"><div class="tl-title">' + a.label + '<span class="tl-badge" data-app="' + a.id + '"></span></div>' +
        '<div class="tl-desc">' + a.desc + '</div><div class="tl-links">' +
        '<a class="tl-btn primary" href="' + base(a.id) + 'edit">新規作成</a>' +
        '<a class="tl-btn" href="' + base(a.id) + '">一覧</a>' +
        (a.status && !isMobile() ? '<a class="tl-btn" href="' + base(a.id) + '?view=' + a.status + '">提出状況</a>' : '') +
        '</div></div>');
    });
    h.push('</div><p class="tl-note">このアプリ（建築G 各種点検記録）のレコードは、移行前の記録として参照用に残しています。</p></div>');
    el.innerHTML = h.join('');
    APPS.forEach(function (a) {
      if (a.id === 5834) return;   // 足場は承認なし
      kintone.api(kintone.api.url('/k/v1/records', true), 'GET',
        { app: a.id, query: '作業者 in (LOGINUSER()) limit 1', totalCount: true, fields: ['$id'] })
        .then(function (r) {
          var n = Number(r.totalCount || 0);
          var b = el.querySelector('.tl-badge[data-app="' + a.id + '"]');
          if (b && n) b.textContent = '承認待ち ' + n;
        }).catch(function () { /* 権限がない場合など */ });
    });
  }

  kintone.events.on('app.record.index.show', function (event) {
    var frame = document.getElementById('tenken-frame');
    if (!frame) return event;
    var holder = document.createElement('div');
    frame.parentNode.replaceChild(holder, frame);
    render(holder);
    return event;
  });

  kintone.events.on('mobile.app.record.index.show', function (event) {
    var sp = kintone.mobile.app.getHeaderSpaceElement();
    if (sp && !sp.querySelector('.tl-wrap')) {
      var holder = document.createElement('div');
      sp.appendChild(holder);
      render(holder);
    }
    return event;
  });

  var css = [
    '.tl-wrap{padding:20px;font-size:14px;color:#333}',
    '.tl-note{color:#666;margin:0 0 14px;line-height:1.6}',
    '.tl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px}',
    '.tl-card{background:#fff;border:1px solid #e3e7e8;border-radius:12px;padding:16px}',
    '.tl-title{font-size:16px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px}',
    '.tl-badge:empty{display:none}.tl-badge{font-size:11px;font-weight:700;color:#b3382c;background:#fdeceb;border:1px solid #e8a39b;border-radius:10px;padding:1px 8px}',
    '.tl-desc{color:#666;font-size:12px;margin-bottom:12px;line-height:1.5}',
    '.tl-links{display:flex;gap:8px;flex-wrap:wrap}',
    '.tl-btn{display:inline-block;padding:6px 14px;border:1px solid #3498db;color:#3498db;border-radius:16px;text-decoration:none;font-size:13px}',
    '.tl-btn.primary{background:#3498db;color:#fff}'
  ].join('\n');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
