// Zentrale Stelle für Preact + htm (ohne Build-Schritt, über die Import-Map in index.html).
import { h, render, Fragment, createContext, createRef, cloneElement, toChildArray } from 'preact';
import {
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
  useContext, useReducer, useErrorBoundary, useId,
} from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext, createRef, cloneElement, toChildArray,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
  useContext, useReducer, useErrorBoundary, useId,
};
