import type { UpdateState } from '../../core/platform';
import { checkForUpdates, downloadUpdate, formatBytes, onUpdateState, openReleasePage, restartToUpdate, updaterAvailable } from '../../systems/update/updater';
import { h, setChildren, uiRoot } from '../dom';

/** A modal with the release notes for the version on offer. */
export function showReleaseNotes(s: UpdateState): void {
  const el = h(
    'div.overlay',
    h(
      'div.panel.window',
      { style: { position: 'relative' } },
      h('h2', `What's new in v${s.version ?? ''}`),
      h('div.scroll.release-notes', s.notes?.trim() || 'No release notes were published for this version.'),
      h('div.row', { style: { marginTop: '12px', justifyContent: 'flex-end' } }, h('button.primary', { onclick: () => el.remove() }, 'Close')),
    ),
  );
  el.addEventListener('mousedown', (e) => e.target === el && el.remove());
  uiRoot().append(el);
}

/** Download progress: a bar with percent, speed and size. */
export function progressBar(s: UpdateState): HTMLElement {
  const pct = Math.max(0, Math.min(100, s.percent ?? 0));
  return h(
    'div.update-progress',
    h('div.meter', h('div', { style: { width: `${pct}%`, background: 'var(--accent)' } })),
    h('div.dim', `${Math.round(pct)}% · ${formatBytes(s.bytesPerSecond)}/s · ${formatBytes(s.transferred)} of ${formatBytes(s.total)}`),
  );
}

/**
 * The controls for whatever state the updater is in. Shared by the main-menu notice
 * and the settings screen. Returns null when there is nothing worth showing.
 */
export function updateControls(s: UpdateState, opts: { compact: boolean }): HTMLElement | null {
  const changes = s.notes !== undefined && h('button', { onclick: () => showReleaseNotes(s) }, 'View changes');
  switch (s.status) {
    case 'available':
      return h(
        'div',
        h('div.update-title', `Update available: v${s.version}`),
        s.portable && h('div.dim', 'The portable version cannot update itself. Download the new one from the release page.'),
        h('div.row', changes, s.portable ? h('button.primary', { onclick: openReleasePage, tip: 'Opens the download page in your browser.' }, 'Open download page') : h('button.primary', { onclick: downloadUpdate }, 'Download')),
      );
    case 'downloading':
      return h('div', h('div.update-title', `Downloading v${s.version}`), progressBar(s), h('div.row', changes));
    case 'downloaded':
      return h(
        'div',
        h('div.update-title', `v${s.version} is ready to install`),
        h('div.dim', 'Restart now, or carry on and it installs when you quit.'),
        h('div.row', changes, h('button', { onclick: (e: Event) => ((e.currentTarget as HTMLElement).closest('.update-notice') as HTMLElement | null)?.classList.add('later'), tip: 'Keep playing. The update installs the next time you quit.' }, 'Later'), h('button.primary', { onclick: () => void restartToUpdate(), tip: 'Your game is saved first.' }, 'Restart to update')),
      );
    case 'error':
      return h('div', h('div.update-title.warn', 'Update problem'), h('div.dim', s.error ?? 'Something went wrong.'), h('div.row', h('button', { onclick: checkForUpdates }, 'Try again')));
    case 'checking':
      return opts.compact ? null : h('div.dim', 'Checking for updates…');
    case 'uptodate':
      return opts.compact ? null : h('div.dim', 'You have the latest version.');
    case 'disabled':
      return opts.compact ? null : h('div.dim', s.reason ?? 'Updates are not available in this build.');
    default:
      return null;
  }
}

/** The small box on the main menu. Invisible unless there is an update or a problem to report. */
export function UpdateNotice(): { el: HTMLElement; destroy(): void } {
  const el = h('div.panel.update-notice', { style: { display: 'none' } });
  if (!updaterAvailable()) return { el, destroy: () => undefined };
  let attached = false;
  const off = onUpdateState((s) => {
    // Once the menu screen that held this notice is gone, stop listening.
    if (el.isConnected) attached = true;
    else if (attached) return off();
    // Do not swap buttons out from under a click.
    if (el.querySelector(':active')) return;
    const body = updateControls(s, { compact: true });
    el.style.display = body ? 'block' : 'none';
    if (s.status !== 'downloaded') el.classList.remove('later');
    if (body) setChildren(el, body);
  });
  return { el, destroy: off };
}
