(() => {
  'use strict';

  const dialog = document.getElementById('share-gate');
  const form = document.getElementById('share-unlock-form');
  const input = document.getElementById('share-passcode');
  const showPassword = document.getElementById('share-show-passcode');
  const count = document.getElementById('share-passcode-count');
  const status = document.getElementById('share-gate-status');
  const unlock = form.querySelector('button[type="submit"]');
  const expectedDigest = '25a4e682fb77d55c49a7ce3a7292de8b21a3fbad17dae8e1c632f18bc77f179d';
  const pendingScripts = [
    './data/catalog.js', './data/enrollment.js', './data/school-types.js', './data/emi.js',
    './student-site.js?v=2', './student-analytics.js', './share.js?v=3'
  ];

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('Could not load ' + path));
      };
      document.head.append(script);
    });
  }

  dialog.addEventListener('cancel', event => event.preventDefault());
  showPassword?.addEventListener('change', () => {
    input.type = showPassword.checked ? 'text' : 'password';
  });
  function updateCount() {
    if (count) count.textContent = '已輸入 ' + input.value.length + ' 個字元';
  }
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    status.textContent = '';
    updateCount();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlock.disabled || !input.value) return;
    unlock.disabled = true;
    input.readOnly = true;
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.value));
      const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== expectedDigest) {
        input.setAttribute('aria-invalid', 'true');
        status.textContent = '密碼不正確，請再試一次。';
        return;
      }

      status.textContent = '載入外生佔比資料中…';
      while (pendingScripts.length) {
        await loadScript(pendingScripts[0]);
        pendingScripts.shift();
      }
      form.reset();
      input.type = 'password';
      updateCount();
      document.getElementById('share-protected').hidden = false;
      dialog.close();
      document.getElementById('main').focus();
    } catch (error) {
      status.textContent = '暫時無法解鎖，請再試一次或重新整理。';
      console.error(error);
    } finally {
      unlock.disabled = false;
      input.readOnly = false;
      if (dialog.open) {
        input.focus();
        input.select();
      }
    }
  });

  dialog.showModal();
})();
