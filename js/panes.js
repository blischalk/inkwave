import {
  splitMode, setSplitMode, activePane, setActivePane,
  secondaryTabId, setSecondaryTabId, primaryTabId, setPrimaryTabId,
  onShowWelcomeOrEmpty,
} from './state.js';
import { renderTabBar } from './tabs.js';

export function initPanes() {
  document.getElementById('pane-primary').addEventListener('mousedown', () => setActivePaneUI('primary'));
  document.getElementById('pane-secondary').addEventListener('mousedown', () => setActivePaneUI('secondary'));
}

function setActivePaneUI(pane) {
  setActivePane(pane);
  document.getElementById('pane-primary').classList.toggle('active-pane', pane === 'primary');
  document.getElementById('pane-secondary').classList.toggle('active-pane', pane === 'secondary');
}

export function applySplit(direction) {
  setSplitMode(direction);
  document.body.setAttribute('data-split', direction);
  document.getElementById('pane-secondary').hidden = false;
  document.getElementById('paneDivider').hidden = false;
  const splitVBtn = document.getElementById('splitVBtn');
  const splitHBtn = document.getElementById('splitHBtn');
  if (splitVBtn) splitVBtn.setAttribute('aria-pressed', direction === 'vertical' ? 'true' : 'false');
  if (splitHBtn) splitHBtn.setAttribute('aria-pressed', direction === 'horizontal' ? 'true' : 'false');
  setActivePaneUI('secondary');
  if (onShowWelcomeOrEmpty) onShowWelcomeOrEmpty();
  renderTabBar();
}

export function closeSplit() {
  if (secondaryTabId && secondaryTabId !== primaryTabId) setPrimaryTabId(secondaryTabId);
  setSecondaryTabId(null);
  setSplitMode('none');
  document.body.removeAttribute('data-split');
  document.getElementById('pane-secondary').hidden = true;
  document.getElementById('paneDivider').hidden = true;
  const splitVBtn = document.getElementById('splitVBtn');
  const splitHBtn = document.getElementById('splitHBtn');
  if (splitVBtn) splitVBtn.setAttribute('aria-pressed', 'false');
  if (splitHBtn) splitHBtn.setAttribute('aria-pressed', 'false');
  setActivePaneUI('primary');
  renderTabBar();
}

export function assignTabToActivePane(tabId) {
  if (activePane === 'secondary') setSecondaryTabId(tabId);
  else setPrimaryTabId(tabId);
}

export function getPaneForTab(tabId) {
  if (tabId === primaryTabId) return 'primary';
  if (tabId === secondaryTabId) return 'secondary';
  return null;
}
