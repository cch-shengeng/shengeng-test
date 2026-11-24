/* =========================================================
   簽到・簽退・滿意度 設定檔（只需在第一次部署時填一次）
   ========================================================= */
window.ATTEND_CONFIG = {
  // Google Apps Script 部署成「網頁應用程式」後的網址（結尾 /exec）
  // 留空 = 示範模式：資料只存在這支手機／電腦的瀏覽器裡，方便先試用畫面
  gasUrl: '',

  // 三個固定縮網址（管理頁會用來產生 QR Code）
  links: {
    checkin: 'https://cchedu.pse.is/update-in',
    checkout: 'https://cchedu.pse.is/update-out',
    feedback: 'https://cchedu.pse.is/update-feedback'
  }
};
