/* KohKey Line — settings you can change without touching the rest.
   あとで差し替えるものは、すべてこのファイルにあります。 */
window.KOHKEY = {
  // 電話番号。Twilio で番号を取ったら、この2行を書き換える。
  phoneDisplay: '+1 (572) 221-7275', // 画面に出す形
  phoneDial: '+15722217275',                // 例 '+15551234567'。空のあいだは「電話でかける」リンクを出さない

  // 声の送り先。空のあいだは「試し表示」で、どこにも送らない（send.js を参照）。
  sendEndpoint: 'https://script.google.com/macros/s/AKfycbwGdGjy2t35HK_NfTmVoxCQEHAQtER1VNellIdEHSIfmrKUkmyWwqg3J8IOgV92goCA/exec',

  // 注意書き・削除依頼ページの URL。空のあいだはリンクを出さない。
  aboutUrl: 'about.html',

  // 録音の長さの上限（秒）
  maxSeconds: 30,

  // 音のファイル。web/audio/ に置く。拡張子は書かない。
  // 同じ名前で .mp3 → .m4a → .wav の順に探し、最初に見つかったものを使う。
  // 見つからない音は、短い間をあけて飛ばす。
  audioDir: 'audio/',
  audioExts: ['mp3', 'm4a', 'wav'],

  // 声が流れているあいだ画面に出す字幕。録った声の原稿と揃える。
  captions: {
    'welcome': 'Welcome to the program.',
    'menu': 'To hear the music, press one. To leave a few words for someone taking a step tomorrow, press two. If you press two, you will be recorded. Only the person who made this record will hear it.',
    'track-web': 'Out of Step (excerpt)',
    'before-record': 'Leave your message. Any language. Thirty seconds.',
    'thanks': 'Thank you. It will be heard.',
    'goodbye': 'This line is not a helpline. If you need someone to talk to, visit findahelpline.com. Just begin.'
  }
};
