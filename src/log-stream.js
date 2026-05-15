'use strict';

const MAX_BUFFER = 500;

const _buffer = [];
const _subscribers = new Set();

function _emit(level, text) {
  const entry = { ts: new Date().toISOString(), level, text };
  _buffer.push(entry);
  if (_buffer.length > MAX_BUFFER) _buffer.shift();
  for (const fn of _subscribers) fn(entry);
}

function install() {
  const orig = { log: console.log, error: console.error, warn: console.warn };
  ['log', 'error', 'warn'].forEach(method => {
    console[method] = (...args) => {
      orig[method](...args);
      const level = method === 'log' ? 'info' : method;
      _emit(level, args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  });
}

function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

function getBuffer() {
  return [..._buffer];
}

module.exports = { install, subscribe, getBuffer };
