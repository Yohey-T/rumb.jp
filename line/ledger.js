/* KohKey Line — 公開の記録。届いた声を1日1回、手で1行ずつ足す。
   声そのものや中身は載せない。番号・日付・長さ・言語だけ。
   言語は本人が聴いて書く。分からなければ "a language I couldn't place"。
   新しいものを下に足す。例：
     { no: 1, date: 'Dec 2', sec: 14, lang: 'Portuguese' },
     { no: 2, date: 'Dec 3', sec: 22, lang: "a language I couldn't place" }, */
window.KOHKEY_LEDGER = [
];

(function () {
  var list = window.KOHKEY_LEDGER || [];
  var box = document.getElementById('ledger');
  if (!box || !list.length) return; // 1件も無いあいだは何も出さない
  var langs = {};
  list.forEach(function (r) {
    if (r.lang.indexOf("couldn't place") < 0) langs[r.lang.toLowerCase()] = 1;
  });
  var n = Object.keys(langs).length;
  document.getElementById('ledger-sum').textContent =
    list.length + (list.length === 1 ? ' message' : ' messages') + ' left' +
    (n ? ' · ' + n + (n === 1 ? ' language' : ' languages') + ' named' : '') + '.';
  var ol = document.getElementById('ledger-list');
  list.slice().reverse().forEach(function (r) {
    var li = document.createElement('li');
    li.textContent = 'No. ' + r.no + ' · ' + r.date + ' · ' + r.sec + ' sec · ' + r.lang;
    ol.appendChild(li);
  });
  box.hidden = false;
})();
