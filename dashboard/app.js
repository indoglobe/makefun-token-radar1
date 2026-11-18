// Token Radar Terminal Dashboard
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var app = document.getElementById('app');
  var state = {
    q: '',
    category: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    compareSlugs: [],
    focusIndex: -1
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('compare')) {
      try {
        state.compareSlugs = params.get('compare').split(',').filter(Boolean);
      } catch (e) {
        state.compareSlugs = [];
      }
    }
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.compareSlugs.length > 0) params.set('compare', state.compareSlugs.join(','));
    var next = params.toString();
    if (next) {
      window.history.replaceState(null, '', '#' + next);
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderHeader() {
    return el('header', { class: 'terminal-header' },
      el('div', { class: 'terminal-brand' },
        el('span', { class: 'radar-dot' }),
        el('span', { text: 'TOKEN RADAR TERMINAL' })
      ),
      el('div', { class: 'terminal-meta' },
        el('span', { text: 'AS OF ' + DATA.as_of }),
        el('span', { text: DATA.source }),
        el('span', { text: DATA.model_version })
      )
    );
  }

  function renderHero() {
    return el('section', { class: 'hero-panel' },
      el('div', { class: 'hero-copy' },
        el('h1', { text: DATA.watchlist_size + ' Watchlist Protocols Ranked by Implied Value' }),
        el('p', { text: 'Deterministic radar engine evaluating pre-token protocol intrinsic token value based on TVL, 7-day growth momentum, volatility distribution, and historical age maturity. Inspect underlying math factors and farm action plans per protocol.' })
      ),
      el('div', { class: 'hero-stats' },
        el('div', { class: 'stat-item' }, el('span', { text: 'Watchlist' }), el('b', { text: DATA.watchlist_size })),
        el('div', { class: 'stat-item' }, el('span', { text: 'Board Rows' }), el('b', { text: DATA.board_size })),
        el('div', { class: 'stat-item' }, el('span', { text: 'Live Set' }), el('b', { text: DATA.live_size }))
      )
    );
  }

  function renderControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    
    var searchInput = el('input', {
      type: 'search',
      class: 'control-input',
      id: 'search-input',
      placeholder: 'Search protocols, chains, categories...',
      value: state.q,
      'aria-label': 'Search protocols'
    });
    searchInput.addEventListener('input', function () {
      state.q = searchInput.value;
      writeHash();
      render();
    });

    var categorySelect = el('select', {
      class: 'control-select',
      id: 'category-select',
      'aria-label': 'Filter by category'
    },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    );
    categorySelect.addEventListener('change', function () {
      state.category = categorySelect.value;
      writeHash();
      render();
    });

    var preTab = el('button', {
      type: 'button',
      class: 'tab-btn',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-Token Radar',
      onclick: function () {
        state.tab = 'pre-token';
        writeHash();
        render();
      }
    });

    var liveTab = el('button', {
      type: 'button',
      class: 'tab-btn',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live Tokens',
      onclick: function () {
        state.tab = 'live';
        writeHash();
        render();
      }
    });

    var countText = state.tab === 'pre-token' ? filteredRows().length + ' rows' : DATA.live.length + ' live tokens';

    return el('div', { class: 'controls-bar' },
      el('div', { class: 'control-group' },
        el('label', { for: 'search-input', text: 'Filter' }),
        searchInput
      ),
      el('div', { class: 'control-group' },
        el('label', { for: 'category-select', text: 'Category' }),
        categorySelect
      ),
      el('div', { class: 'control-group' },
        el('label', { text: 'View Mode' }),
        el('div', { class: 'tabs-group' }, preTab, liveTab)
      ),
      el('span', { class: 'row-count', text: countText })
    );
  }

  function renderSortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        class: 'sort-btn',
        onclick: function () {
          if (state.sort === key) {
            state.dir = -state.dir;
          } else {
            state.sort = key;
            state.dir = -1;
          }
          render();
        }
      },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function renderBoardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'table-panel' },
        el('div', { class: 'empty-state' },
          el('h2', { text: 'No protocols match your filter criteria' }),
          el('p', { text: 'Try broadening your search query or resetting the category filter.' }),
          el('button', {
            type: 'button',
            class: 'btn primary',
            text: 'Reset Filters',
            onclick: function () {
              state.q = '';
              state.category = 'all';
              writeHash();
              render();
            }
          })
        )
      );
    }

    var maxImplied = list[0].implied_value_usd || 1;
    var tbody = el('tbody', { class: 'radar-tbody' });

    list.forEach(function (r, idx) {
      var growthText = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var firstStep = r.farm_steps && r.farm_steps.length > 0 ? r.farm_steps[0] : 'Farm action plan ready.';
      var barWidth = Math.max(4, Math.min(100, Math.round((r.implied_value_usd / maxImplied) * 100)));
      var isChecked = state.compareSlugs.indexOf(r.slug) >= 0;
      var isFocused = state.focusIndex === idx;

      var checkbox = el('input', {
        type: 'checkbox',
        class: 'compare-checkbox',
        'aria-label': 'Select ' + r.name + ' for comparison',
        checked: isChecked ? 'checked' : null,
        onclick: function (e) {
          e.stopPropagation();
          toggleCompare(r.slug);
        }
      });

      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-focused': isFocused ? 'true' : 'false',
        tabindex: '0',
        onclick: function () {
          state.focusIndex = idx;
          openDetail(r.slug);
        },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(r.slug);
          }
        }
      },
        el('td', { class: 'num' }, checkbox, ' ', String(r.rank)),
        el('td', null,
          el('div', { class: 'proto-name' },
            el('b', { text: r.name }),
            el('span', { class: 'proto-sub', text: (r.category || 'Other') + ' / ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'Multi') })
          )
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growthText }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null,
          el('div', { class: 'val-bar-wrap' },
            el('div', { class: 'val-bar', 'aria-hidden': 'true' }, el('i', { style: 'width: ' + barWidth + '%' })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          )
        ),
        el('td', null, el('span', { class: 'badge', text: 'pre-token' })),
        el('td', null, el('div', { class: 'farm-snippet', title: firstStep, text: firstStep }))
      );
      tbody.appendChild(tr);
    });

    return el('div', { class: 'table-panel' },
      el('div', { class: 'table-scroll' },
        el('table', { class: 'radar-table' },
          el('caption', { class: 'visually-hidden', text: 'Pre-token protocols ranked by implied valuation' }),
          el('thead', null,
            el('tr', null,
              renderSortHeader('implied', 'Compare / Rank'),
              renderSortHeader('name', 'Protocol'),
              renderSortHeader('tvl', 'TVL'),
              renderSortHeader('growth', '7d Growth'),
              renderSortHeader('age', 'Age'),
              renderSortHeader('implied', 'Implied Value'),
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Farm Step 1' })
            )
          ),
          tbody
        )
      )
    );
  }

  function renderLiveTable() {
    var tbody = el('tbody', { class: 'radar-tbody' });
    DATA.live.forEach(function (r) {
      var growthText = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(
        el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null,
            el('div', { class: 'proto-name' },
              el('b', { text: r.name }),
              el('span', { class: 'proto-sub', text: (r.category || 'Other') + ' / ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'Multi') })
            )
          ),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + growthClass, text: growthText }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', null, el('span', { class: 'badge', text: 'active token' }))
        )
      );
    });

    return el('div', { class: 'table-panel' },
      el('div', { class: 'table-scroll' },
        el('table', { class: 'radar-table' },
          el('thead', null,
            el('tr', null,
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Protocol' }),
              el('th', { scope: 'col', text: 'TVL' }),
              el('th', { scope: 'col', text: '7d Growth' }),
              el('th', { scope: 'col', text: 'Market Cap' }),
              el('th', { scope: 'col', text: 'Token State' })
            )
          ),
          tbody
        )
      )
    );
  }

  function renderModelDoc() {
    var m = DATA.model;
    return el('section', { class: 'model-doc-panel' },
      el('h2', { text: 'Valuation Model Specification (' + DATA.model_version + ')' }),
      el('p', { class: 'proto-sub', text: 'Deterministic formula scoring every pre-token protocol across TVL, growth momentum, volatility distribution, and age maturity.' }),
      el('div', { class: 'formula-box' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x volatility_mult )'
      )
    );
  }

  function toggleCompare(slug) {
    var idx = state.compareSlugs.indexOf(slug);
    if (idx >= 0) {
      state.compareSlugs.splice(idx, 1);
    } else {
      if (state.compareSlugs.length >= 3) {
        state.compareSlugs.shift();
      }
      state.compareSlugs.push(slug);
    }
    writeHash();
    render();
  }

  var drawer = el('dialog', { class: 'detail-drawer', id: 'detail-drawer', 'aria-labelledby': 'drawer-title' });
  drawer.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });

  function openDetail(slug) {
    var row = DATA.rows.find(function (r) { return r.slug === slug; });
    if (!row) return;
    state.selected = slug;
    writeHash();

    drawer.textContent = '';
    drawer.appendChild(
      el('div', { class: 'drawer-header' },
        el('div', { class: 'drawer-title-group' },
          el('span', { class: 'proto-sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
          el('h2', { id: 'drawer-title', text: row.name }),
          el('span', { class: 'proto-sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'Multi-chain') })
        ),
        el('button', { type: 'button', class: 'btn', text: 'Close [esc]', onclick: function () { drawer.close(); } })
      )
    );

    // Chains Breakdown Panel
    var chainsGrid = el('div', { class: 'chains-chips-grid' });
    var chains = row.chains && row.chains.length > 0 ? row.chains : ['Multi-chain'];
    chains.forEach(function (ch) {
      chainsGrid.appendChild(
        el('div', { class: 'chain-chip-card' },
          el('span', { class: 'chain-dot' }),
          el('span', { class: 'chain-name', text: ch })
        )
      );
    });

    drawer.appendChild(
      el('section', { class: 'drawer-section' },
        el('h3', { text: 'Supported Chains (' + chains.length + ')' }),
        chainsGrid
      )
    );

    // Value math factors section
    var factorsBox = el('div', { class: 'math-factors' },
      el('div', { class: 'math-factor-row' }, el('span', { text: 'TVL (USD)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: '7d Growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: 'Protocol Age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: 'Growth Multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: 'Maturity Multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: 'Volatility Multiplier' }), el('b', { class: 'num', text: String(row.volatility_multiplier) })),
      el('div', { class: 'math-factor-row' }, el('span', { text: 'Implied Token Value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
    );

    drawer.appendChild(
      el('section', { class: 'drawer-section' },
        el('h3', { text: 'Value-Math Factors' }),
        factorsBox
      )
    );

    // Farm steps section
    var stepsList = el('ul', { class: 'farm-steps-list' });
    (row.farm_steps || []).forEach(function (stepStr) {
      var costIdx = stepStr.indexOf(' Cost: ');
      var actionText = costIdx >= 0 ? stepStr.slice(0, costIdx) : stepStr;
      var costTimeText = costIdx >= 0 ? stepStr.slice(costIdx + 1) : '';
      stepsList.appendChild(
        el('li', null,
          el('b', { text: actionText }),
          el('span', { class: 'farm-cost-time', text: costTimeText })
        )
      );
    });

    drawer.appendChild(
      el('section', { class: 'drawer-section' },
        el('h3', { text: 'Farm Action Plan (' + (row.farm_steps ? row.farm_steps.length : 0) + ' steps)' }),
        stepsList
      )
    );

    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  var compareModal = el('dialog', { class: 'compare-modal', id: 'compare-modal', 'aria-labelledby': 'compare-title' });

  function openCompareModal() {
    compareModal.textContent = '';
    var selectedRows = state.compareSlugs.map(function (slug) {
      return DATA.rows.find(function (r) { return r.slug === slug; });
    }).filter(Boolean);

    var grid = el('div', { class: 'compare-grid' });
    selectedRows.forEach(function (r) {
      grid.appendChild(
        el('div', { class: 'compare-col' },
          el('div', { class: 'compare-col-header' },
            el('b', { text: r.name }),
            el('span', { class: 'proto-sub', text: 'Rank ' + r.rank + ' • ' + (r.category || 'Other') })
          ),
          el('div', { class: 'compare-metrics' },
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Implied Value' }), el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(r.tvl_usd) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: '7d Growth' }), el('b', { class: 'num', text: fmtPct(r.change_7d) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Age' }), el('b', { class: 'num', text: fmtAge(r.age_days) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Growth Mult' }), el('b', { class: 'num', text: String(r.growth_multiplier) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Maturity Mult' }), el('b', { class: 'num', text: String(r.maturity_multiplier) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Volatility Mult' }), el('b', { class: 'num', text: String(r.volatility_multiplier) })),
            el('div', { class: 'math-factor-row' }, el('span', { text: 'Chains' }), el('b', { class: 'num', text: (r.chains || []).join(', ') }))
          )
        )
      );
    });

    compareModal.appendChild(
      el('div', { class: 'drawer-header' },
        el('div', { class: 'drawer-title-group' },
          el('h2', { id: 'compare-title', text: 'Protocol Side-by-Side Comparison (' + selectedRows.length + '/3)' }),
          el('span', { class: 'proto-sub', text: 'Comparing valuation math factors and liquidity distribution' })
        ),
        el('button', { type: 'button', class: 'btn', text: 'Close [esc]', onclick: function () { compareModal.close(); } })
      )
    );
    compareModal.appendChild(grid);

    if (typeof compareModal.showModal === 'function') {
      if (!compareModal.open) compareModal.showModal();
    } else {
      compareModal.setAttribute('open', '');
    }
  }

  function renderCompareBar() {
    if (state.compareSlugs.length === 0) return null;
    var names = state.compareSlugs.map(function (slug) {
      var r = DATA.rows.find(function (row) { return row.slug === slug; });
      return r ? r.name : slug;
    }).join(', ');

    return el('div', { class: 'compare-floating-bar' },
      el('div', { class: 'compare-bar-info' },
        el('b', { text: 'Compare Mode (' + state.compareSlugs.length + '/3 selected):' }),
        el('span', { text: names })
      ),
      el('div', { class: 'compare-bar-actions' },
        el('button', {
          type: 'button',
          class: 'btn primary',
          text: 'Launch Comparison',
          onclick: function () { openCompareModal(); }
        }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: 'Clear',
          onclick: function () {
            state.compareSlugs = [];
            writeHash();
            render();
          }
        })
      )
    );
  }

  function render() {
    app.textContent = '';
    var container = el('div', { class: 'container', id: 'main-content' },
      renderHeader(),
      renderHero(),
      renderControls(),
      state.tab === 'pre-token' ? renderBoardTable() : renderLiveTable()
    );
    if (state.tab === 'pre-token') {
      container.appendChild(renderModelDoc());
    }
    app.appendChild(container);

    var compareBar = renderCompareBar();
    if (compareBar) {
      app.appendChild(compareBar);
    }

    app.setAttribute('aria-busy', 'false');

    if (!drawer.isConnected) {
      app.appendChild(drawer);
    }
    if (!compareModal.isConnected) {
      app.appendChild(compareModal);
    }

    if (state.selected) {
      openDetail(state.selected);
    }
  }

  readHash();
  render();

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (drawer.open) drawer.close();
      if (compareModal.open) compareModal.close();
    }

    var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'select' || activeTag === 'textarea') return;

    var list = state.tab === 'pre-token' ? sortedRows(filteredRows()) : [];
    if (list.length === 0) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      state.focusIndex = Math.min(list.length - 1, state.focusIndex + 1);
      render();
      scrollFocusedIntoView();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      state.focusIndex = Math.max(0, state.focusIndex - 1);
      render();
      scrollFocusedIntoView();
    } else if (e.key === 'Enter' && state.focusIndex >= 0 && state.focusIndex < list.length) {
      e.preventDefault();
      var r = list[state.focusIndex];
      if (r) openDetail(r.slug);
    }
  });

  function scrollFocusedIntoView() {
    var focusedRow = document.querySelector('tr[data-focused="true"]');
    if (focusedRow) {
      focusedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
})();
