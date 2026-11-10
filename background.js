// アクションボタンのクリックでサイドパネルを開きます。外部通信は行いません。
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  console.error("サイドパネルの設定に失敗しました", error);
});
