(() => {
  'use strict';

  const PAGE_SIZE = 60;
  const DEFAULT_TAP = 'homebrew/cask';
  const OPTIONAL_STATUSES = ['outdated', 'deprecated', 'disabled'];
  const STATUS_LABELS = {
    outdated: 'outdated',
    deprecated: 'deprecated',
    disabled: 'disabled',
    auto_updates: 'auto-update',
  };

  const state = {
    all: [],
    filteredVersions: [],
    view: [],
    taps: [],
    selectedTaps: new Set(),
    selectedStatuses: new Set(),
    page: 1,
    loading: true,
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
  const title = cask => (Array.isArray(cask.name) && cask.name[0]) || cask.token || 'Untitled cask';
  const baseToken = cask => String(cask.token || '').split('@')[0];

  function tapOf(cask) {
    if (cask.tap) return String(cask.tap);
    const parts = String(cask.full_token || '').split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : DEFAULT_TAP;
  }

  function displayToken(cask) {
    return cask.full_token && cask.full_token !== cask.token ? cask.full_token : cask.token;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function compareText(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  function latest(group) {
    return group.items[0];
  }

  function setLoading(loading) {
    state.loading = loading;
    $('loading').hidden = !loading;
    $('results').hidden = loading;
    $('reload').disabled = loading;
    $('q').disabled = loading;
    document.querySelectorAll('#filters input').forEach(input => { input.disabled = loading; });
    if (loading) $('pager').hidden = true;
  }

  function setData(casks) {
    if (!Array.isArray(casks)) throw new Error('Expected the JSON root to be an array.');

    state.all = casks;
    state.taps = [...new Set(casks.map(tapOf))].sort((a, b) => {
      if (a === DEFAULT_TAP) return -1;
      if (b === DEFAULT_TAP) return 1;
      return compareText(a, b);
    });
    state.selectedTaps = new Set(state.taps);
    renderTapOptions();
    applyFilters();
  }

  async function load() {
    setLoading(true);
    $('file').style.display = 'none';
    $('status').textContent = 'Loading cask.json…';

    try {
      const response = await fetch('cask.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      setData(await response.json());
      $('status').textContent = `Loaded ${state.all.length.toLocaleString()} versions across ${state.taps.length.toLocaleString()} taps.`;
    } catch (error) {
      $('status').textContent = `Could not fetch cask.json (${error.message}). Serve this directory with a local web server, or choose a local JSON file.`;
      $('file').style.display = 'block';
      setLoading(false);
      $('results').hidden = true;
      $('empty').hidden = true;
      $('result-summary').textContent = 'Data unavailable';
    }
  }

  function renderTapOptions() {
    $('tap-options').innerHTML = state.taps.map((tap, index) => `
      <label class="filter-option">
        <input type="checkbox" name="tap" value="${esc(tap)}" id="tap-${index}" checked>
        <span>${esc(tap)}</span>
      </label>`).join('');
    updateAllTapsControl();
  }

  function updateAllTapsControl() {
    const control = $('tap-all');
    const selected = state.selectedTaps.size;
    control.checked = state.taps.length > 0 && selected === state.taps.length;
    control.indeterminate = selected > 0 && selected < state.taps.length;
  }

  function matchesSearch(cask, query) {
    if (!query) return true;
    return [
      cask.token,
      cask.full_token,
      tapOf(cask),
      title(cask),
      cask.desc,
      cask.homepage,
      cask.version,
    ].join(' ').toLowerCase().includes(query);
  }

  function matchesStatus(cask) {
    // Regular casks always appear; checked statuses add flagged casks to the results.
    return !OPTIONAL_STATUSES.some(status => cask[status]) ||
      [...state.selectedStatuses].some(status => cask[status]);
  }

  function groupCasks(casks) {
    const groups = new Map();

    for (const cask of casks) {
      const tap = tapOf(cask);
      const token = baseToken(cask);
      const key = `${tap}/${token}`;
      if (!groups.has(key)) groups.set(key, { key, tap, token, items: [] });
      groups.get(key).items.push(cask);
    }

    return [...groups.values()].map(group => {
      group.items.sort((a, b) => compareText(b.version, a.version));
      return group;
    }).sort((a, b) => compareText(a.token, b.token) || compareText(a.tap, b.tap));
  }

  function applyFilters() {
    const query = $('q').value.trim().toLowerCase();

    state.filteredVersions = state.all.filter(cask => (
      state.selectedTaps.has(tapOf(cask)) &&
      matchesStatus(cask) &&
      matchesSearch(cask, query)
    ));
    state.view = groupCasks(state.filteredVersions);
    state.page = 1;
    setLoading(false);
    render();
  }

  function statusTags(items) {
    return Object.entries(STATUS_LABELS).filter(([key]) => items.some(cask => cask[key])).map(([key, label]) => {
      const tone = key === 'auto_updates' ? 'positive' : 'negative';
      return `<span class="status-tag ${tone}">${label}</span>`;
    }).join('');
  }

  function render() {
    const pageCount = Math.ceil(state.view.length / PAGE_SIZE);
    state.page = pageCount === 0 ? 1 : Math.min(Math.max(state.page, 1), pageCount);
    const start = (state.page - 1) * PAGE_SIZE;
    const visible = state.view.slice(start, start + PAGE_SIZE);

    $('results').innerHTML = visible.map((group, index) => {
      const cask = latest(group);
      const homepage = safeUrl(cask.homepage);
      const count = group.items.length;
      return `<article class="result-card">
        <div class="result-name">
          <h2>${esc(title(cask))}</h2>
          <code>${esc(group.token)}</code>
        </div>
        <p class="result-description">${esc(cask.desc || 'No description provided.')}</p>
        <div class="result-meta">
          <p><strong>${esc(cask.version || 'unknown')}</strong> · ${count} ${count === 1 ? 'version' : 'versions'}</p>
          <p class="tap-name"><code>${esc(group.tap)}</code></p>
          <div class="statuses">${statusTags(group.items)}</div>
        </div>
        <div class="row-actions">
          ${homepage ? `<a href="${esc(homepage)}" target="_blank" rel="noreferrer">Homepage</a>` : '<span></span>'}
          <button class="secondary outline details-button" type="button" data-index="${start + index}">Details</button>
        </div>
      </article>`;
    }).join('');

    $('results').hidden = state.loading || state.view.length === 0;
    $('empty').hidden = state.loading || state.view.length !== 0;
    $('result-summary').textContent = `${state.view.length.toLocaleString()} casks · ${state.filteredVersions.length.toLocaleString()} of ${state.all.length.toLocaleString()} versions`;

    const hasPrevious = state.page > 1;
    const hasNext = state.page * PAGE_SIZE < state.view.length;
    $('pager').hidden = state.loading || state.view.length <= PAGE_SIZE;
    $('prev').disabled = !hasPrevious;
    $('next').disabled = !hasNext;
    $('page').textContent = pageCount ? `Page ${state.page} of ${pageCount}` : '';
  }

  function showDetails(group) {
    const cask = latest(group);
    const homepage = safeUrl(cask.homepage);
    const count = group.items.length;

    $('detail-heading').innerHTML = `
      <h2 id="detail-title">${esc(title(cask))}</h2>
      <p><code>${esc(group.tap)}/${esc(group.token)}</code> · ${count} filtered ${count === 1 ? 'version' : 'versions'}</p>`;

    $('detail-body').innerHTML = `
      <p class="detail-intro">${esc(cask.desc || 'No description provided.')}</p>
      ${homepage ? `<p><a href="${esc(homepage)}" target="_blank" rel="noreferrer">Visit homepage</a></p>` : ''}
      <div class="version-list">
        ${group.items.map(version => {
          const downloadUrl = safeUrl(version.url);
          return `<section class="version-row">
            <h3>${esc(displayToken(version))} · ${esc(version.version || 'unknown')}</h3>
            <div class="statuses">${statusTags([version])}</div>
            ${downloadUrl ? `<p>URL: <code>${esc(downloadUrl)}</code></p>` : ''}
            ${version.sha256 ? `<p>SHA256: <code>${esc(version.sha256)}</code></p>` : ''}
          </section>`;
        }).join('')}
      </div>`;

    $('details').showModal();
  }

  $('q').addEventListener('input', applyFilters);

  $('tap-all').addEventListener('change', event => {
    const checked = event.currentTarget.checked;
    document.querySelectorAll('input[name="tap"]').forEach(input => { input.checked = checked; });
    state.selectedTaps = checked ? new Set(state.taps) : new Set();
    updateAllTapsControl();
    applyFilters();
  });

  $('tap-options').addEventListener('change', event => {
    if (!event.target.matches('input[name="tap"]')) return;
    const tap = event.target.value;
    if (event.target.checked) state.selectedTaps.add(tap);
    else state.selectedTaps.delete(tap);
    updateAllTapsControl();
    applyFilters();
  });

  document.querySelectorAll('input[name="status"]').forEach(input => {
    input.addEventListener('change', event => {
      const status = event.target.value;
      if (event.target.checked) state.selectedStatuses.add(status);
      else state.selectedStatuses.delete(status);
      applyFilters();
    });
  });

  $('prev').addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    render();
    $('catalog-title').scrollIntoView({ behavior: 'smooth' });
  });

  $('next').addEventListener('click', () => {
    if (state.page * PAGE_SIZE >= state.view.length) return;
    state.page += 1;
    render();
    $('catalog-title').scrollIntoView({ behavior: 'smooth' });
  });

  $('reload').addEventListener('click', load);

  $('file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    setLoading(true);
    $('status').textContent = `Loading ${file.name}…`;

    try {
      setData(JSON.parse(await file.text()));
      $('status').textContent = `Loaded ${state.all.length.toLocaleString()} versions from ${file.name}.`;
    } catch (error) {
      $('status').textContent = `Could not read ${file.name}: ${error.message}`;
      setLoading(false);
    }
  });

  $('results').addEventListener('click', event => {
    const button = event.target.closest('.details-button');
    if (!button) return;
    showDetails(state.view[Number(button.dataset.index)]);
  });

  $('close-details').addEventListener('click', () => $('details').close());
  $('details').addEventListener('click', event => {
    if (event.target === $('details')) $('details').close();
  });

  load();
})();
