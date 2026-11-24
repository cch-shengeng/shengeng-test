/* ================================================================
   網站設定檔 —— 日常維護不用改這裡，只有「第一次接上 Google 試算表」時要填。
   ================================================================ */
window.SITE_CONFIG = {
  // Google 試算表 ID：網址 https://docs.google.com/spreadsheets/d/【這一段】/edit
  // 留空（''）時，網站會使用 data.js 裡的內建資料。
  sheetId: '15Im0pK3oKvhn4FeEqZtsrpvIT3r8bEik',

  // 試算表的分頁名稱（要和試算表下方的分頁標籤一模一樣）
  tabs: {
    news: '公告',
    courses: '課程',
    results: '成果',
    minutes: '議錄',
    resources: '資源'
  },

  // 醫院原系統的連結（成果、議錄的完整列表仍放在原後台）
  cms: {
    home: 'https://dpt.cch.org.tw/layout/layout_1/index.aspx?ID=91192',
    results: 'https://dpt.cch.org.tw/layout/layout_1/item.aspx?cID=610&ID=91192',
    minutes: 'https://dpt.cch.org.tw/layout/layout_1/item.aspx?cID=611&ID=91192',
    courses: 'https://dpt.cch.org.tw/layout/layout_1/news.aspx?cID=1349&ID=91192',
    contacts: 'https://dpt.cch.org.tw/layout/layout_1/about.aspx?Key=440&ID=91192',
    experts: 'https://dpt.cch.org.tw/layout/layout_1/about.aspx?Key=441&ID=91192'
  }
};
