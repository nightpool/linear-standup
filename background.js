chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'startStandup') return;

  chrome.tabs.create({ url: msg.url }, (tab) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        }).then(() => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'initStandup',
            excludedUsers: msg.excludedUsers || [],
          });
        });
      }
    });
  });
});
