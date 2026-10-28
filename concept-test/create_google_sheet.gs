/**
 * 26年度 商品開発 コンセプト・テスト（紙回答）Googleスプレッドシートを自動生成
 *
 * 使い方:
 * 1. https://script.google.com/ を開く
 * 2. 「新しいプロジェクト」を作成
 * 3. このコードを貼り付け
 * 4. createConceptTestSheet を選択して「実行」
 * 5. ログ（表示 > ログ）に生成されたスプレッドシートのURLが表示されます
 */
function createConceptTestSheet() {
  const title = '26年度 商品開発 コンセプト・テスト（紙回答）';
  const ss = SpreadsheetApp.create(title);
  const sheet = ss.getActiveSheet();
  sheet.setName('回答');

  const headers = [
    'タイムスタンプ',
    '学生区分',
    '性別',
    '現在使っている筆箱',
    '質問1-1',
    '質問1-2',
    '質問1-3',
    '質問1-4',
    '質問1-5',
  ];

  const rows = [
    ['', '中学生', '男性', '横型', 2, 3, 2, 2, 3],
    ['', '小学4〜6年生', '男性', '横型, ロールペンケース', 1, 5, 5, 1, 1],
    ['', '小学4〜6年生', '男性', '横型', 5, 5, 5, 5, 5],
    ['', '小学4〜6年生', '男性', '縦型', 2, 1, 1, 3, 2],
    ['', '小学1〜3年生', '女性', '横型, その他', 5, 5, 5, 5, 5],
    ['', '小学1〜3年生', '女性', 'パカパカ筆箱, その他', 5, 5, 5, 5, 5],
    ['', '中学生', '回答しない', '縦型', 4, 4, 1, 4, 3],
    ['', '中学生', '', '横型, その他', 2, 1, 1, 1, 1],
    ['', '中学生', '女性', '横型', 2, 3, 5, 1, 1],
    ['', '中学生', '女性', 'その他（ぬいぐるみ）', 5, 1, 1, 5, 1],
    ['', '中学生', '男性', 'ロールペンケース', 4, 1, 1, 5, 3],
    ['', '中学生', '男性', '横型', 5, 5, 4, 3, 4],
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  const url = ss.getUrl();
  Logger.log('スプレッドシートを作成しました: ' + url);
  SpreadsheetApp.getUi().alert('作成完了\\n' + url);
}
