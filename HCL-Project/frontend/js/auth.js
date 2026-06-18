import { apiRequest } from './api.js';

function showFlash(message, type = 'danger') {
  const container = document.getElementById('auth-flash');
  if (!container) return;
  container.innerHTML = `<div class="auth-flash auth-flash-${type}">${message}</div>`;
}

function showFieldErrors(fields) {
  Object.entries(fields).forEach(([name, message]) => {
    const el = document.getElementById(`error-${name}`);
    if (el) el.textContent = message;
  });
}

function clearFieldErrors() {
  document.querySelectorAll('.auth-field-error').forEach(el => {
    el.textContent = '';
  });
}

async function submitAuth(endpoint, payload) {
  try {
    return await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error.data?.fields) showFieldErrors(error.data.fields);
    throw error;
  }
}

function saveSession(data) {
  if (data.token) localStorage.setItem('urei_token', data.token);
  if (data.user) localStorage.setItem('urei_user', JSON.stringify(data.user));
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const submitBtn = loginForm.querySelector('.auth-submit');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const data = await submitAuth('/api/auth/login', {
          username: loginForm.username.value.trim(),
          password: loginForm.password.value,
          remember_me: loginForm.remember_me?.checked || false,
        });
        saveSession(data);
        window.location.href = '/dashboard.html';
      } catch (err) {
        showFlash(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const submitBtn = registerForm.querySelector('.auth-submit');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';

      try {
        const data = await submitAuth('/api/auth/register', {
          username: registerForm.username.value.trim(),
          email: registerForm.email.value.trim(),
          password: registerForm.password.value,
          password2: registerForm.password2.value,
        });
        saveSession(data);
        window.location.href = '/dashboard.html';
      } catch (err) {
        showFlash(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }
});
