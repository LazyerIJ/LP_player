/**
 * Content Script for YouTube Music
 * Extracts playback state, song info, and album art from the YouTube Music DOM.
 */
(() => {
  'use strict';

  // Selectors for YouTube Music DOM elements (centralized for easy updates)
  const SELECTORS = {
    playerBar: 'ytmusic-player-bar',
    title: '.title.ytmusic-player-bar',
    artist: '.byline.ytmusic-player-bar',
    albumArt: 'img.ytmusic-player-bar',
    playButton: '#play-pause-button',
    video: 'video',
    progressBar: '#progress-bar',
    timeInfo: '.time-info',
  };

  let lastState = {};
  let pollInterval = null;

  function getPlaybackState() {
    const video = document.querySelector(SELECTORS.video);
    const titleEl = document.querySelector(SELECTORS.title);
    const artistEl = document.querySelector(SELECTORS.artist);
    const albumArtEl = document.querySelector(SELECTORS.albumArt);
    const playButton = document.querySelector(SELECTORS.playButton);

    // Determine play state
    let isPlaying = false;
    if (video) {
      isPlaying = !video.paused;
    } else if (playButton) {
      // Fallback: check button aria-label or title
      const label = playButton.getAttribute('aria-label') || playButton.getAttribute('title') || '';
      isPlaying = label.toLowerCase().includes('pause');
    }

    // Get album art URL (request highest resolution)
    let albumArtUrl = '';
    if (albumArtEl && albumArtEl.src) {
      // YouTube Music uses w60-h60 etc. Replace to get high res
      albumArtUrl = albumArtEl.src.replace(/=w\d+-h\d+/, '=w544-h544');
    }

    // Get progress info
    let currentTime = 0;
    let duration = 0;
    if (video) {
      currentTime = video.currentTime || 0;
      duration = video.duration || 0;
    }

    return {
      isPlaying,
      title: titleEl?.textContent?.trim() || '',
      artist: artistEl?.textContent?.trim() || '',
      albumArtUrl,
      currentTime,
      duration,
    };
  }

  function hasStateChanged(newState) {
    return (
      newState.isPlaying !== lastState.isPlaying ||
      newState.title !== lastState.title ||
      newState.artist !== lastState.artist ||
      newState.albumArtUrl !== lastState.albumArtUrl
    );
  }

  function sendState(state) {
    chrome.runtime.sendMessage({
      type: 'PLAYBACK_STATE',
      payload: state,
    });
  }

  function poll() {
    const state = getPlaybackState();

    if (hasStateChanged(state)) {
      lastState = { ...state };
      sendState(state);
    }

    // Always send periodic updates for time progress
    sendState(state);
  }

  // Start polling
  function start() {
    if (pollInterval) return;
    pollInterval = setInterval(poll, 1000);
    // Send initial state immediately
    poll();
  }

  // Listen for requests from popup or player page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATE') {
      sendResponse(getPlaybackState());
    }

    // Reverse control: toggle play/pause from LP player
    if (msg.type === 'TOGGLE_PLAYBACK') {
      const video = document.querySelector(SELECTORS.video);
      if (video) {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      } else {
        // Fallback: click the play/pause button
        const btn = document.querySelector(SELECTORS.playButton);
        if (btn) btn.click();
      }
    }
  });

  // Also listen to video events for more responsive updates
  function attachVideoListeners() {
    const video = document.querySelector(SELECTORS.video);
    if (!video) return;

    const events = ['play', 'pause', 'playing', 'seeked'];
    events.forEach((evt) => {
      video.addEventListener(evt, () => {
        const state = getPlaybackState();
        lastState = { ...state };
        sendState(state);
      });
    });
  }

  // Wait for player to be ready, then start
  const observer = new MutationObserver(() => {
    if (document.querySelector(SELECTORS.playerBar)) {
      observer.disconnect();
      attachVideoListeners();
      start();
    }
  });

  // Check if already present
  if (document.querySelector(SELECTORS.playerBar)) {
    attachVideoListeners();
    start();
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
