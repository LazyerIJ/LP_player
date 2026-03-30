/**
 * Background Service Worker
 * Relays playback state from content script to the LP player page.
 */

// Store latest state so player page can get it immediately on open
let latestState = {
  isPlaying: false,
  title: '',
  artist: '',
  albumArtUrl: '',
  currentTime: 0,
  duration: 0,
};

// Track connected player pages
const playerPorts = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PLAYBACK_STATE') {
    latestState = msg.payload;
    // Broadcast to all connected player pages
    for (const port of playerPorts) {
      try {
        port.postMessage({ type: 'PLAYBACK_STATE', payload: latestState });
      } catch {
        playerPorts.delete(port);
      }
    }
  }

  if (msg.type === 'GET_STATE') {
    sendResponse(latestState);
    return true;
  }

  if (msg.type === 'OPEN_PLAYER') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('player/player.html'),
    });
  }

  // Forward commands from player page to YouTube Music content script
  if (msg.type === 'TOGGLE_PLAYBACK' || msg.type === 'PLAY_TRACK' || msg.type === 'NEXT_TRACK' || msg.type === 'PREV_TRACK') {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, msg);
      }
    });
  }

  // Forward query commands and return response
  if (msg.type === 'GET_QUEUE' || msg.type === 'INSPECT_QUEUE_DOM') {
    chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse(null);
      }
    });
    return true; // async sendResponse
  }
});

// Reset state when YouTube Music tab is closed or navigated away
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.tabs.query({ url: '*://music.youtube.com/*' }, (tabs) => {
    if (tabs.length === 0) {
      latestState = {
        isPlaying: false,
        title: '',
        artist: '',
        albumArtUrl: '',
        currentTime: 0,
        duration: 0,
      };
      for (const port of playerPorts) {
        try {
          port.postMessage({ type: 'PLAYBACK_STATE', payload: latestState });
        } catch {
          playerPorts.delete(port);
        }
      }
    }
  });
});

// Long-lived connections from player pages
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'lp-player') {
    playerPorts.add(port);

    // Send current state immediately
    port.postMessage({ type: 'PLAYBACK_STATE', payload: latestState });

    port.onDisconnect.addListener(() => {
      playerPorts.delete(port);
    });
  }
});
