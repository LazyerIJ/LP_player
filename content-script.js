/**
 * Content Script for YouTube Music
 * Extracts playback state, song info, album art, and queue from the YouTube Music DOM.
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
    // Queue/playlist selectors
    queueItems: 'ytmusic-player-queue-item',
    // Navigation buttons
    nextButton: '.next-button',
    previousButton: '.previous-button',
  };

  let lastState = {};
  let pollInterval = null;

  function extractTimes(text) {
    if (!text) return [];

    const matches = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
    return matches || [];
  }

  function parseTimeToSeconds(timeText) {
    if (!timeText) return NaN;

    const parts = timeText
      .trim()
      .split(':')
      .map((part) => Number.parseInt(part, 10));

    if (parts.some((part) => Number.isNaN(part))) {
      return NaN;
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return NaN;
  }

  function parseTimeRangeText(rawText) {
    const matches = extractTimes(rawText);
    if (matches.length < 2) {
      return { currentTime: NaN, duration: NaN };
    }

    return {
      currentTime: parseTimeToSeconds(matches[0]),
      duration: parseTimeToSeconds(matches[1]),
    };
  }

  function getTimeInfoState() {
    const timeInfoEl = document.querySelector(SELECTORS.timeInfo);
    const rawText = timeInfoEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return parseTimeRangeText(rawText);
  }

  function getProgressBarState() {
    const progressBar = document.querySelector(SELECTORS.progressBar);
    if (!progressBar) {
      return { currentTime: NaN, duration: NaN };
    }

    const textCandidates = [
      progressBar.getAttribute('aria-valuetext'),
      progressBar.getAttribute('aria-label'),
      progressBar.textContent,
    ];

    for (const candidate of textCandidates) {
      const parsed = parseTimeRangeText(candidate?.replace(/\s+/g, ' ').trim() || '');
      if (Number.isFinite(parsed.currentTime) && Number.isFinite(parsed.duration)) {
        return parsed;
      }
    }

    const now = Number.parseFloat(
      progressBar.getAttribute('aria-valuenow') ??
      progressBar.getAttribute('value') ??
      ''
    );
    const max = Number.parseFloat(
      progressBar.getAttribute('aria-valuemax') ??
      progressBar.getAttribute('max') ??
      ''
    );

    if (Number.isFinite(now) && Number.isFinite(max) && max > 100 && now >= 0 && now <= max) {
      return { currentTime: now, duration: max };
    }

    return { currentTime: NaN, duration: NaN };
  }

  function getQueueTracks() {
    const items = document.querySelectorAll(SELECTORS.queueItems);
    const tracks = [];
    items.forEach((item, i) => {
      const title = item.querySelector('.song-title, yt-formatted-string.title, .title')?.textContent?.trim() || '';
      const artist = item.querySelector('.byline, .secondary-flex-columns yt-formatted-string')?.textContent?.trim() || '';
      const duration = item.querySelector('.duration, .fixed-columns yt-formatted-string')?.textContent?.trim() || '';
      const isPlaying = item.getAttribute('play-button-state') === 'playing';

      // Thumbnail: yt-img-shadow contains the actual img
      let thumbnail = '';
      const imgShadow = item.querySelector('yt-img-shadow');
      if (imgShadow) {
        const img = imgShadow.querySelector('img');
        if (img && img.src && !img.src.startsWith('data:')) {
          thumbnail = img.src.replace(/=w\d+-h\d+/, '=w120-h120');
        }
      }

      tracks.push({ index: i, title, artist, thumbnail, duration, isPlaying });
    });
    return tracks;
  }

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
      const label = playButton.getAttribute('aria-label') || playButton.getAttribute('title') || '';
      isPlaying = label.toLowerCase().includes('pause');
    }

    // Get album art URL (request highest resolution)
    let albumArtUrl = '';
    if (albumArtEl && albumArtEl.src) {
      albumArtUrl = albumArtEl.src.replace(/=w\d+-h\d+/, '=w544-h544');
    }

    // Get progress info from the visible player UI first.
    let { currentTime, duration } = getTimeInfoState();

    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
      const progressBarState = getProgressBarState();
      if (Number.isFinite(progressBarState.currentTime)) {
        currentTime = progressBarState.currentTime;
      }
      if (Number.isFinite(progressBarState.duration) && progressBarState.duration > 0) {
        duration = progressBarState.duration;
      }
    }

    if (video) {
      if (!Number.isFinite(currentTime)) {
        currentTime = video.currentTime || 0;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        duration = video.duration || 0;
      }
    }

    currentTime = Number.isFinite(currentTime) ? currentTime : 0;
    duration = Number.isFinite(duration) ? duration : 0;

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
    poll();
  }

  // Listen for requests from popup or player page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATE') {
      sendResponse(getPlaybackState());
    }

    if (msg.type === 'GET_QUEUE') {
      sendResponse(getQueueTracks());
      return true;
    }

    // Play specific track in queue by clicking it
    if (msg.type === 'PLAY_TRACK') {
      const items = document.querySelectorAll(SELECTORS.queueItems);
      const target = items[msg.index];
      if (target) {
        // Click the thumbnail/play overlay area to trigger playback
        const playBtn = target.querySelector('ytmusic-play-button-renderer');
        if (playBtn) {
          playBtn.click();
        } else {
          target.click();
        }
      }
    }

    if (msg.type === 'NEXT_TRACK') {
      const el = document.querySelector(SELECTORS.nextButton);
      if (el) (el.querySelector('button') || el).click();
    }

    if (msg.type === 'PREV_TRACK') {
      const el = document.querySelector(SELECTORS.previousButton);
      if (el) (el.querySelector('button') || el).click();
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

  if (document.querySelector(SELECTORS.playerBar)) {
    attachVideoListeners();
    start();
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
