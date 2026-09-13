// Winziger Zustands-Speicher mit Selektor-Hook (ähnlich zustand, ohne Abhängigkeiten).
import { useState, useEffect, useRef } from '../lib/preact.js';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      subs.forEach((f) => f(state));
    },
    replace(next) {
      state = next;
      subs.forEach((f) => f(state));
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export function useStore(store, selector = (s) => s, equal = shallowEqual) {
  const [, force] = useState(0);
  const selRef = useRef(selector);
  selRef.current = selector;
  const value = selector(store.get());
  const valRef = useRef(value);
  valRef.current = value;
  useEffect(() => {
    const check = (s) => {
      const v = selRef.current(s);
      if (!equal(v, valRef.current)) {
        valRef.current = v;
        force((x) => x + 1);
      }
    };
    const unsub = store.subscribe(check);
    check(store.get());
    return unsub;
  }, [store]);
  return value;
}
