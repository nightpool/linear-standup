chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url.includes('linear.app')) return;

  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ['styles.css'],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });
});
