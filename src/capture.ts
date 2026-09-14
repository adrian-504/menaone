// Standalone entry for the quick-capture popup window (capture.html) — a
// second, small Tauri window shown/hidden by the global Cmd+Shift+I shortcut
// (src-tauri/src/lib.rs), deliberately not loading the full app bundle.
// Same-origin as the main window, so it shares localStorage (theme) and can
// call the same `add_inbox_item` Tauri command Inbox itself uses — no new
// backend needed.
//
// getCurrentWindow() (and everything downstream of it) needs a real Tauri
// window bridge and throws in the plain-browser dev-preview — gated behind
// the same __TAURI_INTERNALS__ check main.ts uses, so this file still loads
// cleanly (icon + input visible, just non-functional) when opened directly
// in a browser tab for a quick visual check.
import './styles.css';
import { renderIcons } from './core/chrome';

const input = document.getElementById('capture-input') as HTMLInputElement;
const bar = document.querySelector('.capture-bar') as HTMLElement;
const errorMsg = document.getElementById('capture-error-msg') as HTMLElement;

function showCaptureError(): void {
  bar.classList.add('capture-error');
  errorMsg.style.display = '';
}

function clearCaptureError(): void {
  bar.classList.remove('capture-error');
  errorMsg.style.display = 'none';
}

function applyTheme(): void {
  try {
    const t = localStorage.getItem('menabig.theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* ignore */
  }
}

renderIcons();
applyTheme();

if ((window as any).__TAURI_INTERNALS__?.invoke) {
  const [{ invoke }, { emit }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/window'),
  ]);
  const win = getCurrentWindow();

  const dismiss = (): void => {
    input.value = '';
    clearCaptureError();
    void win.hide();
  };

  const submit = async (): Promise<void> => {
    const content = input.value.trim();
    if (!content) { dismiss(); return; }
    try {
      await invoke('add_inbox_item', { itemType: 'idea', content });
      await emit('inbox-item-captured');
      dismiss();
    } catch (e) {
      console.error('Quick capture failed:', e);
      showCaptureError();
      // Keep the window open with the text intact so nothing typed is lost —
      // the previous behavior dismissed unconditionally, silently discarding
      // the capture on a failed save.
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
  });
  input.addEventListener('input', () => { if (errorMsg.style.display !== 'none') clearCaptureError(); });

  // Re-apply the current theme and refocus the field every time the window
  // is shown; hide again automatically when it loses focus (click-away
  // dismiss), matching a Spotlight-style capture bar.
  void win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      applyTheme();
      input.focus();
    } else {
      dismiss();
    }
  });
}
