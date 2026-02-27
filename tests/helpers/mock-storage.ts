/**
 * Helpers for working with namespaced storage keys.
 */
export function setSessionItem(key, value, namespace = 'pp_attr') {
  sessionStorage.setItem(`${namespace}_${key}`, JSON.stringify(value));
}

export function setLocalItem(key, value, namespace = 'pp_attr') {
  localStorage.setItem(`${namespace}_${key}`, JSON.stringify(value));
}
