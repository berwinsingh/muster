import * as path from 'path';
import * as vscode from 'vscode';
import { scanCommandSuggestions } from '../config/commandSuggestions';
import { normalizeConfigIds } from '../config/slugify';
import { substituteVariables } from '../config/loader';
import {
  detectPythonVenvs,
  suggestPrependForService,
  venvPathFromActivateFile,
} from '../config/runtimeDetect';
import { ServiceConfig } from '../config/schema';
import { WritableWorkspaceConfig, getExampleConfig, readWritableWorkspaceConfig, saveWorkspaceConfig } from '../config/writer';
import { getDevStackWorkspaceFolder } from '../config/workspaceFolder';
import { openConfigEditor } from './configEditor';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'save'; config: WritableWorkspaceConfig }
  | { type: 'browseFolder'; requestId: string; current?: string }
  | { type: 'browseFile'; requestId: string; current?: string }
  | { type: 'browseVenv'; requestId: string; cwd?: string }
  | { type: 'detectRuntime'; requestId: string; cwd?: string; command?: string; service?: Partial<ServiceConfig> }
  | { type: 'createVenv'; cwd?: string }
  | { type: 'openJson' }
  | { type: 'runGroup'; groupId: string };

let activePanel: vscode.WebviewPanel | undefined;

function getWebviewHtml(webview: vscode.Webview): string {
  const codiconsUri = 'https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css';
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
    `font-src ${webview.cspSource} https://cdn.jsdelivr.net`,
    `script-src 'nonce-devstack-wizard'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DevStack Config</title>
  <link rel="stylesheet" href="${codiconsUri}" />
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .page-header {
      padding: 20px 20px 0;
      flex-shrink: 0;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 4px;
      letter-spacing: -0.01em;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin: 0;
      font-size: 13px;
    }
    .page-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px 88px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      align-items: center;
    }
    button, .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.icon-btn {
      background: transparent;
      color: var(--vscode-foreground);
      padding: 4px;
      border-radius: 4px;
      min-width: 24px;
      min-height: 24px;
      justify-content: center;
    }
    button.icon-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    button.icon-btn.danger:hover {
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
    }
    .groups { display: flex; flex-direction: column; gap: 12px; }
    .group-card {
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      background: var(--vscode-editor-background);
      overflow: hidden;
    }
    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: var(--vscode-sideBar-background);
      cursor: pointer;
      user-select: none;
    }
    .group-header h2 {
      flex: 1;
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .chevron {
      color: var(--vscode-descriptionForeground);
      transition: transform 0.2s ease;
      font-size: 14px;
    }
    .group-card.expanded .chevron { transform: rotate(90deg); }
    .group-body {
      padding: 16px 20px;
      display: none;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .group-card.expanded .group-body { display: block; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .field-row.three { grid-template-columns: 1fr 1fr 1fr; }
    @media (max-width: 640px) { .field-row, .field-row.three { grid-template-columns: 1fr; } }
    label {
      display: block;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    input, select, textarea {
      width: 100%;
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }
    input[data-field="svc-command"], .prepend-lines {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    .input-with-btn { display: flex; gap: 8px; align-items: stretch; }
    .input-with-btn input { flex: 1; }
    .services { margin-top: 16px; }
    .services-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .services-header h3 {
      font-size: 11px;
      font-weight: 500;
      margin: 0;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .service-card {
      border: 1px solid var(--vscode-widget-border);
      border-left: 3px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 10px;
      background: var(--vscode-sideBar-background);
    }
    .service-card.status-ready { border-left-color: var(--vscode-testing-iconPassed, #73c991); }
    .service-card.status-incomplete { border-left-color: var(--vscode-editorWarning-foreground, #cca700); }
    .service-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .service-header strong { font-size: 13px; font-weight: 600; }
    .suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .chip {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 999px;
      cursor: pointer;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border: 1px solid var(--vscode-widget-border);
      font-family: inherit;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .chip:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    .status {
      padding: 8px 12px;
      border-radius: 6px;
      margin: 0 20px 12px;
      display: none;
      font-size: 13px;
    }
    .status.success {
      display: block;
      background: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
    }
    .status.error {
      display: block;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    .empty {
      text-align: center;
      padding: 48px 24px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-widget-border);
      border-radius: 8px;
      background: var(--vscode-sideBar-background);
    }
    .empty-icon {
      font-size: 32px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.6;
      margin-bottom: 12px;
      display: block;
    }
    .empty p { margin: 0; font-size: 13px; }
    .empty strong { color: var(--vscode-foreground); font-weight: 600; }
    .sticky-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-widget-border);
      flex-wrap: wrap;
      z-index: 10;
    }
    .footer-spacer { flex: 1; }
    .footer-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
    }
    .footer-link {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      opacity: 0.7;
      background: none;
      border: none;
      padding: 0;
      text-decoration: underline;
      font-family: inherit;
    }
    .footer-link:hover { opacity: 1; color: var(--vscode-textLink-foreground); }
    select[multiple] { min-height: 72px; }
    .id-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .id-row code {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      background: var(--vscode-textBlockQuote-background);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .advanced-toggle {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      margin-left: auto;
      opacity: 0.85;
    }
    .advanced-toggle:hover { opacity: 1; }
    .advanced-field { display: none; margin-bottom: 12px; }
    .advanced-field.visible { display: block; }
    .runtime-section {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 6px;
      border: 1px solid var(--vscode-widget-border);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .runtime-section h4 {
      margin: 0 0 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
    }
    .alert-warning {
      font-size: 12px;
      color: var(--vscode-inputValidation-warningForeground);
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 10px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .env-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .prepend-lines { min-height: 56px; resize: vertical; }
    .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .field-block { margin-bottom: 12px; }
  </style>
</head>
<body>
  <header class="page-header">
    <h1>DevStack Configuration</h1>
    <p class="subtitle">Configure server groups and services for your workspace</p>
  </header>
  <div id="status" class="status"></div>
  <main class="page-body">
    <div class="toolbar">
      <button id="addGroup"><span class="codicon codicon-add"></span> Add Group</button>
      <button class="secondary" id="importExample"><span class="codicon codicon-cloud-download"></span> Import Example</button>
    </div>
    <div id="groups" class="groups"></div>
    <div id="empty" class="empty" style="display:none">
      <span class="codicon codicon-server-process empty-icon"></span>
      <p>No server groups yet.<br/>Click <strong>Add Group</strong> to create your first stack.</p>
    </div>
  </main>
  <footer class="sticky-footer">
    <button id="save"><span class="codicon codicon-save"></span> Save</button>
    <button class="secondary" id="saveAndRun" style="display:none"><span class="codicon codicon-play"></span> Save &amp; Run</button>
    <span class="footer-spacer"></span>
    <span class="footer-hint">Saved to .vscode/devstack.json</span>
    <button type="button" class="footer-link" id="openJson">Advanced JSON</button>
  </footer>
  <script nonce="devstack-wizard">
    const vscode = acquireVsCodeApi();
    let state = { version: '1.0.0', groups: [], monitoring: undefined };
    let suggestions = [];
    let expandedGroups = new Set();
    let showAdvanced = new Set();
    let runtimeCache = {};

    function slugify(text) {
      return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
    }

    function shortUuid() {
      return Math.random().toString(36).slice(2, 8);
    }

    function generateGroupId(label) {
      return slugify(label || 'group') + '-' + shortUuid();
    }

    function generateServiceId(name) {
      return slugify(name || 'service') + '-' + shortUuid();
    }

    function advKey(gi, si) {
      return si !== undefined ? gi + ':' + si : String(gi);
    }

    function showStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status ' + type;
      setTimeout(() => { el.className = 'status'; }, 4000);
    }

    function copyId(text) {
      navigator.clipboard?.writeText(text).then(() => showStatus('ID copied.', 'success'));
    }

    function requestRuntimeDetect(gi, si) {
      const svc = state.groups[gi]?.services?.[si];
      if (!svc) return;
      const requestId = gi + ':' + si;
      vscode.postMessage({
        type: 'detectRuntime',
        requestId,
        cwd: svc.cwd,
        command: svc.command,
        service: {
          python: svc.python,
          node: svc.node,
          shell: svc.shell,
        },
      });
    }

    function renderRuntimeSection(gi, si, svc) {
      const key = gi + ':' + si;
      const rt = runtimeCache[key] || {};
      const venvs = rt.venvs || [];
      const selectedVenv = svc.python?.venv || (venvs.includes('.venv') ? '.venv' : venvs[0] || '');
      const prependLines = (svc.shell?.prepend || rt.prepend || []).join('\\n');
      const warning = rt.warning;

      let html = '<div class="runtime-section" data-runtime="' + key + '">';
      html += '<h4>Runtime Environment</h4>';

      if (warning) {
        html += '<div class="alert-warning"><span class="codicon codicon-warning"></span><span>' + esc(warning) + '</span></div>';
      }

      if (venvs.length) {
        html += '<div style="margin-bottom:8px"><label>Python environment</label>' +
          '<select data-field="svc-venv" data-gi="' + gi + '" data-si="' + si + '">' +
          venvs.map(v => '<option value="' + esc(v) + '"' + (v === selectedVenv ? ' selected' : '') + '>' + esc(v) + '</option>').join('') +
          '</select></div>';
      } else if (rt.needsPython) {
        html += '<div class="env-actions">' +
          '<button type="button" class="secondary" data-action="create-venv" data-gi="' + gi + '" data-si="' + si + '">Create venv here</button>' +
          '<button type="button" class="secondary" data-action="browse-venv" data-gi="' + gi + '" data-si="' + si + '">Browse venv</button>' +
          '</div>';
      }

      if (rt.nodeRuntime?.nvmrc || rt.nodeRuntime?.engines) {
        const nv = svc.node?.version || rt.nodeRuntime.nvmrc || rt.nodeRuntime.engines || '';
        html += '<div style="margin-bottom:8px"><label>Node version (nvm)</label>' +
          '<input data-field="svc-nodeVersion" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(nv) + '" placeholder="18" />' +
          '<p class="hint">Prepends nvm use before command</p></div>';
      }

      html += '<div><label>Environment setup (run before command)</label>' +
        '<textarea class="prepend-lines" rows="3" data-field="svc-prepend" data-gi="' + gi + '" data-si="' + si + '" placeholder="source .venv/bin/activate">' +
        esc(prependLines) + '</textarea></div>';
      html += '</div>';
      return html;
    }

    function renderSuggestions(serviceIdx, groupIdx, cwd) {
      const filtered = suggestions.filter(s => !s.cwd || !cwd || s.cwd === cwd || cwd.includes(s.cwd.replace('\${workspaceFolder}', ''))).slice(0, 6);
      return filtered.map(s =>
        '<button type="button" class="chip" data-cmd="' + esc(s.command) + '" data-gi="' + groupIdx + '" data-si="' + serviceIdx + '">' + esc(s.label) + '</button>'
      ).join('');
    }

    function esc(s) {
      if (s === undefined || s === null) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    }

    function render() {
      const container = document.getElementById('groups');
      const empty = document.getElementById('empty');
      const saveAndRun = document.getElementById('saveAndRun');
      container.innerHTML = '';

      if (!state.groups.length) {
        empty.style.display = 'block';
        saveAndRun.style.display = 'none';
        return;
      }
      empty.style.display = 'none';
      saveAndRun.style.display = 'inline-block';

      state.groups.forEach((group, gi) => {
        const expanded = expandedGroups.has(gi);
        const advGroup = showAdvanced.has('g:' + gi);
        const card = document.createElement('div');
        card.className = 'group-card' + (expanded ? ' expanded' : '');
        card.innerHTML =
          '<div class="group-header" data-gi="' + gi + '">' +
            '<span class="chevron codicon codicon-chevron-right"></span>' +
            '<h2>' + esc(group.label || group.id || 'Untitled Group') + '</h2>' +
            '<button type="button" class="icon-btn danger" data-action="delete-group" data-gi="' + gi + '" title="Delete group"><span class="codicon codicon-trash"></span></button>' +
          '</div>' +
          '<div class="group-body">' +
            '<div class="id-row">' +
              '<span>ID: <code>' + esc(group.id) + '</code></span>' +
              '<button type="button" class="icon-btn secondary" data-action="copy-id" data-id="' + esc(group.id) + '" title="Copy ID"><span class="codicon codicon-copy"></span></button>' +
              '<span class="advanced-toggle" data-action="toggle-advanced" data-scope="g:' + gi + '">' + (advGroup ? 'Hide advanced' : 'Advanced') + '</span>' +
            '</div>' +
            '<div class="advanced-field' + (advGroup ? ' visible' : '') + '">' +
              '<label>Group ID (advanced)</label>' +
              '<input data-field="id" data-gi="' + gi + '" value="' + esc(group.id) + '" />' +
            '</div>' +
            '<div class="field-row">' +
              '<div><label>Label</label><input data-field="label" data-gi="' + gi + '" value="' + esc(group.label) + '" /></div>' +
              '<div><label>Layout</label><select data-field="layout" data-gi="' + gi + '">' +
                ['dedicated','aggregated','split'].map(l => '<option value="' + l + '"' + (group.layout===l?' selected':'') + '>' + l + '</option>').join('') +
              '</select></div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div><label>Start Order</label><select data-field="order" data-gi="' + gi + '">' +
                ['parallel','sequence'].map(o => '<option value="' + o + '"' + (group.order===o?' selected':'') + '>' + o + '</option>').join('') +
              '</select></div>' +
            '</div>' +
            '<div class="services">' +
              '<div class="services-header"><h3>Services</h3></div>' +
              '<div class="service-list" data-gi="' + gi + '"></div>' +
              '<button type="button" class="secondary" data-action="add-service" data-gi="' + gi + '"><span class="codicon codicon-add"></span> Add Service</button>' +
            '</div>' +
          '</div>';
        container.appendChild(card);

        const serviceList = card.querySelector('.service-list');
        (group.services || []).forEach((svc, si) => {
          const advSvc = showAdvanced.has('s:' + gi + ':' + si);
          const depOptions = (group.services || []).filter(s => s.id !== svc.id).map(s =>
            '<option value="' + esc(s.id) + '"' + ((svc.dependsOn||[]).includes(s.id)?' selected':'') + '>' + esc(s.name || s.id) + '</option>'
          ).join('');
          const svcEl = document.createElement('div');
          const statusClass = svc.command?.trim() ? 'status-ready' : 'status-incomplete';
          svcEl.className = 'service-card ' + statusClass;
          svcEl.innerHTML =
            '<div class="service-header"><strong>' + esc(svc.name || ('Service ' + (si+1))) + '</strong>' +
            '<button type="button" class="icon-btn danger" data-action="delete-service" data-gi="' + gi + '" data-si="' + si + '" title="Delete service"><span class="codicon codicon-trash"></span></button></div>' +
            '<div class="id-row">' +
              '<span>ID: <code>' + esc(svc.id) + '</code></span>' +
              '<button type="button" class="icon-btn secondary" data-action="copy-id" data-id="' + esc(svc.id) + '" title="Copy ID"><span class="codicon codicon-copy"></span></button>' +
              '<span class="advanced-toggle" data-action="toggle-advanced" data-scope="s:' + gi + ':' + si + '">' + (advSvc ? 'Hide advanced' : 'Advanced') + '</span>' +
            '</div>' +
            '<div class="advanced-field' + (advSvc ? ' visible' : '') + '">' +
              '<label>Service ID (advanced)</label>' +
              '<input data-field="svc-id" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(svc.id) + '" />' +
            '</div>' +
            '<div class="field-row">' +
              '<div><label>Name</label><input data-field="svc-name" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(svc.name) + '" /></div>' +
            '</div>' +
            '<div class="field-block"><label>Working Directory</label>' +
              '<div class="input-with-btn">' +
                '<input data-field="svc-cwd" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(svc.cwd||'') + '" placeholder="\${workspaceFolder}" />' +
                '<button type="button" class="secondary" data-action="browse-folder" data-gi="' + gi + '" data-si="' + si + '">Browse</button>' +
              '</div></div>' +
            '<div class="field-block"><label>Command</label>' +
              '<input data-field="svc-command" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(svc.command||'') + '" placeholder="npm run dev" />' +
              '<div class="suggestions">' + renderSuggestions(si, gi, svc.cwd) + '</div></div>' +
            renderRuntimeSection(gi, si, svc) +
            '<div class="field-row" style="margin-top:8px">' +
              '<div><label>Env File (optional)</label>' +
                '<div class="input-with-btn">' +
                  '<input data-field="svc-envFile" data-gi="' + gi + '" data-si="' + si + '" value="' + esc(svc.envFile||'') + '" />' +
                  '<button class="secondary" data-action="browse-file" data-gi="' + gi + '" data-si="' + si + '">Browse</button>' +
                '</div></div>' +
              '<div><label>Delay (ms)</label><input type="number" min="0" data-field="svc-delayMs" data-gi="' + gi + '" data-si="' + si + '" value="' + (svc.delayMs||'') + '" /></div>' +
            '</div>' +
            '<div style="margin-top:8px"><label>Depends On (Ctrl+click)</label>' +
              '<select multiple data-field="svc-dependsOn" data-gi="' + gi + '" data-si="' + si + '">' + depOptions + '</select></div>';
          serviceList.appendChild(svcEl);
        });
      });
    }

    function detectAllServices() {
      state.groups.forEach((group, gi) => {
        (group.services || []).forEach((_, si) => requestRuntimeDetect(gi, si));
      });
    }

    function collectState() {
      document.querySelectorAll('[data-field="id"]').forEach(el => {
        const gi = +el.dataset.gi;
        state.groups[gi].id = el.value.trim() || state.groups[gi].id;
      });
      document.querySelectorAll('[data-field="label"]').forEach(el => {
        state.groups[+el.dataset.gi].label = el.value.trim();
      });
      document.querySelectorAll('[data-field="layout"]').forEach(el => {
        state.groups[+el.dataset.gi].layout = el.value;
      });
      document.querySelectorAll('[data-field="order"]').forEach(el => {
        state.groups[+el.dataset.gi].order = el.value;
      });
      document.querySelectorAll('[data-field="svc-id"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        state.groups[gi].services[si].id = el.value.trim() || state.groups[gi].services[si].id;
      });
      document.querySelectorAll('[data-field="svc-name"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const name = el.value.trim();
        state.groups[gi].services[si].name = name;
      });
      document.querySelectorAll('[data-field="svc-cwd"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        state.groups[gi].services[si].cwd = el.value.trim() || undefined;
      });
      document.querySelectorAll('[data-field="svc-command"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        state.groups[gi].services[si].command = el.value.trim();
      });
      document.querySelectorAll('[data-field="svc-envFile"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        state.groups[gi].services[si].envFile = el.value.trim() || undefined;
      });
      document.querySelectorAll('[data-field="svc-delayMs"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const v = el.value.trim();
        state.groups[gi].services[si].delayMs = v ? parseInt(v, 10) : undefined;
      });
      document.querySelectorAll('[data-field="svc-dependsOn"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const selected = Array.from(el.selectedOptions).map(o => o.value);
        state.groups[gi].services[si].dependsOn = selected.length ? selected : undefined;
      });
      document.querySelectorAll('[data-field="svc-venv"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const v = el.value.trim();
        if (v) {
          state.groups[gi].services[si].python = { venv: v };
        } else {
          delete state.groups[gi].services[si].python;
        }
      });
      document.querySelectorAll('[data-field="svc-nodeVersion"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const v = el.value.trim();
        if (v) {
          state.groups[gi].services[si].node = { version: v };
        } else {
          delete state.groups[gi].services[si].node;
        }
      });
      document.querySelectorAll('[data-field="svc-prepend"]').forEach(el => {
        const gi = +el.dataset.gi, si = +el.dataset.si;
        const lines = el.value.split('\\n').map(l => l.trim()).filter(Boolean);
        if (lines.length) {
          state.groups[gi].services[si].shell = { prepend: lines };
        } else {
          delete state.groups[gi].services[si].shell;
        }
      });
    }

    document.getElementById('addGroup').addEventListener('click', () => {
      collectState();
      const label = 'New Group';
      state.groups.push({
        id: generateGroupId(label), label, layout: 'dedicated', order: 'parallel',
        services: [{ id: generateServiceId('Service 1'), name: 'Service 1', command: '' }]
      });
      expandedGroups.add(state.groups.length - 1);
      render();
    });

    document.getElementById('importExample').addEventListener('click', () => {
      vscode.postMessage({ type: 'importExample' });
    });

    document.getElementById('openJson').addEventListener('click', () => {
      vscode.postMessage({ type: 'openJson' });
    });

    document.getElementById('save').addEventListener('click', () => {
      collectState();
      vscode.postMessage({ type: 'save', config: state });
    });

    document.getElementById('saveAndRun').addEventListener('click', () => {
      collectState();
      const groupId = state.groups[0]?.id;
      vscode.postMessage({ type: 'save', config: state, runGroupId: groupId });
    });

    let detectTimer = null;
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const field = t.dataset.field;
      if (field === 'svc-cwd' || field === 'svc-command') {
        clearTimeout(detectTimer);
        const gi = +t.dataset.gi, si = +t.dataset.si;
        detectTimer = setTimeout(() => {
          collectState();
          requestRuntimeDetect(gi, si);
        }, 400);
      }
    });

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.dataset.field === 'svc-venv') {
        collectState();
        requestRuntimeDetect(+t.dataset.gi, +t.dataset.si);
      }
    });

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.dataset.action === 'copy-id') {
        copyId(t.dataset.id || '');
        return;
      }
      if (t.dataset.action === 'toggle-advanced') {
        const scope = t.dataset.scope || '';
        if (showAdvanced.has(scope)) showAdvanced.delete(scope); else showAdvanced.add(scope);
        render();
        return;
      }
      if (t.dataset.action === 'delete-group') {
        collectState();
        state.groups.splice(+t.dataset.gi, 1);
        render();
        return;
      }
      if (t.dataset.action === 'add-service') {
        collectState();
        const gi = +t.dataset.gi;
        const n = state.groups[gi].services.length + 1;
        const name = 'Service ' + n;
        state.groups[gi].services.push({ id: generateServiceId(name), name, command: '' });
        render();
        detectAllServices();
        return;
      }
      if (t.dataset.action === 'delete-service') {
        collectState();
        state.groups[+t.dataset.gi].services.splice(+t.dataset.si, 1);
        render();
        return;
      }
      if (t.dataset.action === 'browse-folder') {
        const input = document.querySelector('[data-field="svc-cwd"][data-gi="' + t.dataset.gi + '"][data-si="' + t.dataset.si + '"]');
        vscode.postMessage({ type: 'browseFolder', requestId: t.dataset.gi + ':' + t.dataset.si, current: input?.value });
        return;
      }
      if (t.dataset.action === 'browse-file') {
        const input = document.querySelector('[data-field="svc-envFile"][data-gi="' + t.dataset.gi + '"][data-si="' + t.dataset.si + '"]');
        vscode.postMessage({ type: 'browseFile', requestId: t.dataset.gi + ':' + t.dataset.si, current: input?.value });
        return;
      }
      if (t.dataset.action === 'browse-venv') {
        collectState();
        const svc = state.groups[+t.dataset.gi]?.services?.[+t.dataset.si];
        vscode.postMessage({ type: 'browseVenv', requestId: t.dataset.gi + ':' + t.dataset.si, cwd: svc?.cwd });
        return;
      }
      if (t.dataset.action === 'create-venv') {
        collectState();
        const svc = state.groups[+t.dataset.gi]?.services?.[+t.dataset.si];
        vscode.postMessage({ type: 'createVenv', cwd: svc?.cwd });
        return;
      }
      if (t.classList.contains('chip')) {
        const input = document.querySelector('[data-field="svc-command"][data-gi="' + t.dataset.gi + '"][data-si="' + t.dataset.si + '"]');
        if (input) {
          input.value = t.dataset.cmd;
          collectState();
          requestRuntimeDetect(+t.dataset.gi, +t.dataset.si);
        }
        return;
      }
      if (t.closest('.group-header') && !t.dataset.action && !t.closest('[data-action]')) {
        const gi = +t.closest('.group-header').dataset.gi;
        if (expandedGroups.has(gi)) expandedGroups.delete(gi); else expandedGroups.add(gi);
        render();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        state = msg.config;
        suggestions = msg.suggestions || [];
        if (state.groups.length) expandedGroups.add(0);
        render();
        detectAllServices();
      }
      if (msg.type === 'folderResult' || msg.type === 'fileResult') {
        const [gi, si] = msg.requestId.split(':');
        const field = msg.type === 'folderResult' ? 'svc-cwd' : 'svc-envFile';
        const input = document.querySelector('[data-field="' + field + '"][data-gi="' + gi + '"][data-si="' + si + '"]');
        if (input && msg.path) {
          input.value = msg.path;
          collectState();
          if (field === 'svc-cwd') requestRuntimeDetect(+gi, +si);
        }
      }
      if (msg.type === 'venvResult') {
        const [gi, si] = msg.requestId.split(':');
        if (msg.venvPath) {
          state.groups[+gi].services[+si].python = { venv: msg.venvPath };
          render();
        }
      }
      if (msg.type === 'runtimeResult') {
        runtimeCache[msg.requestId] = msg;
        const [gi, si] = msg.requestId.split(':');
        const svc = state.groups[+gi]?.services?.[+si];
        if (!svc) return;
        if (msg.prepend?.length && !svc.shell?.prepend?.length) {
          svc.shell = { prepend: msg.prepend };
        }
        if (msg.selectedVenv && !svc.python?.venv) {
          svc.python = { venv: msg.selectedVenv };
        }
        if (msg.nodeVersion && !svc.node?.version) {
          svc.node = { version: msg.nodeVersion };
        }
        render();
      }
      if (msg.type === 'saved') {
        showStatus('Configuration saved successfully.', 'success');
      }
      if (msg.type === 'error') {
        showStatus(msg.message, 'error');
      }
      if (msg.type === 'exampleImported') {
        state = msg.config;
        expandedGroups = new Set([0]);
        render();
        showStatus('Example configuration loaded — click Save to write.', 'success');
      }
      if (msg.type === 'venvCreated') {
        showStatus('Virtual environment created — re-detecting...', 'success');
        detectAllServices();
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function toWorkspaceRelativePath(
  workspaceFolder: vscode.WorkspaceFolder,
  absolutePath: string
): string {
  const root = workspaceFolder.uri.fsPath;
  if (absolutePath.startsWith(root)) {
    const rel = absolutePath.slice(root.length).replace(/^[/\\]/, '');
    return rel ? `\${workspaceFolder}/${rel.replace(/\\/g, '/')}` : '${workspaceFolder}';
  }
  return absolutePath;
}

function resolveServiceCwd(
  cwd: string | undefined,
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const resolved = cwd
    ? substituteVariables(cwd, workspaceFolder)
    : workspaceFolder.uri.fsPath;
  return path.resolve(resolved);
}

function toVenvConfigPath(
  venvAbsPath: string,
  serviceCwd: string,
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const relToCwd = path.relative(serviceCwd, venvAbsPath).replace(/\\/g, '/');
  if (relToCwd && !relToCwd.startsWith('..')) {
    return relToCwd;
  }
  return toWorkspaceRelativePath(workspaceFolder, venvAbsPath);
}

export async function openVisualConfigEditor(
  context: vscode.ExtensionContext,
  onSaved?: () => void
): Promise<void> {
  const folder = getDevStackWorkspaceFolder();
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to configure DevStack.');
    return;
  }

  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.One);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'devstackConfigWizard',
    'DevStack Configuration',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  activePanel = panel;
  panel.iconPath = new vscode.ThemeIcon('server-process');

  panel.webview.html = getWebviewHtml(panel.webview);

  const sendInit = async (): Promise<void> => {
    const config = await readWritableWorkspaceConfig(folder);
    const suggestions = scanCommandSuggestions(folder);
    panel.webview.postMessage({ type: 'init', config, suggestions });
  };

  panel.webview.onDidReceiveMessage(async (msg: WebviewMessage & { runGroupId?: string; importExample?: boolean }) => {
    if (msg.type === 'ready') {
      await sendInit();
      return;
    }

    if (msg.type === 'openJson') {
      await openConfigEditor();
      return;
    }

    if ((msg as { type: string }).type === 'importExample') {
      panel.webview.postMessage({ type: 'exampleImported', config: getExampleConfig() });
      return;
    }

    if (msg.type === 'browseFolder') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri: folder.uri,
        openLabel: 'Select Folder',
      });
      const path = uris?.[0]
        ? toWorkspaceRelativePath(folder, uris[0].fsPath)
        : undefined;
      panel.webview.postMessage({ type: 'folderResult', requestId: msg.requestId, path });
      return;
    }

    if (msg.type === 'browseFile') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        defaultUri: folder.uri,
        openLabel: 'Select Env File',
        filters: { 'Env files': ['env', 'local'] },
      });
      const path = uris?.[0]
        ? toWorkspaceRelativePath(folder, uris[0].fsPath)
        : undefined;
      panel.webview.postMessage({ type: 'fileResult', requestId: msg.requestId, path });
      return;
    }

    if (msg.type === 'browseVenv') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: false,
        canSelectFiles: true,
        canSelectMany: false,
        defaultUri: folder.uri,
        openLabel: 'Select activate script',
        filters: { 'Activate script': ['activate', 'bat'] },
      });
      if (!uris?.[0]) {
        return;
      }
      const activatePath = uris[0].fsPath;
      const venvAbs = venvPathFromActivateFile(activatePath);
      const serviceCwd = resolveServiceCwd(msg.cwd, folder);
      const venvPath = toVenvConfigPath(venvAbs, serviceCwd, folder);
      panel.webview.postMessage({
        type: 'venvResult',
        requestId: msg.requestId,
        venvPath,
      });
      return;
    }

    if (msg.type === 'detectRuntime') {
      const serviceCwd = resolveServiceCwd(msg.cwd, folder);
      const partial = msg.service ?? {};
      const suggestion = suggestPrependForService(
        {
          command: msg.command ?? '',
          python: partial.python,
          node: partial.node,
          shell: partial.shell,
        },
        serviceCwd
      );
      const selectedVenv =
        partial.python?.venv ??
        (suggestion.venvs.includes('.venv') ? '.venv' : suggestion.venvs[0]);
      const nodeVersion =
        partial.node?.version ?? suggestion.nodeRuntime.nvmrc ?? suggestion.nodeRuntime.engines;

      panel.webview.postMessage({
        type: 'runtimeResult',
        requestId: msg.requestId,
        venvs: suggestion.venvs,
        nodeRuntime: suggestion.nodeRuntime,
        prepend: suggestion.prepend,
        warning: suggestion.warning,
        selectedVenv,
        nodeVersion,
        needsPython:
          suggestion.venvs.length === 0 &&
          Boolean(suggestion.warning?.includes('virtual environment')),
      });
      return;
    }

    if (msg.type === 'createVenv') {
      const serviceCwd = resolveServiceCwd(msg.cwd, folder);
      const terminal = vscode.window.createTerminal({
        name: 'DevStack: Create venv',
        cwd: serviceCwd,
      });
      terminal.show();
      const createCmd =
        process.platform === 'win32'
          ? 'python -m venv .venv'
          : 'python3 -m venv .venv';
      terminal.sendText(createCmd, true);

      const waitForVenv = async (): Promise<void> => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (detectPythonVenvs(serviceCwd).includes('.venv')) {
            panel.webview.postMessage({ type: 'venvCreated' });
            return;
          }
        }
      };
      void waitForVenv();
      return;
    }

    if (msg.type === 'save') {
      try {
        const config = normalizeConfigIds(msg.config as WritableWorkspaceConfig);
        validateConfig(config);
        await saveWorkspaceConfig(folder, config);
        panel.webview.postMessage({ type: 'saved' });
        onSaved?.();

        const runGroupId = (msg as { runGroupId?: string }).runGroupId;
        if (runGroupId) {
          const savedGroup = config.groups.find((g) => g.id === runGroupId) ?? config.groups[0];
          if (savedGroup) {
            await vscode.commands.executeCommand('devstack.runGroup', savedGroup.id);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DevStack save failed: ${message}`);
        panel.webview.postMessage({
          type: 'error',
          message,
        });
      }
    }
  });

  panel.onDidDispose(() => {
    activePanel = undefined;
  });

  context.subscriptions.push(panel);
}

function validateConfig(config: WritableWorkspaceConfig): void {
  const ids = new Set<string>();
  for (const group of config.groups) {
    if (!group.id?.trim()) {
      throw new Error('Each group must have an ID.');
    }
    if (ids.has(group.id)) {
      throw new Error(`Duplicate group ID: ${group.id}`);
    }
    ids.add(group.id);

    if (!group.services?.length) {
      throw new Error(`Group "${group.label}" must have at least one service.`);
    }

    const serviceIds = new Set<string>();
    for (const svc of group.services) {
      if (!svc.id?.trim() || !svc.name?.trim()) {
        throw new Error('Each service must have an ID and name.');
      }
      if (!svc.command?.trim()) {
        throw new Error(`Service "${svc.name}" must have a command.`);
      }
      if (serviceIds.has(svc.id)) {
        throw new Error(`Duplicate service ID "${svc.id}" in group "${group.label}"`);
      }
      serviceIds.add(svc.id);
    }
  }
}

export async function createGroupQuick(
  context: vscode.ExtensionContext,
  onSaved?: () => void
): Promise<void> {
  await openVisualConfigEditor(context, onSaved);
}

export async function importExampleConfig(
  context: vscode.ExtensionContext,
  onSaved?: () => void
): Promise<void> {
  const folder = getDevStackWorkspaceFolder();
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }

  const existing = await readWritableWorkspaceConfig(folder);
  if (existing.groups.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      'This will replace your current DevStack groups. Continue?',
      'Replace',
      'Cancel'
    );
    if (choice !== 'Replace') {
      return;
    }
  }

  await saveWorkspaceConfig(folder, getExampleConfig());
  vscode.window.showInformationMessage('DevStack example configuration imported.');
  onSaved?.();
  await openVisualConfigEditor(context, onSaved);
}

export function editGroupInWizard(
  context: vscode.ExtensionContext,
  groupId: string,
  onSaved?: () => void
): void {
  void openVisualConfigEditor(context, onSaved);
  // Group focus could be added via postMessage after init
  void groupId;
}
