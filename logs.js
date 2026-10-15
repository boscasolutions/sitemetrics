'use strict';

const fs = require('fs');
const Tail = require('tail').Tail;

const LOG_DIR = '/etc/bosca/logs';
const LOG_SOURCES = [
  'log-server-net2',
  'log-server-suprema',
  'messaging-endpoint',
  'messaging-eventsync-endpoint',
  'messaging-priority-endpoint',
  'webapi',
];

// Poll for log files that don't exist yet (e.g. right after a date rollover)
// before giving up. Prevents crashing when a day's log hasn't been created.
const FILE_RETRY_MS = 10000;
// How often to check whether the calendar day has rolled over.
const ROLLOVER_CHECK_MS = 60000;

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Tails today's log files and emits every new line on the socket.io server as a
 * 'log' event. Re-creates the tails when the calendar day changes.
 */
function createLogStreamer({
  io,
  logDir = LOG_DIR,
  sources = LOG_SOURCES,
  fileRetryMs = FILE_RETRY_MS,
  rolloverCheckMs = ROLLOVER_CHECK_MS,
}) {
  let activeTails = [];
  let currentDay = null;
  let rolloverTimer = null;
  const retryTimers = new Set();

  function stopTails() {
    for (const tail of activeTails) {
      try {
        tail.unwatch();
      } catch (error) {
        console.log('Failed to unwatch tail: ', error);
      }
    }
    activeTails = [];
  }

  function scheduleRetry(filePath, day) {
    const timer = setTimeout(() => {
      retryTimers.delete(timer);
      tailFile(filePath, day);
    }, fileRetryMs);
    retryTimers.add(timer);
  }

  // Start tailing a single file. If it doesn't exist yet (the Tail constructor
  // throws on a missing file), retry until it appears - as long as we're still
  // on the same day it was scheduled for.
  function tailFile(filePath, day) {
    if (day !== currentDay) {
      return;
    }

    if (!fs.existsSync(filePath)) {
      scheduleRetry(filePath, day);
      return;
    }

    try {
      const tail = new Tail(filePath, { follow: true });
      tail.on('line', function(data) {
        io.emit('log', data);
      });
      tail.on('error', function(error) {
        console.log('Tail ERROR: ', filePath, error);
      });
      activeTails.push(tail);
      console.log('Tailing ', filePath);
    } catch (error) {
      console.log('Failed to start tail, will retry: ', filePath, error.message);
      scheduleRetry(filePath, day);
    }
  }

  // (Re)initialise the tails for the current calendar day.
  function startTailsForToday() {
    stopTails();
    currentDay = dayStamp();
    for (const source of sources) {
      tailFile(`${logDir}/${source}-${currentDay}.log`, currentDay);
    }
  }

  function start() {
    startTailsForToday();

    // Re-create the tails when the date changes so we always follow today's logs.
    rolloverTimer = setInterval(function() {
      if (dayStamp() !== currentDay) {
        console.log('Date rollover detected, reinitialising log tails');
        startTailsForToday();
      }
    }, rolloverCheckMs);
  }

  function stop() {
    if (rolloverTimer) {
      clearInterval(rolloverTimer);
      rolloverTimer = null;
    }
    for (const timer of retryTimers) {
      clearTimeout(timer);
    }
    retryTimers.clear();
    // Pending retries compare against currentDay, so clearing it makes them no-ops.
    currentDay = null;
    stopTails();
  }

  return { start, stop };
}

module.exports = { createLogStreamer, dayStamp, LOG_DIR, LOG_SOURCES };
