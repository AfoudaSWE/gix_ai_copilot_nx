/**
 * The Studio page (§5, §69-71, §79). One self-contained document: no build step, no external
 * requests, a nonce-gated inline script and style (strict CSP), and every dynamic value
 * rendered with `textContent`, never `innerHTML`. Colors follow the GIX identity: charcoal,
 * black, steel gray, white and GIX red.
 */
export interface StudioPageOptions {
  readonly token: string;
  readonly nonce: string;
  readonly basePath: string;
  readonly devtoolsUrl?: string;
  /** Same-origin path of the copilot runtime the live preview talks to. */
  readonly copilotRuntimeUrl?: string;
  readonly systemInstructionsNotice: string;
}

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const STYLES = `
:root{--black:#0b0c0e;--charcoal:#16181c;--panel:#1f2227;--raised:#282c33;--steel:#3a3f47;--steel-light:#9aa1ab;--white:#f5f6f7;--red:#e11d2e;--red-strong:#ff4757;--ok:#3fb950;--warn:#d29922;--err:#ff6b6b;--radius:8px;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--charcoal);color:var(--white);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--white)}
:focus-visible{outline:2px solid var(--red-strong);outline-offset:2px}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;z-index:10;background:var(--black);padding:8px}
header{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--black);border-bottom:2px solid var(--red)}
header h1{font-size:16px;margin:0;letter-spacing:.04em}header h1 span{color:var(--red-strong)}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--steel);font-size:12px}
.badge.dev{background:var(--red);color:#fff}.badge.ok{background:#1f4d2b}.badge.warning{background:#5c4410}.badge.error{background:#6b1d24}.badge.not-run,.badge.unknown{background:var(--steel)}
.hint{margin-left:auto;color:var(--steel-light);font-size:12px}
.layout{display:grid;grid-template-columns:210px minmax(0,1fr) 300px;min-height:calc(100vh - 52px)}
nav{background:var(--black);padding:12px 0;border-right:1px solid var(--steel)}
nav button{display:block;width:100%;text-align:left;padding:10px 20px;background:none;border:0;border-left:3px solid transparent;color:var(--white);font:inherit;cursor:pointer}
nav button[aria-current=page]{border-left-color:var(--red);background:var(--panel);font-weight:600}
nav button:hover{background:var(--panel)}
main{padding:20px 24px;min-width:0}
aside{background:var(--panel);border-left:1px solid var(--steel);padding:16px}
h2{font-size:20px;margin:0 0 12px}h3{font-size:15px;margin:20px 0 8px;color:var(--steel-light);text-transform:uppercase;letter-spacing:.06em}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--steel);border-radius:var(--radius);padding:14px}
.card .label{color:var(--steel-light);font-size:12px}.card .value{font-size:18px;font-weight:600;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--steel);vertical-align:top;overflow-wrap:anywhere}th{color:var(--steel-light);font-weight:600}
.rows td:first-child{color:var(--steel-light)}
button.primary,button.secondary,button.danger{font:inherit;border-radius:6px;padding:7px 14px;cursor:pointer;border:1px solid var(--steel)}
button.primary{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}button.secondary{background:var(--raised);color:var(--white)}button.danger{background:transparent;color:var(--err);border-color:var(--err)}
button:disabled{opacity:.45;cursor:not-allowed}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--steel);margin-bottom:12px}
.tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--white);padding:8px 12px;font:inherit;cursor:pointer}.tabs button[aria-selected=true]{border-bottom-color:var(--red);font-weight:600}
label{display:block;margin:10px 0 4px;color:var(--steel-light);font-size:12px}
input,select,textarea{font:inherit;color:var(--white);background:var(--black);border:1px solid var(--steel);border-radius:6px;padding:6px 8px;width:100%;max-width:520px}
input[type=checkbox]{width:auto}input[type=color]{width:48px;height:32px;padding:2px}
textarea{min-height:90px}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:0 16px}
.notice{border-left:3px solid var(--warn);background:#2a2412;padding:8px 12px;margin:8px 0}
.notice.info{border-left-color:var(--steel-light);background:var(--raised)}.notice.error{border-left-color:var(--err);background:#2a1216}
pre{background:var(--black);border:1px solid var(--steel);border-radius:6px;padding:10px;overflow:auto;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:480px}
.diff .add{color:#7ee787}.diff .del{color:#ff8f8f}.diff .hunk{color:var(--steel-light)}
details{margin:6px 0}summary{cursor:pointer;padding:4px 0}
.status{min-height:24px;margin:8px 0;color:var(--steel-light)}
.health td:last-child{text-align:right}
dialog{background:var(--panel);color:var(--white);border:1px solid var(--red);border-radius:var(--radius);width:min(560px,92vw);padding:0}
dialog::backdrop{background:rgba(0,0,0,.6)}
dialog input{max-width:none;border:0;border-bottom:1px solid var(--steel);border-radius:0;padding:14px}
dialog ul{list-style:none;margin:0;padding:6px;max-height:320px;overflow:auto}dialog li{padding:8px 12px;border-radius:6px;cursor:pointer}dialog li[aria-selected=true]{background:var(--red);color:#fff}
.muted{color:var(--steel-light)}
.with-preview{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,440px);gap:20px;align-items:start}
.preview-frame{width:100%;height:700px;border:1px solid var(--steel);border-radius:var(--radius);background:var(--black)}
@media (max-width:1400px){.with-preview{grid-template-columns:1fr}}
@media (max-width:1100px){.layout{grid-template-columns:190px minmax(0,1fr)}aside{grid-column:1 / -1;border-left:0;border-top:1px solid var(--steel)}}
@media (max-width:720px){.layout{grid-template-columns:1fr}nav{display:flex;overflow-x:auto;padding:0;border-right:0}nav button{width:auto;white-space:nowrap;border-left:0;border-bottom:3px solid transparent}nav button[aria-current=page]{border-bottom-color:var(--red)}main{padding:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (forced-colors:active){button.primary,nav button[aria-current=page]{border:2px solid CanvasText}}
`;

const SCRIPT = String.raw`
'use strict';
var BASE = document.body.getAttribute('data-base');
var TOKEN = document.querySelector('meta[name="gix-studio-token"]').getAttribute('content');
var DEVTOOLS = document.body.getAttribute('data-devtools') || '';
var NOTICE = document.body.getAttribute('data-notice');
var RUNTIME = document.body.getAttribute('data-runtime') || '';
var currentPreview = null;

// --- Live preview (§7): the real @gixcopilot/ui in a same-origin frame ---------------------
function flatten(value, prefix, out) {
  out = out || {};
  Object.keys(value || {}).forEach(function (key) {
    var v = value[key];
    var path = prefix ? prefix + '.' + key : key;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out); else out[path] = v;
  });
  return out;
}
function previewFrame(getSettings) {
  var frame = h('iframe', { src: BASE + '/preview/' + (RUNTIME ? '?runtime=' + encodeURIComponent(RUNTIME) : ''), title: 'Live copilot preview', className: 'preview-frame' });
  var preview = { frame: frame, send: function () { if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'gix-preview-settings', settings: getSettings() }, location.origin); } };
  currentPreview = preview;
  return preview;
}
window.addEventListener('message', function (event) {
  if (event.origin === location.origin && event.data && event.data.type === 'gix-preview-ready' && currentPreview && event.source === currentPreview.frame.contentWindow) currentPreview.send();
});
var main = document.getElementById('main');
var live = document.getElementById('live');
var state = { view: 'overview', sub: {}, discovery: null, proposalId: null, comparison: null };

function h(tag, props) {
  var el = document.createElement(tag);
  props = props || {};
  Object.keys(props).forEach(function (key) {
    var value = props[key];
    if (value === undefined || value === null || value === false) return;
    if (key === 'text') el.textContent = String(value);
    else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
    else if (key === 'className') el.className = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  });
  for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}
function append(el, child) {
  if (child === undefined || child === null || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
  el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
}
function say(message) { live.textContent = message; }
async function api(method, path, body) {
  var headers = { 'x-gix-studio-token': TOKEN };
  if (body !== undefined) headers['content-type'] = 'application/json';
  var res = await fetch(BASE + '/api' + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) { var error = new Error((data && data.error && data.error.message) || res.statusText); error.data = data; throw error; }
  return data;
}
async function run(label, fn) {
  say(label + '…');
  try { var result = await fn(); say(label + ': done.'); refreshDiagnostics(); return result; }
  catch (error) { say(label + ' failed: ' + error.message); refreshDiagnostics(); throw error; }
}
function table(headers, rows) {
  if (rows.length === 0) return h('p', { className: 'muted', text: 'Nothing found.' });
  return h('table', {}, h('thead', {}, h('tr', {}, headers.map(function (x) { return h('th', { scope: 'col', text: x }); }))), h('tbody', {}, rows.map(function (r) { return h('tr', {}, r.map(function (c) { return h('td', {}, c === undefined || c === null ? '' : c); })); })));
}
function badge(status, text) { return h('span', { className: 'badge ' + status, text: text || status }); }
function card(label, value) { return h('div', { className: 'card' }, h('div', { className: 'label', text: label }), h('div', { className: 'value', text: value })); }
function tabs(key, list, current, onChange) {
  return h('div', { className: 'tabs', role: 'tablist', 'aria-label': key }, list.map(function (t) {
    return h('button', { role: 'tab', 'aria-selected': t[0] === current ? 'true' : 'false', text: t[1], onclick: function () { state.sub[key] = t[0]; onChange(); } });
  }));
}
function field(label, input) { var id = 'f-' + Math.random().toString(36).slice(2); input.id = id; return h('div', {}, h('label', { for: id, text: label }), input); }
function count(d) { return d.apis.reduce(function (n, s) { return n + s.operations.length; }, 0); }

// --- Diagnostics (persistent, §25) ------------------------------------------------------
async function refreshDiagnostics() {
  var panel = document.getElementById('diagnostics');
  try {
    var d = await api('GET', '/diagnostics');
    // replaceChildren does not flatten arrays (it would stringify them), so build one flat list.
    panel.replaceChildren.apply(panel, [h('h2', { text: 'Diagnostics' }), h('p', { className: 'muted', text: 'Stage: ' + d.stage })].concat(
      ['runtime', 'discovery', 'generation', 'apply'].flatMap(function (group) {
        return [h('h3', { text: group }), h('table', { className: 'health' }, h('tbody', {}, d[group].map(function (r) {
          return h('tr', { title: r.detail || '' }, h('td', { text: r.label }), h('td', {}, badge(r.status, r.value === undefined ? r.status : String(r.value))));
        })))];
      })));
  } catch (error) { panel.replaceChildren(h('h2', { text: 'Diagnostics' }), h('p', { className: 'notice error', text: error.message })); }
}

// --- Views ------------------------------------------------------------------------------
var views = {
  overview: async function () {
    var s = await api('GET', '/status');
    var d = await api('GET', '/diagnostics');
    var disc = state.discovery;
    var find = function (group, key) { var r = d[group].find(function (x) { return x.key === key; }); return r ? r.value : undefined; };
    return [h('h2', { text: 'GIX Copilot' }),
      h('div', { className: 'cards' }, card('Project', s.project), card('Environment', s.environment), card('Runtime', find('runtime', 'runtime') || '—'), card('Model', s.model.provider + ' — ' + (find('runtime', 'provider') || ''))),
      h('h3', { text: 'Project' }),
      disc ? h('div', { className: 'cards' }, card('Discovery', 'Complete'), card('APIs', count(disc)), card('Components', disc.components.length), card('Permissions', disc.permissions.length), card('Context Candidates', disc.contextCandidates.length))
           : h('p', { className: 'muted', text: 'The project has not been discovered yet.' }),
      h('h3', { text: 'Copilot' }),
      h('div', { className: 'cards' }, card('Registered Tools', find('runtime', 'registered-tools') === undefined ? '—' : find('runtime', 'registered-tools')), card('Generated Tools', find('apply', 'generated-tools')), card('Context Sources', find('apply', 'context-sources')), card('Generative UI', find('apply', 'generative-ui'))),
      h('h3', { text: 'Pending' }),
      h('div', { className: 'cards' }, card('Pending Proposals', s.pendingProposals), card('Security Warnings', find('generation', 'security-warnings')), card('Conflicts', find('generation', 'conflicts'))),
      h('div', { className: 'actions' },
        h('button', { className: 'primary', text: 'Discover Project', onclick: function () { commands.discoverProject(); } }),
        h('button', { className: 'secondary', text: 'Generate Tools', onclick: function () { go('generators'); } }),
        h('button', { className: 'secondary', text: 'Review Proposals', onclick: function () { go('review'); } }),
        h('button', { className: 'secondary', text: 'Test Copilot', onclick: function () { commands.testCopilot(); } }))];
  },

  configuration: async function () {
    var sub = state.sub.config || 'models';
    var body;
    if (sub === 'models') {
      var m = await api('GET', '/config/model');
      var provider = h('input', { value: m.provider, autocomplete: 'off', list: 'providers' });
      var model = h('input', { value: m.model, autocomplete: 'off' });
      var key = h('input', { type: 'password', autocomplete: 'new-password', placeholder: m.configured ? 'Configured (' + m.keySource + '). Leave empty to keep it.' : 'Not configured' });
      var baseUrl = h('input', { value: m.baseUrl || '', placeholder: 'Optional', autocomplete: 'off' });
      var timeout = h('input', { type: 'number', min: '1000', value: m.timeoutMs || '' });
      var retries = h('input', { type: 'number', min: '0', max: '10', value: m.retries === undefined ? '' : m.retries });
      var result = h('div', { className: 'status', role: 'status' });
      var save = async function () {
        var input = { provider: provider.value.trim(), model: model.value.trim() };
        if (key.value) input.apiKey = key.value;
        if (baseUrl.value.trim()) input.baseUrl = baseUrl.value.trim();
        if (timeout.value) input.timeoutMs = Number(timeout.value);
        if (retries.value !== '') input.retries = Number(retries.value);
        await run('Save model settings', function () { return api('PUT', '/config/model', input); });
        key.value = '';
      };
      body = [h('p', { className: 'notice info', text: 'The API key is sent to the development server only, kept in its memory for this session, and never returned to the browser or written to generated code.' }),
        h('datalist', { id: 'providers' }, m.providers.map(function (p) { return h('option', { value: p }); })),
        h('div', { className: 'grid2' }, field('Provider', provider), field('Model', model), field('API Key', key), field('Base URL', baseUrl), field('Timeout (ms)', timeout), field('Retries', retries)),
        h('div', { className: 'actions' }, h('button', { className: 'primary', text: 'Save', onclick: save }),
          h('button', { className: 'secondary', text: 'Test Connection', onclick: async function () {
            var r = await run('Test connection', function () { return api('POST', '/config/model/test', {}); });
            result.replaceChildren(r.success ? badge('ok', 'Connected') : badge('error', 'Failed'), ' ' + r.provider + ' / ' + r.model + ' · ' + r.latencyMs + ' ms' + (r.error ? ' · ' + r.error.code + ': ' + r.error.message : ''));
          } })), result];
    } else if (sub === 'copilot' || sub === 'appearance') {
      var cfg = await api('GET', '/config');
      var current = cfg.copilot || {};
      var get = function (path) { return path.split('.').reduce(function (n, k) { return n && typeof n === 'object' ? n[k] : undefined; }, current); };
      var inputs = {};
      var text = function (path, label, opts) { var el = (opts && opts.area) ? h('textarea', {}) : h('input', { type: (opts && opts.type) || 'text' }); var v = get(path); if (v !== undefined) el.value = Array.isArray(v) ? v.join('\n') : v; inputs[path] = el; return field(label, el); };
      var check = function (path, label) { var el = h('input', { type: 'checkbox' }); el.checked = get(path) === true; inputs[path] = el; return h('div', {}, h('label', {}, el, ' ' + label)); };
      var choice = function (path, label, list) { var el = h('select', {}, h('option', { value: '', text: '(unchanged)' }), list.map(function (x) { return h('option', { value: x, text: x }); })); if (get(path)) el.value = get(path); inputs[path] = el; return field(label, el); };
      var fields = sub === 'copilot'
        ? [text('copilot.name', 'Name'), text('copilot.description', 'Description'), text('copilot.defaultModel', 'Default model (provider:model)'), text('copilot.welcomeMessage', 'Welcome message'),
           h('div', {}, text('copilot.systemInstructions', 'System instructions', { area: true }), h('p', { className: 'notice', text: NOTICE })),
           text('copilot.suggestions', 'Suggestions (one per line)', { area: true }), check('copilot.streaming', 'Streaming'), check('copilot.attachments', 'Attachments (only if your app implements them)')]
        : [text('appearance.name', 'Copilot name'), text('appearance.title', 'Title'), text('appearance.subtitle', 'Subtitle'), text('appearance.welcomeMessage', 'Welcome message'), text('appearance.placeholder', 'Placeholder'),
           text('appearance.logo', 'Logo URL'), text('appearance.assistantAvatar', 'Assistant avatar URL'),
           ['primary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'error'].map(function (c) { return text('appearance.colors.' + c, c.charAt(0).toUpperCase() + c.slice(1) + ' color', { type: 'text' }); }),
           choice('appearance.theme', 'Theme', ['light', 'dark', 'system']), choice('appearance.layout', 'Layout', ['popup', 'sidebar', 'embedded']), choice('appearance.position', 'Position', ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'right', 'left']),
           text('appearance.width', 'Width (e.g. 380px)'), text('appearance.height', 'Height (e.g. 600px)'), text('appearance.radius', 'Radius (e.g. 12px)')];
      var propose = async function () {
        var values = {};
        Object.keys(inputs).forEach(function (path) {
          var el = inputs[path];
          if (el.type === 'checkbox') { if (el.checked !== (get(path) === true)) values[path] = el.checked; return; }
          var v = el.value.trim();
          if (v === '') return;
          values[path] = path === 'copilot.suggestions' ? v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean) : v;
        });
        var p = await run('Propose configuration', function () { return api('POST', '/config/copilot', { values: values }); });
        state.proposalId = p.id; go('review');
      };
      var form = h('div', {}, h('div', { className: 'grid2' }, fields), h('div', { className: 'actions' }, h('button', { className: 'primary', text: 'Propose changes', onclick: propose })));
      if (sub === 'appearance') {
        var live = function () {
          var values = flatten(current);
          Object.keys(inputs).forEach(function (path) { var el = inputs[path]; if (el.type === 'checkbox') values[path] = el.checked; else if (el.value.trim() !== '') values[path] = path === 'copilot.suggestions' ? el.value.split('\n').filter(Boolean) : el.value.trim(); });
          return values;
        };
        var preview = previewFrame(live);
        form.addEventListener('input', preview.send);
        form.addEventListener('change', preview.send);
        body = [h('p', { className: 'notice info', text: 'The preview is the real @gixcopilot/ui and updates as you type. Saved values go to .gix/copilot.config.json through review.' }), h('div', { className: 'with-preview' }, form, preview.frame)];
      } else body = [form];
    } else {
      var c = await api('GET', '/config');
      var sec = c.security;
      body = [h('p', { className: 'notice info', text: 'This view describes the existing @gixcopilot/security setup. The Studio has no security system of its own.' }),
        h('table', { className: 'rows' }, h('tbody', {}, [['Action Firewall', sec.firewall ? 'Enabled' : 'Not configured'], ['Default Policy', sec.defaultPolicy || '—'], ['Approval Policy', sec.approvalPolicy || '—'], ['PII Protection', sec.piiProtection === undefined ? '—' : (sec.piiProtection ? 'On' : 'Off')], ['Audit', sec.audit === undefined ? '—' : (sec.audit ? 'On' : 'Off')]].map(function (r) { return h('tr', {}, h('td', { text: r[0] }), h('td', { text: r[1] })); }))),
        h('h3', { text: 'Tool Policies' }),
        table(['Tool', 'Risk', 'Approval', 'Permissions'], sec.toolPolicies.map(function (t) { var s = t.security || {}; return [t.name, s.risk || '—', s.approval || '(risk default)', (s.requiredPermissions || []).join(', ')]; })),
        h('h3', { text: 'Resolved configuration (secrets redacted)' }), h('pre', { text: JSON.stringify(c.layers, null, 2) })];
    }
    return [h('h2', { text: 'Configuration' }), tabs('config', [['models', 'Models'], ['copilot', 'Copilot'], ['appearance', 'Appearance'], ['security', 'Security']], sub, render), body];
  },

  discovery: async function () {
    if (!state.discovery) { try { state.discovery = await api('GET', '/discovery'); } catch (e) { state.discovery = null; } }
    var d = state.discovery;
    var sub = state.sub.discovery || 'project';
    var discover = function (section, label) { return h('button', { className: section === 'project' ? 'primary' : 'secondary', text: label, onclick: async function () { await run(label, function () { return api('POST', '/discovery/' + section, {}); }); state.discovery = await api('GET', '/discovery'); state.sub.discovery = section === 'security' ? 'auth' : section; render(); } }); };
    var actions = h('div', { className: 'actions' }, discover('project', 'Discover Project'), discover('apis', 'Discover APIs'), discover('components', 'Discover Components'), discover('context', 'Discover Context'), discover('security', 'Discover Auth & Permissions'), discover('knowledge', 'Discover Knowledge'),
      h('button', { className: 'secondary', text: 'Re-scan Project', onclick: async function () { var r = await run('Re-scan', function () { return api('POST', '/discovery/rescan', {}); }); state.discovery = r.discovery; state.comparison = r.comparison || null; state.sub.discovery = 'changes'; render(); } }));
    var head = [h('h2', { text: 'Discovery' }), h('p', { className: 'muted', text: 'Discovery is read-only: it never modifies your files, and secret files are never read.' }), actions];
    if (!d) return head.concat([h('p', { className: 'muted', text: 'Not run yet.' })]);
    var content;
    if (sub === 'project') {
      var fw = function (role) { return d.frameworks.filter(function (f) { return f.role === role; }).map(function (f) { return f.id; }).join(', ') || '—'; };
      content = [h('div', { className: 'cards' }, card('Workspace', d.workspace.kind + ' · ' + d.workspace.packageManager), card('Frontend', fw('frontend')), card('Backend', fw('backend')), card('Language', d.workspace.language)),
        h('h3', { text: 'Discovered' }),
        h('table', { className: 'rows' }, h('tbody', {}, [['Applications', d.applications.length], ['Libraries', d.libraries.length], ['API Operations', count(d)], ['Routes', d.routes.length], ['Components', d.components.length], ['Context Candidates', d.contextCandidates.length], ['Permissions', d.permissions.length], ['Knowledge Sources', d.knowledgeSources.length], ['Test files', d.tests.files], ['Files scanned', d.workspace.filesScanned]].map(function (r) { return h('tr', {}, h('td', { text: r[0] }), h('td', { text: r[1] })); }))),
        h('h3', { text: 'Existing GIX integration' }), h('p', { text: d.gix.packages.length ? d.gix.packages.join(', ') : 'No @gixcopilot packages found.' }),
        h('h3', { text: 'Diagnostics' }), table(['Severity', 'Code', 'Message', 'File'], d.diagnostics.map(function (x) { return [badge(x.severity === 'error' ? 'error' : x.severity === 'warning' ? 'warning' : 'not-run', x.severity), x.code, x.message, x.file || '']; }))];
    } else if (sub === 'apis') {
      var ops = []; d.apis.forEach(function (s) { s.operations.forEach(function (o) { ops.push(o); }); });
      content = table(['Method', 'Path', 'Source', 'Kind', 'Auth', 'Permissions'], ops.map(function (o) { return [o.method, o.path, o.source, o.sourceKind, o.authentication || '', o.permissions.join(', ')]; }));
    } else if (sub === 'components') {
      content = table(['Component', 'Framework', 'File', 'Candidate', 'Why'], d.components.map(function (c) { return [c.name, c.framework, c.file, c.candidate ? badge('ok', 'yes') : badge('not-run', 'no'), c.reason]; }));
    } else if (sub === 'context') {
      content = table(['Name', 'Kind', 'Evidence', 'File'], d.contextCandidates.map(function (c) { return [c.name, c.kind, c.evidence, c.file + (c.line ? ':' + c.line : '')]; }));
    } else if (sub === 'auth') {
      var a = d.authentication;
      content = [a ? h('table', { className: 'rows' }, h('tbody', {}, [['Mechanisms', a.mechanisms.join(', ') || '—'], ['Libraries', a.libraries.join(', ') || '—'], ['Token handling', a.tokenHandling.join('; ') || '—'], ['User model', a.userModel ? a.userModel.name + ' (' + a.userModel.file + ')' : '—'], ['Files', a.files.slice(0, 12).join(', ')]].map(function (r) { return h('tr', {}, h('td', { text: r[0] }), h('td', { text: r[1] })); }))) : h('p', { className: 'muted', text: 'No authentication found.' }),
        h('h3', { text: 'Permissions' }), table(['Permission', 'Value', 'File'], d.permissions.map(function (p) { return [p.name, p.value || '', p.file + (p.line ? ':' + p.line : '')]; }))];
    } else if (sub === 'knowledge') {
      content = [h('p', { className: 'muted', text: 'Candidates only. Nothing is indexed until you choose sources in Docs → Knowledge and apply.' }), table(['Path', 'Kind', 'Title', 'Size'], d.knowledgeSources.map(function (k) { return [k.path, k.kind, k.title || '', k.size]; }))];
    } else {
      var cmp = state.comparison;
      content = !cmp ? h('p', { className: 'muted', text: 'Re-scan to compare with the previous discovery.' }) : cmp.unchanged ? h('p', { text: 'No changes since the previous discovery.' }) :
        [['New APIs', cmp.newApis], ['Changed APIs', cmp.changedApis], ['Removed APIs', cmp.removedApis]].map(function (g) { return [h('h3', { text: g[0] + ' (' + g[1].length + ')' }), table(['Method', 'Path', 'Source'], g[1].map(function (o) { return [o.method, o.path, o.source]; }))]; })
          .concat([['New Components', cmp.newComponents], ['Changed Components', cmp.changedComponents]].map(function (g) { return [h('h3', { text: g[0] + ' (' + g[1].length + ')' }), table(['Component', 'File'], g[1].map(function (c) { return [c.name, c.file]; }))]; }))
          .concat([h('h3', { text: 'New Permissions (' + cmp.newPermissions.length + ')' }), h('p', { text: cmp.newPermissions.map(function (p) { return p.name; }).join(', ') }), h('h3', { text: 'New Context Candidates (' + cmp.newContextCandidates.length + ')' }), h('p', { text: cmp.newContextCandidates.map(function (c) { return c.name; }).join(', ') })]);
    }
    return head.concat([tabs('discovery', [['project', 'Project'], ['apis', 'APIs'], ['components', 'Components'], ['context', 'Context'], ['auth', 'Auth & Permissions'], ['knowledge', 'Knowledge'], ['changes', 'Changes']], sub, render), content]);
  },

  generators: async function () {
    var list = await api('GET', '/generators');
    if (!state.discovery) { try { state.discovery = await api('GET', '/discovery'); } catch (e) { state.discovery = null; } }
    var d = state.discovery;
    var cards = list.filter(function (g) { return g.id !== 'studio-configuration'; }).map(function (g) {
      var picks = null;
      var boxes = [];
      if (d && (g.id === 'api-tools' || g.id === 'openapi-tools')) {
        var seen = {};
        var ops = [];
        d.apis.forEach(function (s) { if ((g.id === 'openapi-tools') === (s.kind === 'openapi')) s.operations.forEach(function (o) { var k = o.method + ' ' + o.path; if (!seen[k]) { seen[k] = 1; ops.push(k); } }); });
        picks = h('details', {}, h('summary', { text: 'Select operations (' + ops.length + ')' }), ops.map(function (k) { var box = h('input', { type: 'checkbox', value: k }); box.checked = true; boxes.push(box); return h('div', {}, h('label', {}, box, ' ' + k)); }));
      }
      return h('div', { className: 'card' }, h('div', { className: 'value', text: g.title }), h('p', { className: 'muted', text: g.description }), picks,
        h('div', { className: 'actions' }, h('button', { className: 'primary', text: 'Generate proposal', disabled: !d, onclick: async function () {
          var body = boxes.length ? { select: boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }) } : {};
          var p = await run('Generate ' + g.title, function () { return api('POST', '/generators/' + g.id, body); });
          state.proposalId = p.id; go('review');
        } })));
    });
    return [h('h2', { text: 'Generators' }), h('p', { className: 'muted', text: 'Generators create proposals only. Nothing changes in your repository until you approve and apply.' }),
      d ? null : h('p', { className: 'notice', text: 'Discover the project first.' }),
      h('div', { className: 'actions' }, h('button', { className: 'secondary', text: 'Sync Copilot', onclick: async function () { var r = await run('Sync Copilot', function () { return api('POST', '/sync', {}); }); state.comparison = r.comparison || null; say('Sync created ' + r.proposals.length + ' proposal(s) for review.'); go('review'); } })),
      h('div', { className: 'cards' }, cards)];
  },

  review: async function () {
    var list = await api('GET', '/proposals');
    if (!state.proposalId && list.length) state.proposalId = list[0].id;
    var picker = list.length ? field('Proposal', h('select', { onchange: function (e) { state.proposalId = e.target.value; render(); } }, list.map(function (p) { var o = h('option', { value: p.id, text: p.title + ' — ' + p.status }); if (p.id === state.proposalId) o.selected = true; return o; }))) : h('p', { className: 'muted', text: 'No proposals yet. Use a generator to create one.' });
    if (!state.proposalId) return [h('h2', { text: 'Review' }), picker];
    var p = await api('GET', '/proposals/' + encodeURIComponent(state.proposalId));
    var editable = p.status === 'draft' || p.status === 'ready-for-review' || p.status === 'rejected';
    var edit = async function (collection, id, changes) { await run('Update proposal', function () { return api('PATCH', '/proposals/' + p.id, { edits: [{ collection: collection, id: id, changes: changes }] }); }); render(); };
    var sm = p.summary;
    var summary = h('table', { className: 'rows' }, h('tbody', {}, [['Files Created', sm.filesCreated], ['Files Modified', sm.filesModified], ['Files Removed', sm.filesRemoved], ['Configuration Changes', sm.configChanges], ['Tools Added', sm.toolsAdded], ['Tools Changed', sm.toolsChanged], ['Tools Disabled', sm.toolsDisabled], ['Context Added', sm.contextAdded], ['Generative UI Added', sm.uiAdded], ['Agents Added', sm.agentsAdded], ['Skills Added', sm.skillsAdded], ['Knowledge Added', sm.knowledgeAdded], ['Security Policies', sm.policiesAdded], ['Warnings', sm.warnings], ['Conflicts', sm.conflicts]].map(function (r) { return h('tr', {}, h('td', { text: r[0] }), h('td', { text: r[1] })); })));
    var select = function (collection, item) { var box = h('input', { type: 'checkbox', 'aria-label': 'Include ' + (item.name || item.key || item.tool || item.id), disabled: !editable }); box.checked = item.selected; box.addEventListener('change', function () { edit(collection, item.id, { selected: box.checked }); }); return box; };
    var choose = function (value, list, onChange) { var s = h('select', { disabled: !editable }, list.map(function (x) { return h('option', { value: x, text: x }); })); s.value = value; s.addEventListener('change', function () { onChange(s.value); }); return s; };
    var input = function (value, label, onChange) { var i = h('input', { value: value || '', 'aria-label': label, disabled: !editable }); i.addEventListener('change', function () { onChange(i.value); }); return i; };
    var sections = [];
    if (p.tools.length) sections.push(h('h3', { text: 'Tools' }), table(['Include', 'Name', 'Operation', 'Description', 'Risk', 'Permission', 'Approval', 'Enabled'], p.tools.map(function (t) {
      var en = h('input', { type: 'checkbox', 'aria-label': 'Enable ' + t.name, disabled: !editable }); en.checked = t.enabled; en.addEventListener('change', function () { edit('tools', t.id, { enabled: en.checked }); });
      return [select('tools', t), input(t.name, 'Tool name', function (v) { edit('tools', t.id, { name: v }); }), t.operation.method + ' ' + t.operation.path, input(t.description, 'Description', function (v) { edit('tools', t.id, { description: v }); }),
        choose(t.risk, ['read-only', 'write', 'destructive'], function (v) { edit('tools', t.id, { risk: v }); }), input(t.permission, 'Permission', function (v) { edit('tools', t.id, { permission: v || null }); }),
        choose(t.approval, ['none', 'user-confirmation', 'supervisor', 'admin', 'two-person'], function (v) { edit('tools', t.id, { approval: v }); }), en];
    })));
    [['context', 'Context', function (x) { return [x.name, x.kind, x.sensitivity, x.description]; }, ['Name', 'Kind', 'Sensitivity', 'Description']],
     ['ui', 'Generative UI', function (x) { return [x.name, x.framework, x.file, x.props.map(function (q) { return q.name + ': ' + q.type; }).join(', ')]; }, ['Component', 'Framework', 'File', 'Props']],
     ['agents', 'Agents', function (x) { return [x.name, x.description, x.tools.join(', ')]; }, ['Agent', 'Description', 'Tools']],
     ['skills', 'Skills', function (x) { return [x.name, x.description, x.tools.join(', ')]; }, ['Skill', 'Description', 'Tools']],
     ['knowledge', 'Knowledge', function (x) { return [x.name, x.description, x.sources.map(function (s) { return s.path; }).join(', ')]; }, ['Group', 'Description', 'Sources']],
     ['configChanges', 'Configuration Changes', function (x) { return [x.file, x.key, JSON.stringify(x.before === undefined ? null : x.before), JSON.stringify(x.after)]; }, ['File', 'Key', 'Before', 'After']],
     ['policies', 'Security Policies', function (x) { return [x.tool, x.risk, x.approval, x.requiredPermissions.join(', ')]; }, ['Tool', 'Risk', 'Approval', 'Permissions']]].forEach(function (g) {
      var items = p[g[0]];
      if (!items.length) return;
      var linked = g[0] === 'policies' && p.tools.length > 0;
      sections.push(h('h3', { text: g[1] }), table(['Include'].concat(g[3]), items.map(function (x) { return [linked ? (x.selected ? '✓' : '—') : select(g[0], x)].concat(g[2](x)); })));
    });
    var findings = p.securityReview.map(function (f) { return h('li', {}, badge(f.severity === 'error' ? 'error' : 'warning', f.severity), ' ' + f.message); });
    var diffs = p.diffs.map(function (f) {
      var pre = h('pre', { className: 'diff' }, f.diff.split('\n').map(function (line) { return h('span', { className: line.charAt(0) === '+' ? 'add' : line.charAt(0) === '-' ? 'del' : line.slice(0, 2) === '@@' ? 'hunk' : '', text: line + '\n' }); }));
      return h('details', {}, h('summary', { text: (f.kind === 'create' ? '+ ' : f.kind === 'delete' ? '- ' : '~ ') + f.path }), pre);
    });
    var result = p.applyResult;
    return [h('h2', { text: 'Review' }), picker,
      h('p', {}, badge(p.status === 'applied' ? 'ok' : p.status === 'failed' ? 'error' : p.status === 'approved' ? 'warning' : 'not-run', p.status), ' ', p.title),
      h('h3', { text: 'Proposed Changes' }), summary,
      findings.length ? [h('h3', { text: 'Security Review' }), h('ul', {}, findings)] : [h('h3', { text: 'Security Review' }), h('p', { text: 'No findings.' })],
      p.warnings.length ? [h('h3', { text: 'Warnings' }), h('ul', {}, p.warnings.map(function (w) { return h('li', { text: w.message }); }))] : null,
      p.conflicts.length ? [h('h3', { text: 'Conflicts' }), h('ul', {}, p.conflicts.map(function (c) { return h('li', { className: 'notice error', text: c.path + ': ' + c.message }); }))] : null,
      sections,
      h('h3', { text: 'Diff' }), diffs.length ? diffs : h('p', { className: 'muted', text: 'No files: select at least one item.' }),
      result ? [h('h3', { text: result.outcome === 'complete' ? 'APPLY COMPLETE' : result.outcome === 'aborted' ? 'NOT APPLIED' : 'APPLIED WITH VALIDATION ERRORS' }), h('p', { text: result.message }),
        table(['Check', 'Status', 'Detail'], result.validation.map(function (c) { return [c.name, badge(c.status === 'passed' ? 'ok' : c.status === 'failed' ? 'error' : 'not-run', c.status), c.detail ? h('pre', { text: c.detail }) : '']; }))] : null,
      h('div', { className: 'actions' },
        h('button', { className: 'danger', text: 'Reject All', disabled: !(p.status === 'draft' || p.status === 'ready-for-review'), onclick: async function () { await run('Reject', function () { return api('POST', '/proposals/' + p.id + '/reject', {}); }); render(); } }),
        h('button', { className: 'primary', text: 'Approve Selected Changes', disabled: p.status !== 'ready-for-review', onclick: async function () { try { await run('Approve', function () { return api('POST', '/proposals/' + p.id + '/approve', {}); }); } finally { render(); } } }),
        h('button', { className: 'primary', text: 'Apply', disabled: p.status !== 'approved', onclick: async function () { try { await run('Apply and validate', function () { return api('POST', '/proposals/' + p.id + '/apply', {}); }); } finally { render(); } } }),
        h('button', { className: 'secondary', text: 'Roll back this apply', disabled: !(p.status === 'applied' || p.status === 'failed') || !p.applyResult || p.applyResult.written.length === 0, onclick: async function () { var r = await run('Roll back', function () { return api('POST', '/proposals/' + p.id + '/rollback', {}); }); say('Restored ' + r.restored.length + ' file(s); left ' + r.skipped.length + ' changed file(s) untouched.'); } }))];
  },

  test: async function () {
    var cfg = await api('GET', '/config');
    var preview = previewFrame(function () { return flatten(cfg.copilot || {}); });
    return [h('h2', { text: 'Test Copilot' }),
      h('p', { className: RUNTIME ? 'muted' : 'notice', text: RUNTIME ? 'This is your copilot with its saved configuration. Messages go to the real runtime and through the Action Firewall.' : 'No copilot runtime is connected to the Studio, so messages will fail. Register the Studio with attachStudio(copilot) or pass copilotRuntimeUrl.' }),
      preview.frame];
  },

  devtools: async function () {
    var caps = await api('GET', '/capabilities');
    var inspectors = ['Events', 'Context', 'Tools', 'Agents', 'Security', 'Tokens', 'Trace'];
    return [h('h2', { text: 'DevTools' }),
      DEVTOOLS ? h('p', {}, 'Inspect runs in the Phase 11 DevTools: ', h('a', { href: DEVTOOLS, target: '_blank', rel: 'noopener', text: 'Open DevTools' }))
               : h('p', { className: 'notice info', text: 'DevTools is not linked. Enable @gixcopilot/devtools and pass devtoolsUrl to the Studio plugin.' }),
      h('ul', {}, inspectors.map(function (i) { return h('li', {}, DEVTOOLS ? h('a', { href: DEVTOOLS + '#' + i.toLowerCase(), target: '_blank', rel: 'noopener', text: i }) : i); })),
      h('h3', { text: 'Development plane' }), h('p', { className: 'muted', text: caps.note }),
      table(['Capability', 'Kind', 'Description'], caps.capabilities.map(function (c) { return [c.id, c.kind, c.description]; }))];
  }
};

async function render() {
  document.querySelectorAll('nav button').forEach(function (b) { if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  try { main.replaceChildren.apply(main, [].concat.apply([], [await views[state.view]()]).flat(Infinity).filter(Boolean)); }
  catch (error) { main.replaceChildren(h('p', { className: 'notice error', text: error.message })); }
}
function go(view) { state.view = view; render().then(function () { var heading = main.querySelector('h2'); if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); } }); }

var commands = {
  discoverProject: async function () { await run('Discover project', function () { return api('POST', '/discovery/project', {}); }); state.discovery = await api('GET', '/discovery'); state.sub.discovery = 'project'; go('discovery'); },
  discoverApis: async function () { await run('Discover APIs', function () { return api('POST', '/discovery/apis', {}); }); state.discovery = await api('GET', '/discovery'); state.sub.discovery = 'apis'; go('discovery'); },
  discoverComponents: async function () { await run('Discover components', function () { return api('POST', '/discovery/components', {}); }); state.discovery = await api('GET', '/discovery'); state.sub.discovery = 'components'; go('discovery'); },
  generateTools: function () { go('generators'); },
  generateContext: async function () { var p = await run('Generate context', function () { return api('POST', '/generators/state-context', {}); }); state.proposalId = p.id; go('review'); },
  reviewProposals: function () { go('review'); },
  runDiagnostics: function () { refreshDiagnostics(); document.getElementById('diagnostics').focus(); },
  testModel: function () { state.sub.config = 'models'; go('configuration'); },
  testCopilot: function () { go('test'); },
  openDevTools: function () { if (DEVTOOLS) window.open(DEVTOOLS, '_blank', 'noopener'); else go('devtools'); }
};
var palette = [['Discover Project', 'discoverProject'], ['Discover APIs', 'discoverApis'], ['Generate Tools', 'generateTools'], ['Generate Context', 'generateContext'], ['Discover Components', 'discoverComponents'], ['Review Proposals', 'reviewProposals'], ['Run Diagnostics', 'runDiagnostics'], ['Test Model', 'testModel'], ['Test Copilot', 'testCopilot'], ['Open DevTools', 'openDevTools']];

var dialog = document.getElementById('palette');
var search = document.getElementById('palette-input');
var listbox = document.getElementById('palette-list');
var active = 0;
function paletteItems() { var q = search.value.toLowerCase(); return palette.filter(function (c) { return c[0].toLowerCase().indexOf(q) >= 0; }); }
function drawPalette() {
  var items = paletteItems();
  active = Math.min(active, Math.max(items.length - 1, 0));
  listbox.replaceChildren.apply(listbox, items.map(function (c, i) { return h('li', { id: 'cmd-' + i, role: 'option', 'aria-selected': i === active ? 'true' : 'false', text: c[0], onclick: function () { choose(c); } }); }));
  search.setAttribute('aria-activedescendant', items.length ? 'cmd-' + active : '');
}
function choose(c) { dialog.close(); commands[c[1]](); }
function openPalette() { search.value = ''; active = 0; drawPalette(); dialog.showModal(); search.focus(); }
search.addEventListener('input', function () { active = 0; drawPalette(); });
search.addEventListener('keydown', function (e) {
  var items = paletteItems();
  if (e.key === 'ArrowDown') { active = (active + 1) % Math.max(items.length, 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % Math.max(items.length, 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter' && items[active]) { choose(items[active]); e.preventDefault(); }
});
document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dialog.open) dialog.close(); else openPalette(); } });
document.getElementById('palette-button').addEventListener('click', openPalette);
document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.view); }); });

api('GET', '/discovery').then(function (d) { state.discovery = d; }, function () {}).then(render);
refreshDiagnostics();
setInterval(refreshDiagnostics, 15000);
`;

export function renderStudioPage(options: StudioPageOptions): string {
  const nav = [
    ['overview', 'Overview'],
    ['configuration', 'Configuration'],
    ['discovery', 'Discovery'],
    ['generators', 'Generators'],
    ['review', 'Review'],
    ['test', 'Test Copilot'],
    ['devtools', 'DevTools'],
  ]
    .map(([view, label]) => `<button type="button" data-view="${view}">${label}</button>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="gix-studio-token" content="${escapeAttribute(options.token)}">
<title>GIX Developer Studio</title>
<style nonce="${escapeAttribute(options.nonce)}">${STYLES}</style>
</head>
<body data-base="${escapeAttribute(options.basePath)}" data-devtools="${escapeAttribute(options.devtoolsUrl ?? '')}" data-notice="${escapeAttribute(options.systemInstructionsNotice)}" data-runtime="${escapeAttribute(options.copilotRuntimeUrl ?? '')}">
<a class="skip" href="#main">Skip to content</a>
<header>
  <h1><span>GIX</span> Copilot · Developer Studio</h1>
  <span class="badge dev">Development only</span>
  <button type="button" class="secondary hint" id="palette-button" aria-keyshortcuts="Control+K Meta+K">Commands (Ctrl/⌘ K)</button>
</header>
<div class="layout">
  <nav aria-label="Studio sections">${nav}</nav>
  <main id="main" tabindex="-1" aria-live="off"></main>
  <aside id="diagnostics" aria-label="Diagnostics" tabindex="-1"><h2>Diagnostics</h2></aside>
</div>
<div id="live" class="status" role="status" aria-live="polite"></div>
<dialog id="palette" aria-label="Command palette">
  <input id="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Type a command…" autocomplete="off">
  <ul id="palette-list" role="listbox" aria-label="Commands"></ul>
</dialog>
<script nonce="${escapeAttribute(options.nonce)}">${SCRIPT}</script>
</body>
</html>
`;
}
