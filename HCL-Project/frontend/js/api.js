const PRODUCTION_API_URL = 'https://hcl-project-89ks.onrender.com';
const DEFAULT_TIMEOUT_MS = 10000;
const STALE_API_HOSTS = new Set([
  'urban-real-estate.onrender.com',
]);

function normalizeBaseUrl(url) {
  const candidate = (url || PRODUCTION_API_URL).trim().replace(/\/+$/, '');

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || STALE_API_HOSTS.has(parsed.host)) {
      return PRODUCTION_API_URL;
    }
    return candidate;
  } catch (error) {
    return PRODUCTION_API_URL;
  }
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL);

function buildUrl(endpoint) {
  if (/^https:\/\//i.test(endpoint)) return endpoint;
  return `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

function getAuthToken() {
  return localStorage.getItem('urei_token');
}

export async function apiRequest(endpoint, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const token = getAuthToken();
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(buildUrl(endpoint), {
      ...options,
      headers,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || data.message || `Request failed with status ${response.status}`);
      error.data = data;
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The API request timed out. Please try again.');
    }
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the API. Please check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
