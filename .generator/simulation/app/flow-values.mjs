import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const at = (value, path) => String(path).split('.').filter(Boolean).reduce((v, key) =>
  ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : v?.[key], value);

export function resolveInputs(value, context) {
  if (Array.isArray(value)) return value.map(v => resolveInputs(v, context));
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, '$matches')) {
    const [row, alternatives] = resolveInputs(value.$matches, context);
    return matchesAny(row, alternatives);
  }
  if (Object.hasOwn(value, '$some')) {
    const [rows, alternatives] = resolveInputs(value.$some, context);
    return rows.some(row => matchesAny(row, alternatives));
  }
  if (Object.hasOwn(value, '$if')) {
    const [condition, yes, no] = value.$if;
    return resolveInputs(resolveInputs(condition, context) ? yes : no, context);
  }
  if (Object.hasOwn(value, '$merge')) return Object.assign({}, ...resolveInputs(value.$merge, context));
  if (Object.hasOwn(value, '$ref')) {
    const found = at(context, value.$ref);
    if (found === undefined) throw new Error(`Unresolved input reference: ${value.$ref}`);
    return structuredClone(found);
  }
  if (Object.hasOwn(value, '$uuid')) {
    if (value.$uuid !== true) throw new Error('$uuid must be true');
    return randomUUID();
  }
  if (Object.hasOwn(value, '$now')) {
    if (!['iso', 'localDateTime'].includes(value.$now)) throw new Error('Unsupported time format');
    const now = new Date().toISOString();
    return value.$now === 'localDateTime' ? now.slice(0, -1) : now;
  }
  if (Object.hasOwn(value, '$length')) return resolveInputs(value.$length, context).length;
  if (Object.hasOwn(value, '$coalesce')) return resolveInputs(value.$coalesce, context).find(v => v !== undefined && v !== null) ?? null;
  if (Object.hasOwn(value, '$get')) {const [object, path] = resolveInputs(value.$get, context); return at(object, path);}
  if (Object.hasOwn(value, '$concat')) return resolveInputs(value.$concat, context).join('');
  if (Object.hasOwn(value, '$urlPath')) {
    const urls = resolveInputs(value.$urlPath, context);
    return Array.isArray(urls) ? urls.map(url => new URL(url).pathname) : new URL(urls).pathname;
  }
  if (Object.hasOwn(value, '$flatten')) return resolveInputs(value.$flatten, context).flat();
  if (Object.hasOwn(value, '$map')) {
    const {from, path} = value.$map;
    const items = resolveInputs(from, context);
    if (!Array.isArray(items)) throw new Error('$map requires an array');
    return items.map(v => at(v, path));
  }
  if (Object.hasOwn(value, '$select')) {
    const {from, where} = value.$select;
    const items = resolveInputs(from, context), expected = resolveInputs(where, context);
    if (!Array.isArray(items)) throw new Error('$select requires an array');
    return items.filter(v => Object.entries(expected).every(([k, x]) => isDeepStrictEqual(at(v, k), x)));
  }
  if (Object.hasOwn(value, '$at')) {
    const [items, index] = resolveInputs(value.$at, context);
    if (!Array.isArray(items) || !Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('$at index is out of bounds');
    return items[index];
  }
  if (Object.hasOwn(value, '$subtract')) {
    const [a, b] = resolveInputs(value.$subtract, context);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('$subtract requires numbers');
    return a - b;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveInputs(v, context)]));
}

export const operators = ['equals', 'exists', 'contains', 'notEquals', 'gte', 'gt', 'setEquals', 'unique'];
export function compare(actual, operator, expected) {
  if (operator === 'enumIn') {
    const key = s => String(s).replace(/[_\s-]/g, '').toUpperCase();
    return typeof actual === 'string' && expected.some(v => key(v) === key(actual));
  }
  if (operator === 'exists') return actual !== undefined && actual !== null;
  if (operator === 'equals') return isDeepStrictEqual(actual, expected);
  if (operator === 'notEquals') return actual !== undefined && !isDeepStrictEqual(actual, expected);
  if (operator === 'gte' || operator === 'gt') return typeof actual === 'number' && typeof expected === 'number' && (operator === 'gte' ? actual >= expected : actual > expected);
  if (operator === 'contains') return Array.isArray(actual) ? actual.some(v => isDeepStrictEqual(v, expected)) : typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
  if (operator === 'unique') return Array.isArray(actual) && new Set(actual.map(v => JSON.stringify(v))).size === actual.length;
  if (operator === 'setEquals') return Array.isArray(actual) && Array.isArray(expected) &&
    new Set(actual.map(v => JSON.stringify(v))).size === actual.length && new Set(expected.map(v => JSON.stringify(v))).size === expected.length && actual.length === expected.length && actual.every(v => expected.some(x => isDeepStrictEqual(v, x)));
  throw new Error(`Unsupported assertion operator: ${operator}`);
}

export function matchesAny(row, alternatives) {
  return alternatives.some(c => compare(at(row, c.path), c.operator, c.expected));
}
