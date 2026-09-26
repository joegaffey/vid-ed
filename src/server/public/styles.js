import { css } from "lit";

/** Shared element styles for use inside component shadow roots. */
export const base = css`
  * { box-sizing: border-box; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: var(--muted); }
  .mono { font-family: var(--mono); }

  .pill { padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--line); white-space: nowrap; }
  .badge { border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; font-size: 11px; white-space: nowrap; }
  .badge.ok { color: var(--ok); border-color: #238636; background: #3fb95010; }
  .badge.missing { color: var(--warn); border-color: #9e6a03; background: #d2992210; }

  button {
    font: inherit; cursor: pointer; color: var(--text);
    background: var(--panel-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 5px 11px; transition: background .12s, border-color .12s;
  }
  button:hover { background: #1d2430; border-color: #39424f; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }
  button.primary:hover { background: #6ba0ff; }
  button:disabled { opacity: .5; cursor: default; }

  input, select, textarea {
    font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px 9px; width: 100%;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  input[type="file"] { padding: 4px; color: var(--muted); }
  label { display: block; color: var(--muted); font-size: 11px; margin: 9px 0 3px; }

  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line-soft); font-weight: 400; vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  tbody tr:last-child td { border-bottom: 0; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td { background: #1a2029; }
  tr.active td { background: var(--accent-soft); }

  pre { white-space: pre-wrap; word-break: break-word; font: 11px/1.5 var(--mono); margin: 0; color: #9da7b3; }

  * { scrollbar-width: thin; scrollbar-color: #2c3542 #0f141b; }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: #0f141b; }
  *::-webkit-scrollbar-thumb { background: #2c3542; border-radius: 6px; border: 2px solid #0f141b; }
  *::-webkit-scrollbar-thumb:hover { background: #3a4553; }
`;
