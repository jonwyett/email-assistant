'use strict';

const cron = require('node-cron');

let _task = null;
let _running = false;
let _lastRun = null;
let _lastError = null;

function getStatus() {
  return {
    running: _running,
    lastRun: _lastRun,
    lastError: _lastError,
    schedule: _task ? _task.options?.scheduled : null,
  };
}

async function _execute(runFn) {
  if (_running) throw new Error('A pipeline run is already in progress');
  _running = true;
  _lastError = null;
  try {
    await runFn();
    _lastRun = new Date().toISOString();
  } catch (err) {
    _lastError = err.message;
    throw err;
  } finally {
    _running = false;
  }
}

function start(scheduleExpr, runFn) {
  if (_task) { _task.stop(); _task = null; }
  if (!scheduleExpr || !cron.validate(scheduleExpr)) {
    if (scheduleExpr) console.warn(`Scheduler: invalid cron expression "${scheduleExpr}" — scheduler disabled`);
    return;
  }
  _task = cron.schedule(scheduleExpr, () => {
    console.log(`Scheduler: firing (${scheduleExpr})`);
    _execute(runFn).catch(err => console.error(`Scheduler run failed: ${err.message}`));
  });
  console.log(`Scheduler: started with expression "${scheduleExpr}"`);
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function runNow(runFn) {
  return _execute(runFn);
}

module.exports = { start, stop, runNow, getStatus };
