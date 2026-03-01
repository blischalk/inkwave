var DEBUG_ENTER = false; // set true to show debug log; or press Ctrl+Shift+D to toggle
var DEBUG_MAX_LINES = 100;
if (DEBUG_ENTER) document.body.setAttribute('data-debug', 'true');
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    var on = document.body.getAttribute('data-debug') === 'true';
    document.body.setAttribute('data-debug', on ? 'false' : 'true');
  }
});
function dbg() {
  if (!DEBUG_ENTER) return;
  var a = [];
  for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
  var msg = a.join(' ');
  console.log('[MD]', msg);
  var el = document.getElementById('debugPanel');
  if (el) {
    var line = document.createElement('div');
    line.className = 'debug-line';
    line.textContent = '[MD] ' + msg;
    el.appendChild(line);
    while (el.children.length > DEBUG_MAX_LINES + 1) el.removeChild(el.children[1]);
    el.scrollTop = el.scrollHeight;
  }
}
const contentEl = document.getElementById('content');
const filenameEl = document.getElementById('filename');
const treeEl = document.getElementById('tree');
var welcomeContent = null;

function highlightCodeInContainer(container) {
  if (!container || typeof hljs === 'undefined') return;
  container.querySelectorAll('pre code').forEach(function (block) {
    hljs.highlightElement(block);
  });
}

window.__applySettings = function (dataStr) {
  try {
    var settings = JSON.parse(dataStr);
    if (settings && settings.theme && themePicker.querySelector('option[value="' + settings.theme + '"]')) {
      applyTheme(settings.theme);
    }
  } catch (e) {}
};

window.__applyWelcome = function (dataStr) {
  try {
    var data = JSON.parse(dataStr);
    if (data && data.content != null) {
      welcomeContent = data.content;
      contentEl.className = 'content';
      contentEl.innerHTML = '<div class="rendered">' + marked.parse(data.content) + '</div>';
      highlightCodeInContainer(contentEl);
      filenameEl.textContent = 'Welcome';
    }
  } catch (e) {}
};
setTimeout(function () {
  if (contentEl.classList.contains('empty') && contentEl.textContent.indexOf('Loading') !== -1) {
    contentEl.className = 'content empty';
    contentEl.innerHTML = 'Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.';
  }
}, 4000);
const sidebar = document.getElementById('sidebar');
const openBtn = document.getElementById('openBtn');
const openMenu = document.getElementById('openMenu');
const newFileBtn = document.getElementById('newFileBtn');
const treeContextMenu = document.getElementById('treeContextMenu');
const newFileHereBtn = document.getElementById('newFileHereBtn');
const treeWrap = document.querySelector('.tree-wrap');
const deleteFileBtn = document.getElementById('deleteFileBtn');

function getApi() {
  return window.pywebview && window.pywebview.api;
}

let treeRoot = null;
let selectedPath = null;
const loadedChildren = new Map();
const tabBarEl = document.getElementById('tabBar');
let tabs = [];
let activeTabId = null;
var currentBlocks = [];
var currentTabRef = null;
var _replacingContent = false;

var folderIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
var fileIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function blockRaw(b) {
  var r = typeof b === 'string' ? b : (b && b.raw);
  return (typeof r === 'string' ? r : (r != null ? String(r) : ''));
}

function getBlocks(content) {
  if (!content || String(content).trim() === '') return [];
  try {
    if (typeof marked !== 'undefined' && typeof marked.lexer === 'function') {
      var tokens = marked.lexer(content);
      var out = [];
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (!t || t.type === 'space') continue;
        var raw = (t.raw != null) ? (typeof t.raw === 'string' ? t.raw : String(t.raw)) : '';
        if (t.type === 'list') {
          var lines = raw.split(/\r?\n/);
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (/^\s*([-*]\s|\d+\.\s)/.test(line) && line.trim() !== '') {
              out.push({ raw: line.replace(/^\s+/, ''), type: 'list' });
            }
          }
          continue;
        }
        out.push({ raw: raw, type: (t.type) || 'paragraph', depth: t.depth });
      }
      return out;
    }
  } catch (e) {}
  var parts = String(content).split(/\n\n+/);
  return parts.map(function(raw) { return { raw: raw, type: 'paragraph' }; });
}

function blocksToContent(blocks) {
  if (blocks.length === 0) return '';
  return blocks.map(function(b) { return blockRaw(b); }).join('\n\n');
}

function getInlineBlockType(text) {
  var line = (typeof text === 'string' ? text : '').split('\n')[0] || '';
  var t = line.trimStart();
  if (/^```/.test(t)) {
    return { type: 'code' };
  }
  if (/^#+\s/.test(t)) {
    var n = (t.match(/^#+/) || [''])[0].length;
    return { type: 'heading', depth: Math.min(n, 6) || 1 };
  }
  if (/^>\s/.test(t)) return { type: 'blockquote' };
  if (/^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) return { type: 'list' };
  return { type: 'paragraph' };
}

function getListPrefix(raw) {
  if (!raw || typeof raw !== 'string') return '- ';
  var m = raw.match(/^([-*]\s|\d+\.\s)/);
  return m ? m[1] : '- ';
}

function stripListMarker(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/^([-*]\s|\d+\.\s)/, '');
}

function isOrderedListPrefix(prefix) {
  return prefix && /^\d+\.\s$/.test(prefix);
}

function getListItemDisplayHtml(raw) {
  if (!raw || typeof raw !== 'string') return '';
  var parsed = marked.parse(raw);
  var div = document.createElement('div');
  div.innerHTML = parsed;
  var li = div.querySelector('ul li, ol li');
  return li ? li.innerHTML : escapeHtml(stripListMarker(raw));
}

function applyBlockTypeFromText(blockEl, text) {
  if (!blockEl || !blockEl.classList) return;
  var info = getInlineBlockType(text);
  blockEl.classList.remove('md-block-paragraph', 'md-block-heading-1', 'md-block-heading-2', 'md-block-heading-3', 'md-block-heading-4', 'md-block-heading-5', 'md-block-heading-6', 'md-block-blockquote', 'md-block-list', 'md-block-code');
  blockEl.classList.add('md-block-' + info.type);
  if (info.type === 'heading' && info.depth) {
    blockEl.classList.add('md-block-heading-' + info.depth);
  }
}

function getTabTitle(path) {
  if (!path) return 'Welcome';
  if (path.toLowerCase().endsWith('welcome.md')) return 'Welcome';
  return path.replace(/^.*[/\\]/, '');
}

function addTab(options) {
  var path = options.path || null;
  var title = options.title != null ? options.title : getTabTitle(path);
  var content = options.content;
  var id = path || 'welcome';
  var existing = tabs.filter(function (t) { return t.id === id; })[0];
  if (existing) {
    if (content != null) existing.content = content;
    selectTab(id);
    return;
  }
  tabs.push({ id: id, path: path, title: title, content: content });
  activeTabId = id;
  renderTabBar();
  showTabContent(tabs[tabs.length - 1]);
}

function closeTab(id, e) {
  if (e) e.stopPropagation();
  var idx = tabs.findIndex(function (t) { return t.id === id; });
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (activeTabId === id) {
    if (tabs.length > 0) {
      var next = tabs[Math.min(idx, tabs.length - 1)];
      activeTabId = next.id;
      showTabContent(next);
    } else {
      activeTabId = null;
      showWelcomeOrEmpty();
    }
  }
  renderTabBar();
}

function selectTab(id) {
  activeTabId = id;
  var tab = tabs.filter(function (t) { return t.id === id; })[0];
  if (tab) showTabContent(tab);
  renderTabBar();
}

function moveTab(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tabs.length || toIndex >= tabs.length) return;
  var t = tabs.splice(fromIndex, 1)[0];
  tabs.splice(toIndex, 0, t);
  renderTabBar();
}

function renderTabBar() {
  tabBarEl.innerHTML = '';
  if (tabs.length === 0) {
    tabBarEl.classList.add('hidden');
    return;
  }
  tabBarEl.classList.remove('hidden');
  tabs.forEach(function (tab, index) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    btn.setAttribute('data-tab-id', tab.id);
    btn.setAttribute('data-tab-index', index);
    btn.setAttribute('draggable', 'true');
    btn.innerHTML = '<span class="tab-title">' + escapeHtml(tab.title) + '</span><span class="tab-close" title="Close">×</span>';
    btn.addEventListener('click', function (e) {
      if (e.target.classList.contains('tab-close')) return;
      selectTab(tab.id);
    });
    btn.querySelector('.tab-close').addEventListener('click', function (e) {
      e.stopPropagation();
      closeTab(tab.id, e);
    });
    btn.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', tab.id);
      e.dataTransfer.effectAllowed = 'move';
      e.target.classList.add('dragging');
    });
    btn.addEventListener('dragend', function (e) {
      e.target.classList.remove('dragging');
      tabBarEl.querySelectorAll('.tab.drop-target').forEach(function (el) { el.classList.remove('drop-target'); });
    });
    btn.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var overId = e.currentTarget.getAttribute('data-tab-id');
      if (e.dataTransfer.getData('text/plain') === overId) return;
      e.currentTarget.classList.add('drop-target');
    });
    btn.addEventListener('dragleave', function (e) {
      e.currentTarget.classList.remove('drop-target');
    });
    btn.addEventListener('drop', function (e) {
      e.preventDefault();
      e.currentTarget.classList.remove('drop-target');
      var draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === tab.id) return;
      var fromIdx = tabs.findIndex(function (t) { return t.id === draggedId; });
      var toIdx = tabs.findIndex(function (t) { return t.id === tab.id; });
      if (fromIdx !== -1 && toIdx !== -1) moveTab(fromIdx, toIdx);
    });
    tabBarEl.appendChild(btn);
  });
}

function getActiveTab() {
  return tabs.filter(function (t) { return t.id === activeTabId; })[0] || null;
}

function saveToFile(tab) {
  if (!tab || !tab.path) return;
  var a = getApi();
  if (!a || typeof a.write_file !== 'function') {
    showError('Save not available. Run from Markdown Reader.');
    return;
  }
  a.write_file(tab.path, tab.content).then(function (res) {
    if (res && res.error) {
      showError(res.error);
      return;
    }
  }).catch(function (err) {
    showError(err && (err.message || err) || 'Save failed.');
  });
}

function flushActiveEditAndSave() {
  var tab = currentTabRef;
  if (!tab || !tab.path) return;
  var editingBlock = contentEl.querySelector('.md-block.editing');
  if (editingBlock) {
    var editable = editingBlock.querySelector('.inline-edit');
    if (editable && currentBlocks.length) {
      var idx = parseInt(editingBlock.getAttribute('data-block-index'), 10);
      if (!isNaN(idx) && idx >= 0 && idx < currentBlocks.length) {
        var text = (editable.innerText != null ? editable.innerText : editable.textContent || '').replace(/\u00a0/g, ' ');
        var raw = currentBlocks[idx].raw;
        var prefix = '';
        if (editingBlock.classList.contains('md-block-list') && raw) {
          var m = raw.match(/^(\s*[-*+]|\s*\d+\.)\s*/);
          if (m) prefix = m[1];
        }
        currentBlocks[idx].raw = prefix + text;
        tab.content = blocksToContent(currentBlocks);
      }
    }
  }
  saveToFile(tab);
}

function getTextLength(node) {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').length;
  var len = 0;
  for (var i = 0; i < node.childNodes.length; i++) len += getTextLength(node.childNodes[i]);
  return len;
}

function getCharacterOffset(container, node, nodeOffset) {
  var offset = 0;
  function walk(n) {
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) {
        offset += nodeOffset;
      } else {
        for (var i = 0; i < nodeOffset && i < n.childNodes.length; i++) {
          offset += getTextLength(n.childNodes[i]);
        }
      }
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offset += n.textContent.length;
      return false;
    }
    for (var i = 0; i < n.childNodes.length; i++) {
      if (walk(n.childNodes[i])) return true;
    }
    return false;
  }
  walk(container);
  return offset;
}

function renderedOffsetToSourceOffset(source, renderedText, offsetInRendered, blockType) {
  var safeOffset = Math.max(0, Math.min(offsetInRendered, renderedText.length));
  if (blockType === 'heading') {
    var m = source.match(/^#+\s*/);
    var prefixLen = m ? m[0].length : 0;
    return prefixLen + safeOffset;
  }
  if (blockType === 'blockquote') {
    var firstLine = source.split('\n')[0] || '';
    var q = firstLine.match(/^>\s*/);
    var prefixLen = q ? q[0].length : 0;
    return Math.min(prefixLen + safeOffset, source.length);
  }
  return safeOffset;
}

function getCaretOffset(editable) {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  var range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return 0;
  return getCharacterOffset(editable, range.startContainer, range.startOffset);
}

function setCaretPosition(editable, position) {
  editable.focus();
  if (!editable.firstChild) return;
  var totalLen = getTextLength(editable);
  var offset = Math.max(0, Math.min(position, totalLen));
  var sel = window.getSelection();
  var range = document.createRange();
  var found = false;
  function walk(n, remaining) {
    if (n.nodeType === Node.TEXT_NODE) {
      var len = (n.textContent || '').length;
      if (remaining <= len) {
        range.setStart(n, remaining);
        range.collapse(true);
        found = true;
        return true;
      }
      return remaining - len;
    }
    for (var i = 0; i < n.childNodes.length; i++) {
      var r = walk(n.childNodes[i], remaining);
      if (r === true) return true;
      remaining = r;
    }
    return remaining;
  }
  walk(editable, offset);
  if (found) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function startInlineEdit(blockEl, index, blocks, tab, clickEvent) {
  if (blockEl.classList.contains('editing')) return;
  var raw = blockRaw(blocks[index]);
  var blockType = (blocks[index].type || 'paragraph');
  dbg('startInlineEdit: index=', index, 'raw=' + JSON.stringify(raw), 'blockType=', blockType);
  var explicitOffset = (arguments.length > 5 && typeof arguments[5] === 'number') ? arguments[5] : null;

  var isListItemInPlace = blockEl.tagName === 'LI' && blockEl.parentNode && blockEl.parentNode.classList && blockEl.parentNode.classList.contains('md-list-container');
  if (isListItemInPlace) {
    var listPrefix = getListPrefix(raw);
    var stripped = stripListMarker(raw);
    var offsetInRenderedLi = 0;
    if (clickEvent) {
      var range = null;
      if (typeof document.caretRangeFromPoint === 'function') {
        range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
      } else if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
        if (pos) range = { startContainer: pos.offsetNode, startOffset: pos.offset };
      }
      if (range && blockEl.contains(range.startContainer)) {
        offsetInRenderedLi = getCharacterOffset(blockEl, range.startContainer, range.startOffset);
      }
    }
    var cursorAtEndLi = arguments[5] === true;
    blockEl.classList.add('editing');
    blockEl.contentEditable = 'true';
    blockEl.textContent = stripped;
    if (!blockEl.firstChild) blockEl.appendChild(document.createTextNode(''));
    var offsetInLi = cursorAtEndLi ? stripped.length : Math.min(offsetInRenderedLi, stripped.length);

    function getEditableText() {
      return (blockEl.innerText != null ? blockEl.innerText : blockEl.textContent || '').replace(/\u00a0/g, ' ');
    }
    function getFullRaw() { return listPrefix + getEditableText(); }
    function syncContentAndAutosave() {
      blocks[index].raw = getFullRaw();
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      saveToFile(tab);
    }
    function commit() {
      if (_replacingContent || !blocks[index]) return;
      blocks[index].raw = getFullRaw();
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      currentBlocks = blocks;
      saveToFile(tab);
      if (!_replacingContent) showTabContent(tab);
    }

    blockEl.addEventListener('input', syncContentAndAutosave);
    blockEl.addEventListener('blur', function onBlur() {
      blockEl.removeEventListener('blur', onBlur);
      blockEl.removeEventListener('input', syncContentAndAutosave);
      blockEl.contentEditable = 'false';
      blockEl.classList.remove('editing');
      commit();
    });
    blockEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); blockEl.blur(); return; }
      if (e.key === 'Backspace' && index > 0 && getEditableText().trim() === '') {
        e.preventDefault();
        blocks.splice(index, 1);
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        currentBlocks = blocks;
        saveToFile(tab);
        showTabContent(tab);
        setTimeout(function () {
          var prev = contentEl.querySelector('.md-block[data-block-index="' + (index - 1) + '"]');
          if (prev) startInlineEdit(prev, index - 1, currentBlocks, tab, null, true);
        }, 0);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertLineBreak', false, null);
        syncContentAndAutosave();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        var text = getEditableText();
        var offset = Math.max(0, Math.min(getCaretOffset(blockEl), text.length));
        var beforeCursor = text.slice(0, offset);
        var afterCursor = text.slice(offset);
        var isLastBlock = (index === blocks.length - 1);
        var isEmptyItem = text.trim() === '' || stripListMarker(blocks[index].raw || '').trim() === '';
        if (isLastBlock && isEmptyItem) {
          blocks.splice(index, 1);
          blocks.push({ raw: '', type: 'paragraph' });
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          currentBlocks = blocks;
          saveToFile(tab);
          var focusIndex = blocks.length - 1;
          showTabContent(tab, blocks);
          requestAnimationFrame(function () {
            setTimeout(function () {
              var nextEl = contentEl.querySelector('.md-block[data-block-index="' + focusIndex + '"]');
              if (nextEl) {
                startInlineEdit(nextEl, focusIndex, currentBlocks, tab, null, true);
                var edit = nextEl.tagName === 'LI' ? nextEl : nextEl.querySelector('.inline-edit');
                if (edit) {
                  edit.focus();
                  setCaretPosition(edit, 0);
                }
              }
            }, 0);
          });
          return;
        }
        if (isEmptyItem) {
          blocks.splice(index, 1);
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          currentBlocks = blocks;
          saveToFile(tab);
          showTabContent(tab, blocks);
          setTimeout(function () {
            var nextEl = contentEl.querySelector('.md-block[data-block-index="' + index + '"]');
            if (nextEl) {
              startInlineEdit(nextEl, index, currentBlocks, tab, null, false);
              var edit = nextEl.tagName === 'LI' ? nextEl : nextEl.querySelector('.inline-edit');
              if (edit) { edit.focus(); setCaretPosition(edit, 0); }
            }
          }, 10);
          return;
        }
        blocks[index].raw = listPrefix + beforeCursor;
        blocks.splice(index + 1, 0, { raw: listPrefix + afterCursor, type: 'list' });
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        currentBlocks = blocks;
        saveToFile(tab);
        requestAnimationFrame(function () {
          showTabContent(tab, blocks);
          setTimeout(function () {
            var newLi = contentEl.querySelector('.md-block[data-block-index="' + (index + 1) + '"]');
            if (newLi) {
              startInlineEdit(newLi, index + 1, currentBlocks, tab, null);
              newLi.focus();
              setCaretPosition(newLi, 0);
              setTimeout(function () { if (document.activeElement !== newLi) { newLi.focus(); setCaretPosition(newLi, 0); } }, 0);
            }
          }, 0);
        });
        return;
      }
    });

    blockEl.focus();
    setTimeout(function () { setCaretPosition(blockEl, offsetInLi); }, 0);
    return;
  }

  var renderedText = blockEl.textContent || '';
  var offsetInRendered = 0;
  if (clickEvent) {
    var range = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      range = document.caretRangeFromPoint(clickEvent.clientX, clickEvent.clientY);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(clickEvent.clientX, clickEvent.clientY);
      if (pos) {
        range = { startContainer: pos.offsetNode, startOffset: pos.offset };
      }
    }
    if (range && blockEl.contains(range.startContainer)) {
      offsetInRendered = getCharacterOffset(blockEl, range.startContainer, range.startOffset);
    }
  }
  var sourceOffset = renderedOffsetToSourceOffset(raw, renderedText, offsetInRendered, blockType);
  var cursorAtEnd = arguments[5] === true;
  if (cursorAtEnd) {
    sourceOffset = blockType === 'list' ? stripListMarker(raw).length : (raw ? raw.length : 0);
  }

  blockEl.classList.add('editing');
  var isCodeBlock = blockType === 'code';
  if (!isCodeBlock) {
    var placeholder = document.createElement('div');
    placeholder.className = 'md-block-placeholder';
    while (blockEl.firstChild) placeholder.appendChild(blockEl.firstChild);
    blockEl.appendChild(placeholder);
  } else {
    blockEl.innerHTML = '';
  }
  var listPrefix = blockType === 'list' ? getListPrefix(raw) : null;
  var editable = document.createElement('div');
  editable.className = 'inline-edit';
  editable.contentEditable = 'true';
  if (isCodeBlock) {
    editable.setAttribute('autocapitalize', 'none');
    editable.setAttribute('autocorrect', 'off');
    editable.setAttribute('autocomplete', 'off');
    editable.setAttribute('spellcheck', 'false');
  }
  editable.textContent = blockType === 'list' ? stripListMarker(raw) : raw;
  if (!editable.firstChild) editable.appendChild(document.createTextNode(''));
  blockEl.appendChild(editable);

  function getEditableText() {
    return (editable.innerText != null ? editable.innerText : editable.textContent || '').replace(/\u00a0/g, ' ');
  }
  function getFullRaw() {
    return listPrefix != null ? listPrefix + getEditableText() : getEditableText();
  }
  function syncBlockType() {
    var full = getFullRaw();
    var info = getInlineBlockType(full);
    if (info.type === 'list' && listPrefix == null) {
      listPrefix = getListPrefix(full);
      var stripped = stripListMarker(full);
      if ((editable.textContent || '') !== stripped) {
        editable.textContent = stripped || '';
        if (!editable.firstChild) editable.appendChild(document.createTextNode(''));
      }
    }
    applyBlockTypeFromText(blockEl, full);
    blocks[index].type = info.type;
    if (info.depth) blocks[index].depth = info.depth;
  }
  function syncContentAndAutosave() {
    blocks[index].raw = getFullRaw();
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    saveToFile(tab);
  }
  syncBlockType();
  editable.addEventListener('input', function () {
    syncBlockType();
    syncContentAndAutosave();
  });

  var isEmptyBlock = !raw || String(raw).trim() === '';
  var initialOffset = explicitOffset != null ? explicitOffset : sourceOffset;
  if (isEmptyBlock) {
    dbg('startInlineEdit: empty block, focus now');
    setCaretPosition(editable, initialOffset);
  } else {
    setTimeout(function () {
      setCaretPosition(editable, initialOffset);
    }, 0);
  }

  function commit() {
    if (_replacingContent || !blocks[index]) return;
    var newRaw = getFullRaw();
    var info = getInlineBlockType(newRaw);
    blocks[index].raw = newRaw;
    blocks[index].type = info.type;
    if (info.depth) blocks[index].depth = info.depth;
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    currentBlocks = blocks;
    saveToFile(tab);
    if (!_replacingContent) showTabContent(tab);
  }

  editable.addEventListener('blur', function onBlur() {
    editable.removeEventListener('blur', onBlur);
    commit();
  });
  editable.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      editable.blur();
    }
    if (e.key === 'Tab' && blockEl.classList.contains('md-block-code')) {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
      syncContentAndAutosave();
      return;
    }
    if (e.key === 'Backspace' && index > 0 && getEditableText().trim() === '') {
      e.preventDefault();
      blocks.splice(index, 1);
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      currentBlocks = blocks;
      saveToFile(tab);
      showTabContent(tab);
      setTimeout(function () {
        var prevBlockEl = contentEl.querySelector('.md-block[data-block-index="' + (index - 1) + '"]');
        if (prevBlockEl) startInlineEdit(prevBlockEl, index - 1, currentBlocks, tab, null, true);
      }, 0);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak', false, null);
      syncContentAndAutosave();
      return;
    }
    if (e.key === 'Enter') {
      var text = getEditableText();
      var offset = Math.max(0, Math.min(getCaretOffset(editable), text.length));

      if (blockEl.classList.contains('md-block-code')) {
        var firstLine = text.split('\n')[0] || '';
        var openFenceMatch = firstLine.match(/^```(\w+)?$/);
        var onlyFenceLine = text.trim() === firstLine.trim() && offset === text.length;
        // Content is just opening fence (e.g. ``` or ```python) and cursor at end → complete block and focus inside.
        if (openFenceMatch && onlyFenceLine) {
          e.preventDefault();
          e.stopPropagation();
          var lang = openFenceMatch[1] || '';
          var fence = '```' + lang;
          var rawCodeBlock = fence + '\n\n```';
          blocks[index].raw = rawCodeBlock;
          blocks[index].type = 'code';
          delete blocks[index].depth;
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          currentBlocks = blocks;
          saveToFile(tab);
          requestAnimationFrame(function () {
            showTabContent(tab, currentBlocks);
            setTimeout(function () {
              var codeBlockEl = contentEl.querySelector('.md-block[data-block-index="' + index + '"]');
              if (!codeBlockEl) return;
              startInlineEdit(codeBlockEl, index, currentBlocks, tab, null, fence.length + 1);
            }, 0);
          });
          return;
        }
        // If caret is at or after the end of the closing fence line, exit block and start new paragraph below.
        var lastLineStart = text.lastIndexOf('\n') + 1;
        var lastLine = text.slice(lastLineStart);
        var atEndOfLastLine = offset >= lastLineStart + lastLine.length;
        if (/```[ \t]*$/.test(lastLine) && atEndOfLastLine) {
          e.preventDefault();
          e.stopPropagation();
          blocks[index].raw = text;
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          currentBlocks = blocks;
          saveToFile(tab);
          var newBlock = { raw: '', type: 'paragraph' };
          blocks.splice(index + 1, 0, newBlock);
          tab.content = blocksToContent(blocks);
          currentTabRef.content = tab.content;
          currentBlocks = blocks;
          saveToFile(tab);
          requestAnimationFrame(function () {
            showTabContent(tab, currentBlocks);
            setTimeout(function () {
              var newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + (index + 1) + '"]');
              if (!newBlockEl) return;
              startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            }, 0);
          });
          return;
        }
        // Otherwise let Enter behave as a normal newline inside the code block.
        return;
      }

      // Detect ``` or ```lang on an otherwise empty block (still a paragraph) and turn it into a fenced code block.
      var beforeCursor = text.slice(0, offset);
      var afterCursor = text.slice(offset);
      var lineStart = beforeCursor.lastIndexOf('\n') + 1;
      var currentLine = beforeCursor.slice(lineStart);
      var fenceMatch = currentLine.match(/^```(\w+)?$/);
      var hasOnlyFenceBefore =
        text.slice(0, lineStart).trim() === '' && afterCursor.trim() === '';
      if (fenceMatch && hasOnlyFenceBefore) {
        e.preventDefault();
        e.stopPropagation();
        var lang = fenceMatch[1] || '';
        var fence = '```' + lang;
        var rawCodeBlock = fence + '\n\n```';
        blocks[index].raw = rawCodeBlock;
        blocks[index].type = 'code';
        delete blocks[index].depth;
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        currentBlocks = blocks;
        saveToFile(tab);
        requestAnimationFrame(function () {
          showTabContent(tab, currentBlocks);
          setTimeout(function () {
            var codeBlockEl = contentEl.querySelector('.md-block[data-block-index="' + index + '"]');
            if (!codeBlockEl) return;
            // Place caret on the empty line between opening and closing fences.
            startInlineEdit(codeBlockEl, index, currentBlocks, tab, null, fence.length + 1);
          }, 0);
        });
        return;
      }
    }
    if (e.key === 'Enter' && !blockEl.classList.contains('md-block-code')) {
      dbg('editable keydown Enter: index=', index);
      e.preventDefault();
      syncBlockType();
      var text2 = getEditableText();
      var offset2 = Math.max(0, Math.min(getCaretOffset(editable), text2.length));
      var beforeCursor2 = text2.slice(0, offset2);
      var afterCursor2 = text2.slice(offset2);
      var isList = blockEl.classList.contains('md-block-list');
      var prefix = isList ? (listPrefix != null ? listPrefix : getListPrefix(blocks[index].raw)) : null;
      if (isList && prefix && text2.trim() === '') {
        blocks.splice(index, 1);
        tab.content = blocksToContent(blocks);
        currentTabRef.content = tab.content;
        currentBlocks = blocks;
        saveToFile(tab);
        showTabContent(tab);
        setTimeout(function () {
          var nextEl = contentEl.querySelector('.md-block[data-block-index="' + index + '"]');
          if (nextEl) startInlineEdit(nextEl, index, currentBlocks, tab, null);
        }, 10);
        return;
      }
      if (prefix) {
        blocks[index].raw = prefix + beforeCursor2;
        var newBlock = { raw: prefix + afterCursor2, type: 'list' };
        blocks.splice(index + 1, 0, newBlock);
      } else {
        blocks[index].raw = typeof beforeCursor2 === 'string' ? beforeCursor2 : String(beforeCursor2 || '');
        var newBlock = { raw: typeof afterCursor2 === 'string' ? afterCursor2 : String(afterCursor2 || ''), type: 'paragraph' };
        blocks.splice(index + 1, 0, newBlock);
      }
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      currentBlocks = blocks;
      saveToFile(tab);
      requestAnimationFrame(function () {
        showTabContent(tab, blocks);
        setTimeout(function () {
          var newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + (index + 1) + '"]');
          if (newBlockEl) {
            startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            var edit2 = newBlockEl.querySelector('.inline-edit');
            if (edit2) {
              edit2.focus();
              setCaretPosition(edit2, 0);
              setTimeout(function () {
                if (document.activeElement !== edit2) {
                  edit2.focus();
                  setCaretPosition(edit2, 0);
                }
              }, 0);
            }
          }
        }, 0);
      });
    }
  });
}

function showTabContent(tab, preferredBlocks) {
  if (!tab) return;
  _replacingContent = true;
  try {
    if (tab.content == null && !tab.path) {
      contentEl.className = 'content';
      contentEl.innerHTML = '<div class="rendered"><div class="error">Content not loaded.</div></div>';
      filenameEl.textContent = tab.path ? getTabTitle(tab.path) : tab.title;
      return;
    }
    if (!tab.path) {
      contentEl.className = 'content';
      contentEl.innerHTML = '<div class="rendered">' + marked.parse(tab.content || '') + '</div>';
      highlightCodeInContainer(contentEl);
      filenameEl.textContent = tab.title;
      return;
    }
    var blocks;
    if (preferredBlocks && preferredBlocks.length >= 0) {
      blocks = preferredBlocks;
      tab.content = blocksToContent(blocks);
      dbg('showTabContent: using preferredBlocks length=', blocks.length);
    } else {
      var contentStr = (tab.content != null && tab.content !== undefined) ? String(tab.content) : '';
      if (currentTabRef === tab && currentBlocks.length > 0 && blocksToContent(currentBlocks) === contentStr) {
        blocks = currentBlocks;
      } else {
        blocks = getBlocks(contentStr);
      }
    }
    currentBlocks = blocks;
    currentTabRef = tab;
    if (blocks.length === 0) {
      contentEl.className = 'content read-mode';
      contentEl.innerHTML = '<div class="rendered"><div class="md-block md-block-empty md-block-paragraph" data-block-index="0">' + marked.parse('\n') + '</div></div>';
      highlightCodeInContainer(contentEl);
      currentBlocks = [{ raw: '', type: 'paragraph' }];
    } else {
      var html = '<div class="rendered">';
      var i = 0;
      while (i < blocks.length) {
        var b = blocks[i];
        var raw = blockRaw(b);
        var type = typeof b === 'string' ? 'paragraph' : (b.type || 'paragraph');
        if (type === 'list') {
          var prefix = getListPrefix(raw);
          var listTag = isOrderedListPrefix(prefix) ? 'ol' : 'ul';
          var listHtml = '<' + listTag + ' class="md-list-container">';
          while (i < blocks.length) {
            var lb = blocks[i];
            var lraw = blockRaw(lb);
            var ltype = typeof lb === 'string' ? 'paragraph' : (lb.type || 'paragraph');
            if (ltype !== 'list') break;
            var lprefix = getListPrefix(lraw);
            if (isOrderedListPrefix(lprefix) !== isOrderedListPrefix(prefix)) break;
            listHtml += '<li class="md-block md-block-list" data-block-index="' + i + '">' + getListItemDisplayHtml(lraw) + '</li>';
            i++;
          }
          listHtml += '</' + listTag + '>';
          html += listHtml;
          continue;
        }
        var depth = typeof b === 'object' && b.depth;
        var typeClass = 'md-block-' + escapeHtml(type) + (type === 'heading' && depth ? ' md-block-heading-' + depth : '');
        html += '<div class="md-block ' + typeClass + '" data-block-index="' + i + '">' + marked.parse(raw) + '</div>';
        i++;
      }
      html += '</div>';
      contentEl.className = 'content read-mode';
      contentEl.innerHTML = html;
      highlightCodeInContainer(contentEl);
    }
    filenameEl.textContent = getTabTitle(tab.path);

    contentEl.querySelectorAll('.md-block').forEach(function (blockEl) {
      blockEl.addEventListener('click', function (e) {
        if (e.target.classList && e.target.classList.contains('inline-edit')) return;
        var idx = parseInt(blockEl.getAttribute('data-block-index'), 10);
        if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
        startInlineEdit(blockEl, idx, currentBlocks, tab, e);
      });
    });
    // Ensure clicks anywhere inside a code block's <pre>/<code> trigger editing,
    // since webkit may not bubble clicks from scrollable <pre> elements reliably.
    contentEl.querySelectorAll('.md-block-code').forEach(function (codeBlockEl) {
      var pre = codeBlockEl.querySelector('pre');
      if (!pre) return;
      pre.addEventListener('click', function (e) {
        if (codeBlockEl.classList.contains('editing')) return;
        var idx = parseInt(codeBlockEl.getAttribute('data-block-index'), 10);
        if (isNaN(idx) || idx < 0 || idx >= currentBlocks.length) return;
        startInlineEdit(codeBlockEl, idx, currentBlocks, tab, e);
      });
    });
    // Click anywhere in content area (including padding/empty space) but not on a block → new paragraph
    contentEl.onclick = function (e) {
      if (e.target.closest('.md-block')) return;
      if (!currentTabRef || !currentBlocks) return;
      if (!contentEl.querySelector('.rendered')) return;
      var blocks = currentBlocks.slice();
      var newIndex = blocks.length;
      blocks.push({ raw: '', type: 'paragraph' });
      tab.content = blocksToContent(blocks);
      currentTabRef.content = tab.content;
      currentBlocks = blocks;
      saveToFile(tab);
      requestAnimationFrame(function () {
        showTabContent(tab, currentBlocks);
        setTimeout(function () {
          var newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + newIndex + '"]');
          if (!newBlockEl) return;
          startInlineEdit(newBlockEl, newIndex, currentBlocks, tab, null);
        }, 0);
      });
    };
    var isEmptyFile = currentBlocks.length === 1 && (currentBlocks[0].raw === '' || !currentBlocks[0].raw);
    if (isEmptyFile) {
      var firstBlock = contentEl.querySelector('.md-block[data-block-index="0"]');
      if (firstBlock) {
        setTimeout(function () { startInlineEdit(firstBlock, 0, currentBlocks, tab, null); }, 0);
      }
    }
  } finally {
    _replacingContent = false;
  }
}

function showWelcomeOrEmpty() {
  if (welcomeContent) {
    contentEl.className = 'content';
    contentEl.innerHTML = '<div class="rendered">' + marked.parse(welcomeContent) + '</div>';
    highlightCodeInContainer(contentEl);
    filenameEl.textContent = 'Welcome';
  } else {
    contentEl.className = 'content empty';
    contentEl.innerHTML = 'Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.';
    filenameEl.textContent = '';
  }
}

function render(data) {
  if (!data) return;
  if (data.error) {
    contentEl.className = 'content';
    contentEl.innerHTML = '<div class="rendered"><div class="error">Error: ' + escapeHtml(data.error) + '</div></div>';
    filenameEl.textContent = data.path || '';
    return;
  }
  if (data.content == null) return;
  filenameEl.textContent = (data.path && data.path.toLowerCase().endsWith('welcome.md')) ? 'Welcome' : (data.path || '');
  contentEl.className = 'content';
  contentEl.innerHTML = '<div class="rendered">' + marked.parse(data.content) + '</div>';
  highlightCodeInContainer(contentEl);
}

function setTreeRoot(rootPath, initialFilePath) {
  treeRoot = rootPath;
  if (newFileBtn) newFileBtn.disabled = !rootPath;
  loadedChildren.clear();
  treeEl.innerHTML = '';
  if (!rootPath) return;
  const rootName = rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath;
  const rootLi = document.createElement('li');
  rootLi.className = 'tree-item folder';
  rootLi.dataset.path = rootPath;
  rootLi.dataset.isDir = '1';
  rootLi.innerHTML = '<div class="tree-item-row"><span class="expand">▶</span><span class="icon">' + folderIcon + '</span><span class="name">' + escapeHtml(rootName) + '</span></div>';
  rootLi.classList.add('expanded');
  treeEl.appendChild(rootLi);
  rootLi.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleFolder(rootLi);
  });
  loadChildren(rootPath, rootLi);
  if (initialFilePath) {
    selectFile(initialFilePath);
  }
}

function loadChildren(dirPath, parentLi) {
  if (loadedChildren.has(dirPath)) return;
  loadedChildren.set(dirPath, []);
  var a = getApi();
  if (!a) return;
  a.list_dir(dirPath).then(function (res) {
    const entries = res.entries || [];
    loadedChildren.set(dirPath, entries);
    renderTreeChildren(parentLi, entries);
  }).catch(function () {});
}

function renderTreeChildren(parentLi, entries) {
  let ul = parentLi.querySelector('ul');
  if (!ul) {
    ul = document.createElement('ul');
    parentLi.appendChild(ul);
  }
  ul.innerHTML = '';
  entries.forEach(function (entry) {
    const li = document.createElement('li');
    li.className = 'tree-item ' + (entry.isDir ? 'folder' : 'file');
    li.dataset.path = entry.path;
    li.dataset.isDir = entry.isDir ? '1' : '0';
    const expandCls = entry.isDir ? 'expand' : 'expand empty';
    const icon = entry.isDir ? folderIcon : fileIcon;
    li.innerHTML = '<div class="tree-item-row"><span class="' + expandCls + '">' + (entry.isDir ? '▶' : '') + '</span><span class="icon">' + icon + '</span><span class="name">' + escapeHtml(entry.name) + '</span></div>';
    ul.appendChild(li);
    li.addEventListener('click', function (e) {
      e.stopPropagation();
      if (entry.isDir) toggleFolder(li);
      else openFile(entry.path);
    });
  });
}

function toggleFolder(li) {
  const path = li.dataset.path;
  const isDir = li.dataset.isDir === '1';
  if (!path || !isDir) return;
  const expanded = li.classList.toggle('expanded');
  if (expanded) {
    const entries = loadedChildren.get(path);
    if (entries !== undefined) renderTreeChildren(li, entries);
    else loadChildren(path, li);
  }
}

function openFile(path) {
  document.querySelectorAll('.tree-item.selected').forEach(function (el) { el.classList.remove('selected'); });
  document.querySelectorAll('.tree-item').forEach(function (el) {
    if (el.dataset.path === path) el.classList.add('selected');
  });
  selectedPath = path;
  var existing = tabs.filter(function (t) { return t.path === path; })[0];
  if (existing) {
    selectTab(existing.id);
    return;
  }
  var a = getApi();
  if (a) {
    a.read_file(path).then(function (data) {
      if (data && data.content != null) {
        addTab({ path: data.path, title: getTabTitle(data.path), content: data.content });
      } else if (data && data.error) {
        render({ path: path, content: null, error: data.error });
      }
    }).catch(showError);
  }
}

function showError(err) {
  contentEl.className = 'content';
  contentEl.innerHTML = '<div class="rendered"><div class="error">' + escapeHtml(String(err && (err.message || err))) + '</div></div>';
}

function selectFile(path) {
  document.querySelectorAll('.tree-item').forEach(function (el) {
    if (el.dataset.path === path) el.classList.add('selected');
  });
  selectedPath = path;
}

function getTreeItemByPath(path) {
  var found = null;
  treeEl.querySelectorAll('.tree-item').forEach(function (el) {
    if (el.dataset.path === path) found = el;
  });
  return found;
}

function refreshFolder(folderPath) {
  var a = getApi();
  if (!a) return;
  a.list_dir(folderPath).then(function (res) {
    var entries = res.entries || [];
    loadedChildren.set(folderPath, entries);
    var parentLi = getTreeItemByPath(folderPath);
    if (parentLi) renderTreeChildren(parentLi, entries);
  }).catch(function () {});
}

var contextMenuFolderPath = null;
var contextMenuFilePath = null;
function createInFolder(folderPath) {
  var name = prompt('Enter filename (e.g. My Note.md):', 'Untitled.md');
  if (name == null || !name.trim()) return;
  var a = getApi();
  if (!a || typeof a.create_file !== 'function') {
    showError('Create file not available.');
    return;
  }
  a.create_file(folderPath, name.trim()).then(function (data) {
    if (data && data.error) {
      showError(data.error);
      return;
    }
    if (data && data.path) {
      refreshFolder(folderPath);
      openFile(data.path);
    }
  }).catch(function (err) {
    showError(err && (err.message || err) || 'Failed to create file.');
  });
}

function onOpenFile() {
  openMenu.classList.remove('visible');
  var a = getApi();
  if (!a) {
    contentEl.className = 'content';
    contentEl.innerHTML = '<div class="rendered"><div class="error">API not available. Run this app from Markdown Reader.</div></div>';
    return;
  }
  a.open_file().then(function (data) {
    if (!data) return;
    if (data.error) {
      render({ path: data.path, content: null, error: data.error });
      return;
    }
    addTab({ path: data.path, title: getTabTitle(data.path), content: data.content });
    setTreeRoot(data.root, null);
    selectFile(data.path);
  }).catch(showError);
}

function onOpenFolder() {
  openMenu.classList.remove('visible');
  var a = getApi();
  if (!a) {
    contentEl.className = 'content';
    contentEl.innerHTML = '<div class="rendered"><div class="error">API not available. Run this app from Markdown Reader.</div></div>';
    return;
  }
  a.open_folder().then(function (data) {
    if (!data) return;
    if (data.error) {
      contentEl.className = 'content';
      contentEl.innerHTML = '<div class="rendered"><div class="error">' + escapeHtml(data.error) + '</div></div>';
      return;
    }
    setTreeRoot(data.root, null);
    activeTabId = null;
    renderTabBar();
    contentEl.className = 'content empty';
    contentEl.innerHTML = 'Select a file from the tree to view it.';
    filenameEl.textContent = '';
  }).catch(showError);
}

if (newFileBtn) newFileBtn.disabled = true;
newFileBtn.addEventListener('click', function () {
  if (!treeRoot || newFileBtn.disabled) return;
  createInFolder(treeRoot);
});
if (treeWrap) {
  treeWrap.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var item = e.target.closest('.tree-item');
    if (item) {
      var isDir = item.dataset.isDir === '1';
      var path = item.dataset.path || '';
      if (isDir) {
        contextMenuFolderPath = path;
        contextMenuFilePath = null;
      } else {
        contextMenuFolderPath = path.replace(/[/\\][^/\\]+$/, '') || path;
        contextMenuFilePath = path;
      }
      newFileHereBtn.style.display = 'block';
      deleteFileBtn.style.display = isDir ? 'none' : 'block';
    } else {
      contextMenuFolderPath = treeRoot;
      contextMenuFilePath = null;
      newFileHereBtn.style.display = treeRoot ? 'block' : 'none';
      deleteFileBtn.style.display = 'none';
    }
    treeContextMenu.classList.add('visible');
    treeContextMenu.style.left = e.clientX + 'px';
    treeContextMenu.style.top = e.clientY + 'px';
  });
}
newFileHereBtn.addEventListener('click', function () {
  treeContextMenu.classList.remove('visible');
  if (contextMenuFolderPath) {
    createInFolder(contextMenuFolderPath);
    contextMenuFolderPath = null;
  }
});
deleteFileBtn.addEventListener('click', function () {
  treeContextMenu.classList.remove('visible');
  if (!contextMenuFilePath) return;
  var path = contextMenuFilePath;
  contextMenuFilePath = null;
  if (!confirm('Delete this file? This cannot be undone.')) return;
  var a = getApi();
  if (!a || typeof a.delete_file !== 'function') {
    showError('Delete not available.');
    return;
  }
  a.delete_file(path).then(function (res) {
    if (res && res.error) {
      showError(res.error);
      return;
    }
    var parentPath = path.replace(/[/\\][^/\\]+$/, '').replace(/^$/, path);
    if (parentPath !== path) refreshFolder(parentPath);
    closeTab(path);
  }).catch(function (err) {
    showError(err && (err.message || err) || 'Failed to delete file.');
  });
});
document.addEventListener('click', function () {
  openMenu.classList.remove('visible');
  treeContextMenu.classList.remove('visible');
});

function handleEnterInBlock(editable, blockEl, index) {
  var tab = getActiveTab() || currentTabRef;
  if (!tab || !currentBlocks.length || index < 0 || index >= currentBlocks.length) { dbg('handleEnterInBlock: bail early', !!tab, currentBlocks.length, index); return; }
  if (blockEl.classList.contains('md-block-code')) return;
  var blocks = currentBlocks;
  var text = (editable.innerText != null ? editable.innerText : editable.textContent || '').replace(/\u00a0/g, ' ');
  var offset = Math.max(0, Math.min(getCaretOffset(editable), text.length));
  var beforeCursor = text.slice(0, offset);
  var afterCursor = text.slice(offset);
  dbg('handleEnterInBlock: text=' + JSON.stringify(text) + ' offset=' + offset + ' before=' + JSON.stringify(beforeCursor) + ' after=' + JSON.stringify(afterCursor));
  var isList = blockEl.classList.contains('md-block-list');
  var prefix = isList ? getListPrefix(blocks[index].raw) : null;
  if (isList && prefix && text.trim() === '') {
    blocks.splice(index, 1);
    tab.content = blocksToContent(blocks);
    currentTabRef.content = tab.content;
    currentBlocks = blocks;
    showTabContent(tab);
    setTimeout(function () {
      var nextEl = contentEl.querySelector('.md-block[data-block-index="' + index + '"]');
      if (nextEl) startInlineEdit(nextEl, index, currentBlocks, tab, null);
    }, 10);
    return;
  }
  if (prefix) {
    blocks[index].raw = prefix + beforeCursor;
    var newBlock = { raw: prefix + afterCursor, type: 'list' };
    blocks.splice(index + 1, 0, newBlock);
  } else {
    blocks[index].raw = typeof beforeCursor === 'string' ? beforeCursor : String(beforeCursor || '');
    var newBlock = { raw: typeof afterCursor === 'string' ? afterCursor : String(afterCursor || ''), type: 'paragraph' };
    blocks.splice(index + 1, 0, newBlock);
  }
  tab.content = blocksToContent(blocks);
  currentTabRef.content = tab.content;
  currentBlocks = blocks;
  dbg('handleEnterInBlock: blocks.length=', blocks.length, 'tab.content=' + JSON.stringify(tab.content));
  requestAnimationFrame(function () {
    try {
      dbg('rAF1: calling showTabContent with', blocks.length, 'blocks');
      showTabContent(tab, blocks);
      dbg('rAF1: showTabContent returned');
    } catch (err1) {
      dbg('rAF1 ERROR:', String(err1 && (err1.message || err1)));
      return;
    }
    setTimeout(function () {
      try {
      var allBlocks = contentEl.querySelectorAll('.md-block');
      var indices = [];
      for (var i = 0; i < allBlocks.length; i++) indices.push(allBlocks[i].getAttribute('data-block-index'));
      dbg('rAF1: after showTabContent, .md-block count=', allBlocks.length, 'indices=', indices.join(','));
      } catch (e) { dbg('rAF1 count ERROR:', String(e && (e.message || e))); }
      setTimeout(function () {
        try {
          dbg('rAF2/setTimeout: start');
          var newBlockEl = contentEl.querySelector('.md-block[data-block-index="' + (index + 1) + '"]');
          dbg('rAF2/setTimeout: newBlockEl found=', !!newBlockEl, 'query index=', index + 1);
          if (newBlockEl) {
            startInlineEdit(newBlockEl, index + 1, currentBlocks, tab, null);
            var edit = newBlockEl.querySelector('.inline-edit');
            dbg('rAF2/setTimeout: .inline-edit found=', !!edit);
            if (edit) {
              edit.focus();
              setCaretPosition(edit, 0);
              dbg('rAF2/setTimeout: after focus activeElement=', document.activeElement ? document.activeElement.tagName + (document.activeElement === edit ? ' (edit)' : '') : 'null');
              setTimeout(function () {
                if (document.activeElement !== edit) {
                  dbg('setTimeout(0): focus was lost, re-focusing. activeElement=', document.activeElement ? document.activeElement.tagName : 'null');
                  edit.focus();
                  setCaretPosition(edit, 0);
                } else {
                  dbg('setTimeout(0): focus still on edit OK');
                }
              }, 0);
            }
          } else {
            dbg('rAF2/setTimeout: no newBlockEl - cannot open new block');
          }
        } catch (err2) {
          dbg('rAF2/setTimeout ERROR:', String(err2 && (err2.message || err2)));
        }
      }, 0);
    }, 0);
  });
}

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.keyCode !== 13) return;
  var active = document.activeElement;
  dbg('Enter keydown capture | activeElement:', active ? (active.tagName + (active.className ? '.' + String(active.className).replace(/\s+/g, '.') : '')) : 'null', 'inContent:', active ? contentEl.contains(active) : false);
  if (!active || !contentEl.contains(active)) return;
  var editable = active.classList && active.classList.contains('inline-edit') ? active : active.closest('.inline-edit');
  if (!editable) { dbg('Enter: no .inline-edit found'); return; }
  var blockEl = editable.closest('.md-block');
  if (!blockEl) { dbg('Enter: no .md-block found'); return; }
  if (blockEl.classList.contains('md-block-code')) return;
  var index = parseInt(blockEl.getAttribute('data-block-index'), 10);
  if (isNaN(index) || index < 0) { dbg('Enter: bad index', index); return; }
  dbg('Enter: handling in block index', index);
  e.preventDefault();
  e.stopPropagation();
  handleEnterInBlock(editable, blockEl, index);
}, true);

document.addEventListener('keydown', function (e) {
  if (!DEBUG_ENTER) return;
  var t = e.target;
  if (t && contentEl.contains(t)) {
    var isEdit = t.classList && t.classList.contains('inline-edit') ? 'YES' : (t.closest && t.closest('.inline-edit') ? 'child' : 'NO');
    var msg = 'key=' + (e.key || e.code) + ' target=' + (t.tagName + (t.className ? '.' + String(t.className).slice(0, 30) : '')) + ' inline-edit=' + isEdit + ' active=' + (document.activeElement === t ? 'target' : (document.activeElement ? document.activeElement.tagName : 'null'));
    console.log('[MD key]', msg);
    var el = document.getElementById('debugPanel');
    if (el) {
      var line = document.createElement('div');
      line.className = 'debug-line debug-key';
      line.textContent = '[MD key] ' + msg;
      el.appendChild(line);
      while (el.children.length > DEBUG_MAX_LINES + 1) el.removeChild(el.children[1]);
      el.scrollTop = el.scrollHeight;
    }
  }
}, true);

openBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  openMenu.classList.toggle('visible');
});
openMenu.querySelectorAll('button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    if (this.dataset.action === 'file') onOpenFile();
    else onOpenFolder();
  });
});

sidebar.querySelector('.sidebar-toggle').addEventListener('click', function () {
  sidebar.classList.toggle('collapsed');
  this.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
  this.title = sidebar.classList.contains('collapsed') ? 'Show file tree' : 'Collapse file tree';
});
document.getElementById('showSidebarBtn').addEventListener('click', function () {
  sidebar.classList.remove('collapsed');
  sidebar.querySelector('.sidebar-toggle').textContent = '◀';
  sidebar.querySelector('.sidebar-toggle').title = 'Collapse file tree';
});

const themePicker = document.getElementById('themePicker');

function applyTheme(themeId) {
  document.body.setAttribute('data-theme', themeId);
  themePicker.value = themeId;
}

themePicker.addEventListener('change', function () {
  applyTheme(this.value);
  var a = getApi();
  if (a && typeof a.save_setting === 'function') {
    a.save_setting('theme', this.value);
  }
});

var focusBtn = document.getElementById('focusBtn');
var focusExitBtn = document.getElementById('focusExitBtn');
function setFocusMode(on) {
  document.body.setAttribute('data-focus-mode', on ? 'true' : 'false');
  var a = getApi();
  if (a && typeof a.toggle_fullscreen === 'function') {
    a.toggle_fullscreen();
  }
}
function isFocusMode() {
  return document.body.getAttribute('data-focus-mode') === 'true';
}
if (focusBtn) {
  focusBtn.addEventListener('click', function () {
    setFocusMode(true);
  });
}
if (focusExitBtn) {
  focusExitBtn.addEventListener('click', function () {
    setFocusMode(false);
  });
}

var modeReadBtn = document.getElementById('modeReadBtn');
var modeEditBtn = document.getElementById('modeEditBtn');
if (modeReadBtn) modeReadBtn.addEventListener('click', function () {
  var tab = getActiveTab();
  if (tab) switchToReadMode(tab);
});
if (modeEditBtn) modeEditBtn.addEventListener('click', function () {
  var tab = getActiveTab();
  if (tab && tab.path) switchToEditMode(tab);
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && isFocusMode()) {
    setFocusMode(false);
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    var tab = getActiveTab();
    if (tab && tab.path) {
      e.preventDefault();
      saveToFile(tab);
    }
  }
});

window.addEventListener('beforeunload', function () {
  flushActiveEditAndSave();
});

applyTheme('obsidianite');

function showFallbackContent() {
  contentEl.className = 'content empty';
  contentEl.innerHTML = 'Open a file or folder to view markdown files. Only folders and .md files are shown in the tree.';
}

function loadWelcome() {
  var a = getApi();
  if (!a || typeof a.get_welcome !== 'function') {
    showFallbackContent();
    return;
  }
  var done = false;
  function finish(data) {
    if (done) return;
    done = true;
    if (data && data.content) {
      welcomeContent = data.content;
      contentEl.className = 'content';
      contentEl.innerHTML = '<div class="rendered">' + marked.parse(data.content) + '</div>';
      highlightCodeInContainer(contentEl);
      filenameEl.textContent = 'Welcome';
    } else {
      showFallbackContent();
    }
  }
  var timeoutId = setTimeout(function () { finish(null); }, 2500);
  a.get_welcome().then(function (data) {
    clearTimeout(timeoutId);
    finish(data);
  }).catch(function () {
    clearTimeout(timeoutId);
    finish(null);
  });
}

var welcomeLoaded = false;
function whenApiReady(fn) {
  var maxRetries = 25;
  var retries = 0;
  function run() {
    if (welcomeLoaded) return;
    if (getApi()) {
      welcomeLoaded = true;
      fn();
      return;
    }
    retries++;
    if (retries < maxRetries) {
      setTimeout(run, 200);
    } else {
      welcomeLoaded = true;
      fn();
    }
  }
  window.addEventListener('pywebviewready', function onReady() {
    window.removeEventListener('pywebviewready', onReady);
    run();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(run, 100);
    });
  } else {
    setTimeout(run, 100);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    whenApiReady(loadWelcome);
  });
} else {
  whenApiReady(loadWelcome);
}
