function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

async function startStandup(msg) {
  const standupTab = await chrome.tabs.create({ url: msg.url });
  await waitForTabLoad(standupTab.id);
  await chrome.scripting.insertCSS({ target: { tabId: standupTab.id }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId: standupTab.id }, files: ['content.js'] });
  await chrome.tabs.sendMessage(standupTab.id, {
    action: 'initStandup',
    excludedUsers: msg.excludedUsers,
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'startStandup') {
    startStandup(msg);
  }
});
