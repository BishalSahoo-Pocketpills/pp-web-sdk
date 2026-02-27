/**
 * Set a cookie in the jsdom document.
 */
export function setCookie(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.path) cookie += `; path=${options.path}`;
  if (options.expires) cookie += `; expires=${options.expires}`;
  document.cookie = cookie;
}

/**
 * Clear all cookies.
 */
export function clearAllCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
}
