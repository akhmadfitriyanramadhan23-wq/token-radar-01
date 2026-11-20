// Token Radar's dashboard, radar-2. It reads window.RADAR — the dataset main.ts
// writes beside dashboard/ — and renders the ranked board, a filterable table,
// a per-protocol detail drawer carrying the model's own inputs and the farm plan.
// No network: every byte on screen comes from data.js.
(function () {
  'use strict';

  var SET = window.RADAR;
  if (!SET) return;
  var mount = document.getElementById('board');
  // Which rows are the watchlist: exactly the board's rows at or above the floor.
  // The early radar only adds rows below it, so a row's own TVL says which side
  // it is on — the 40 rows at or above the floor are the 40 watchlist slugs.
  var ON_WATCHLIST = {};
  SET.rows.forEach(function (r) { if (r.tvl_usd >= SET.floor_usd) ON_WATCHLIST[r.slug] = true; });
  var view = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var HOME_TITLE = 'Token Radar: pre-token protocols ranked by implied value';

  // ---- numbers and labels ----
  var usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var mag = Math.abs(n);
    if (mag >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (mag >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (mag >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdWhole.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function chainLabel(r) {
    if (!r.chains || !r.chains.length) return 'an unnamed chain';
    return r.chains.length === 1 ? r.chains[0] : r.chains.length + ' chains';
  }
  // The model in one place: the page scores a row from the snapshot figures and
  // checks the number board.json carries, so the page's arithmetic and the board's
  // data are visibly the same calculation.
  function recompute(row, model) {
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min((row.chains || []).length, model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  // ---- a small element builder ----
  // attrs maps attribute names to values; 'class', 'text' and 'html' are special,
  // 'on*' keys register listeners, null values are skipped. Later arguments are
  // children: nodes, strings, or arrays of either, nested as deep as needed.
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var value = attrs[key];
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    function push(child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) child.forEach(push);
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    for (var i = 2; i < arguments.length; i++) push(arguments[i]);
    return node;
  }

  // ---- the farm plan: the same derivation main.ts writes into board.json ----
  // Category, chains, TVL and age decide the action, the capital, the hold and
  // every cost and time. No protocol name is special-cased.
  function homeChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  // Capital by size, largest first: a bigger protocol gets a bigger position.
  var STAKE_TIERS = [[5000000000, 250], [1000000000, 150], [100000000, 100]];
  function stakeSize(p) {
    for (var i = 0; i < STAKE_TIERS.length; i++) {
      if (p.tvl_usd >= STAKE_TIERS[i][0]) return STAKE_TIERS[i][1];
    }
    return 50;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // Whether a lower-cased category carries any of the given words; the farm actions
  // share this test so a category is read the same way in both of them, as in the
  // model's own code.
  function hasAny(c) {
    var words = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < words.length; i++) {
      if (c.indexOf(words[i]) >= 0) return true;
    }
    return false;
  }
  // The category's actions as data, not two matching if-chains: one rule per kind of
  // protocol, in the order they are tried. The model carries the same table, so the
  // plan the page shows is the plan the board holds; adding a kind of protocol is
  // one entry here and one there, never a chain.
  var CATEGORY_RULES = [
    { keys: ['lend', 'cdp', 'collateral'],
      first: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; },
      second: function (name, capital, chain) { return 'Borrow a small amount against the supply on ' + name + ' and repay it within a week, so the wallet shows both sides of the market.'; } },
    { keys: ['dex', 'yield', 'leveraged farm'],
      first: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; },
      second: function (name, capital, chain) { return 'Swap a small amount through ' + name + "'s own router on " + chain + ', so the wallet shows a trade as well as liquidity.'; } },
    { keys: ['bridge'],
      first: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; },
      second: function (name, capital, chain) { return 'Use the bridged funds for one swap or deposit on ' + chain + ' instead of bridging straight back.'; } },
    { keys: ['staking', 'restak'],
      first: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; },
      second: function (name, capital, chain) { return 'Delegate a second, smaller stake through ' + name + ' a week later to show repeat activity.'; } },
    { keys: ['perpetual', 'derivative'],
      first: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; },
      second: function (name, capital, chain) { return 'Close the hedge and open a second small position in the opposite direction a week later.'; } },
    { keys: ['prediction'],
      first: function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; },
      second: function (name, capital, chain) { return 'Settle the first market, then place a second position on a different market on ' + name + '.'; } },
    { keys: ['curator', 'allocator'],
      first: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; },
      second: function (name, capital, chain) { return 'Deposit into a second ' + name + ' vault with a different strategy from the same wallet.'; } },
    { keys: ['stable'],
      first: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; },
      second: function (name, capital, chain) { return 'Hold the stable asset through one weekly points snapshot, then move a small amount to a second use.'; } },
    { keys: ['rwa'],
      first: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; },
      second: function (name, capital, chain) { return 'Reinvest the first yield distribution into the same asset instead of withdrawing it.'; } },
    { keys: ['insurance'],
      first: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; },
      second: function (name, capital, chain) { return 'Buy a second, smaller cover on a different pool from ' + name + '.'; } }
  ];
  function ruleFor(category) {
    var c = (category || '').toLowerCase();
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      if (hasAny.apply(null, [c].concat(rule.keys))) return rule;
    }
    return null;
  }
  function actionFor(p, capital, chain) {
    var rule = ruleFor(p.category);
    var fallback = 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
    return rule ? rule.first(p.name, capital, chain) : fallback;
  }
  function secondActionFor(p, capital, chain) {
    var rule = ruleFor(p.category);
    var fallback = 'Make a second, different action on ' + p.name + ' — a swap, a deposit or a vote — from the same wallet a week later.';
    return rule ? rule.second(p.name, capital, chain) : fallback;
  }
  function stepText(step) {
    var joined = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (joined.length > 600) joined = joined.slice(0, 596) + '...';
    if (joined.length < 20) joined = joined + " Hold the position and check the protocol's own page.";
    return joined;
  }
  function farmSteps(p) {
    var chain = homeChain(p);
    var capital = stakeSize(p);
    var hold = holdDays(p.age_days);
    function step(text, cost, time) { return { text: text, cost: cost, time: time }; }
    return [
      step('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      step(actionFor(p, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      step(secondActionFor(p, capital, chain), 'about $2 to $5 of gas, plus the small amount moved', '10 minutes, one week after the first deposit'),
      step('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week', '10 minutes a week'),
      step('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      step("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
      step('Decide in advance when you unwind — for example, when a token launches or TVL falls by half — and withdraw in two steps so one failed transaction never strands the position. Write the wallet, the dates and every transaction in a farm log.', 'nothing but the log', '5 minutes to plan, 15 minutes to exit')
    ].map(stepText);
  }

  // ---- the view state, carried in the URL hash ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var q = params.get('q');
    if (q) view.q = q;
    var slug = params.get('p');
    if (slug) view.selected = slug;
    var cat = params.get('category');
    if (cat) view.category = cat;
    var chain = params.get('chain');
    if (chain) view.chain = chain;
    if (params.get('wl')) view.wl = params.get('wl') === '1';
    var tab = params.get('tab');
    if (tab) view.tab = tab;
  }
  function writeHash() {
    var params = new URLSearchParams();
    var entries = [
      ['q', view.q],
      ['category', view.category === 'all' ? '' : view.category],
      ['chain', view.chain === 'all' ? '' : view.chain],
      ['wl', view.wl ? '1' : ''],
      ['tab', view.tab === 'pre-token' ? '' : view.tab],
      ['p', view.selected || '']
    ];
    entries.forEach(function (pair) { if (pair[1]) params.set(pair[0], pair[1]); });
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- filtering and sorting ----
  // Every filter is one test; a row shows only when all of them pass.
  function visibleRows() {
    var needle = view.q.trim().toLowerCase();
    var tests = [
      function (r) { return view.category === 'all' || r.category === view.category; },
      function (r) { return view.chain === 'all' || (r.chains || []).indexOf(view.chain) >= 0; },
      function (r) { return !view.wl || ON_WATCHLIST[r.slug]; },
      function (r) {
        if (!needle) return true;
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(needle) >= 0;
      }
    ];
    return SET.rows.filter(function (r) {
      for (var i = 0; i < tests.length; i++) if (!tests[i](r)) return false;
      return true;
    });
  }
  // One value per column, reading what the column shows; a missing value sorts to
  // the end whichever way the column runs, and an unknown key falls back to implied.
  var SORT_VALUE = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? Number.NEGATIVE_INFINITY : r.change_7d; },
    age: function (r) { return r.age_days === null ? Number.POSITIVE_INFINITY : r.age_days; },
    chains: function (r) { return (r.chains || []).length; },
    implied: function (r) { return r.implied_value_usd; }
  };
  function orderedRows(list) {
    var pick = SORT_VALUE[view.sort] || SORT_VALUE.implied;
    return list.slice().sort(function (a, b) {
      var x = pick(a), y = pick(b);
      if (x < y) return -view.dir;
      if (x > y) return view.dir;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
  }

  // ---- page sections ----
  function masthead() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + SET.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: SET.model_version + ' model' })
      )
    );
  }

  function intro() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: SET.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(SET.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + SET.early_size + ' pre-token protocols below that floor, each judged by the same rule. Implied value is a model, not a promise — and "no token" means no token on record, never proof there is none.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: SET.watchlist_size + ' / ' + SET.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(SET.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(SET.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Top 10 implied value' }), h('b', { text: money(SET.top10_implied_usd) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(SET.live_size) }))
      )
    );
  }

  function topThree() {
    var top = SET.rows.slice(0, 3);
    return h('section', { class: 'spotlight', 'aria-label': 'Top three protocols' },
      top.map(function (r) {
        return h('button', { type: 'button', class: 'spot', onclick: function () { openDetail(r.slug); } },
          h('span', { class: 'rank', text: 'Rank ' + r.rank }),
          h('b', { text: r.name }),
          h('span', { class: 'val', text: money(r.implied_value_usd) + ' implied' }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + money(r.tvl_usd) + ' TVL · ' + pct(r.change_7d) + ' in 7d' })
        );
      })
    );
  }

  // One option per value, plus the "all" option first; the current value is marked.
  function optionNodes(values, current, allLabel) {
    var nodes = [h('option', { value: 'all', text: allLabel })];
    values.forEach(function (v) {
      nodes.push(h('option', { value: v, text: v, selected: v === current ? 'selected' : null }));
    });
    return nodes;
  }
  function fieldShell(label, control) {
    return h('div', { class: 'field' }, h('label', { for: control.id, text: label }), control);
  }
  function filterBar() {
    var cats = Array.from(new Set(SET.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(SET.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    var category = h('select', { id: 'category', 'aria-label': 'Filter by category' }, optionNodes(cats, view.category, 'All categories'));
    category.addEventListener('change', function () { view.category = category.value; writeHash(); render(); });
    var chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, optionNodes(chains, view.chain, 'All chains'));
    chain.addEventListener('change', function () { view.chain = chain.value; writeHash(); render(); });
    var wlBox = h('input', { type: 'checkbox', id: 'wl', checked: view.wl ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wlBox.addEventListener('change', function () { view.wl = wlBox.checked; writeHash(); render(); });
    var preTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var liveTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    var shown = view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : SET.live.length + ' live-token protocols';
    return h('div', { class: 'controls' },
      fieldShell('Search', search),
      fieldShell('Category', category),
      fieldShell('Chain', chain),
      h('label', { class: 'check', for: 'wl' }, wlBox, 'Watchlist only'),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, preTab, liveTab)),
      h('span', { class: 'count', text: shown })
    );
  }

  function sortableHead(key, label) {
    var marker = view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null;
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () {
        if (view.sort === key) view.dir = -view.dir;
        else { view.sort = key; view.dir = -1; }
        render();
      } }, label, marker)
    );
  }

  function boardRow(r, max) {
    var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
    return h('tr', {
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      h('td', { class: 'num' }, h('span', { class: 'rank-badge' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) })),
      h('td', null, h('div', { class: 'name' },
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
      )),
      h('td', { class: 'num', text: money(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: ageLabel(r.age_days) }),
      h('td', { class: 'num', text: String((r.chains || []).length) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + width + '%' })),
        h('span', { class: 'num', text: money(r.implied_value_usd) })
      )),
      h('td', null, h('span', { class: 'status', text: ON_WATCHLIST[r.slug] ? 'watchlist · no token' : 'early · no token' }))
    );
  }

  function boardPanel() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.wl = false; writeHash(); render(); } })
      ));
    }
    // The bar scale is the whole filtered list's largest implied value, not the
    // first row's: the first row is only the largest while the board is sorted by
    // implied value, and any other sort used to stretch every bar past the panel.
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var body = h('tbody');
    list.forEach(function (r) { body.appendChild(boardRow(r, max)); });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortableHead('implied', 'Rank'),
            sortableHead('name', 'Protocol'),
            sortableHead('tvl', 'TVL'),
            sortableHead('growth', '7d'),
            sortableHead('age', 'Age'),
            sortableHead('chains', 'Chains'),
            sortableHead('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          body
        )
      )
    );
  }

  function livePanel() {
    var body = h('tbody');
    SET.live.forEach(function (r) {
      // No seven-day change reported is neither a gain nor a loss: it takes no colour.
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      body.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
          body
        )
      )
    );
  }

  function modelExplainer() {
    var m = SET.model;
    var parts = [
      'implied = round( tvl_usd x ' + m.base_multiple,
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
      ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')',
      ' x (1 + ' + m.breadth_per_chain + ' x min(chains, ' + m.breadth_max_chains + ')) )'
    ];
    var signals = [
      ['TVL — the size of the prize', 'A quarter of total value locked is the base. Bigger protocols have more value to share with a token.'],
      ['Seven-day growth — momentum', 'Growth is clamped to -60% … +120% and weighted by half, so one wild week cannot carry a row.'],
      ['Age with no token — the track record', 'How long the protocol has run since first listed, capped at three years; an unlisted age uses ' + m.unknown_age_days + ' days.'],
      ['Chain breadth — reach', 'Each chain up to five adds 3%, at most +15%: more chains mean a wider future holder base and more surface to farm on.']
    ];
    var grid = h('div', { class: 'signals' });
    signals.forEach(function (pair) {
      grid.appendChild(h('div', { class: 'signal' }, h('b', { text: pair[0] }), h('p', { text: pair[1] })));
    });
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, parts.join('')),
      grid,
      h('p', { class: 'sub', text: 'The board applies the watchlist rule to every row: no token on record, and no wrapped, staked or bridged product of a token that already trades. The early radar adds every rankable protocol below the floor — above it, the house rule already spoke. Implied value is this entry\u2019s own claim, never a price and never a prediction that a token will be issued.' })
    );
  }

  function pageFoot() {
    return h('footer', { class: 'foot' },
      h('span', { text: 'Source: ' + SET.source }),
      h('span', { text: 'Snapshot ' + SET.as_of + ' · ' + SET.board_size + ' pre-token rows · model ' + SET.model_version + ' · rendered with no network.' }),
      h('span', { text: 'A protocol "records no token" when DefiLlama records none for it; that is not proof it has none. Farming a protocol carries smart-contract and market risk — never farm with money you cannot lose.' })
    );
  }

  // ---- the detail drawer ----
  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; document.title = HOME_TITLE; writeHash(); });

  function detailHead(row) {
    var tag = 'Rank ' + row.rank + ' of ' + SET.board_size + (ON_WATCHLIST[row.slug] ? ' · watchlist' : ' · early radar');
    return h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: tag }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
  }

  function detailValue(row, recomputed) {
    var pairs = [
      ['TVL', money(row.tvl_usd)],
      ['Seven-day growth', pct(row.change_7d)],
      ['Age with no token', ageLabel(row.age_days)],
      ['Chains', String((row.chains || []).length)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Breadth multiplier', String(row.breadth_multiplier)]
    ];
    var grid = h('div', { class: 'equation' });
    pairs.forEach(function (pair) {
      grid.appendChild(h('div', null, h('span', { text: pair[0] }), h('b', { class: 'num', text: pair[1] })));
    });
    grid.appendChild(h('div', { class: 'total' }, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) })));
    var verdict = recomputed === row.implied_value_usd
      ? ', the same number board.json carries.'
      : ', which differs from the board: the data would be stale.';
    return h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('p', { class: 'why', text: row.why || '' }),
      grid,
      h('p', { class: 'sub', text: 'Model ' + SET.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + verdict + ' This is an estimate, not a price.' })
    );
  }

  function detailPlan(steps) {
    var items = steps.map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var action = cut >= 0 ? s.slice(0, cut) : s;
      var rest = cut >= 0 ? s.slice(cut + 1) : '';
      return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: rest }));
    });
    return h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, items)
    );
  }

  function openDetail(slug) {
    var row = null;
    SET.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    view.selected = slug;
    document.title = 'Token Radar: ' + row.name + ' — rank ' + row.rank;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(detailHead(row));
    dialog.appendChild(detailValue(row, recompute(row, SET.model)));
    dialog.appendChild(detailPlan(farmSteps(row)));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- render ----
  function render() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    var sections = [masthead(), intro(), topThree(), filterBar(), view.tab === 'pre-token' ? boardPanel() : livePanel()];
    if (view.tab === 'pre-token') sections.push(modelExplainer());
    sections.push(pageFoot());
    sections.forEach(function (s) { shell.appendChild(s); });
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
