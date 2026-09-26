import { css } from "lit";

/** Shared element styles for use inside component shadow roots. */
export const base = css`
  * { box-sizing: border-box; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: var(--muted); }
  .mono { font-family: var(--mono); }

  .pill { padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--line-strong); white-space: nowrap; color: var(--text); }
  .badge { border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 9px; font-size: 11px; white-space: nowrap; color: var(--muted); }
  .badge.ok { color: var(--ok); border-color: #2ea043; background: #3fb9501a; }
  .badge.missing { color: var(--warn); border-color: #9e6a03; background: #e3b3411a; }

  /* Buttons: one system — default (secondary), .primary, .sm modifier. */
  button {
    font: inherit; line-height: 1.2; cursor: pointer; color: var(--text);
    background: var(--panel-2); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 6px 12px;
    transition: background .12s, border-color .12s, color .12s;
  }
  button:hover { background: var(--panel-3); border-color: var(--line-strong); }
  button:active { background: #1a212b; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.sm { padding: 4px 9px; font-size: 12px; }
  button:disabled { opacity: .5; cursor: default; }

  input, select, textarea {
    font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 6px 9px; width: 100%;
  }
  input::placeholder, textarea::placeholder { color: #6b7686; }
  input:hover, select:hover, textarea:hover { border-color: var(--line-strong); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  input[type="file"] { padding: 4px; color: var(--muted); background: var(--panel-2); }
  label { display: block; color: var(--muted); font-size: 11px; margin: 9px 0 3px; }

  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line-soft); font-weight: 400; vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; border-bottom-color: var(--line); }
  tbody tr:last-child td { border-bottom: 0; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td { background: var(--panel-3); }
  tr.active td { background: var(--accent-soft); }

  pre { white-space: pre-wrap; word-break: break-word; font: 11px/1.5 var(--mono); margin: 0; color: #aab6c6; }

  * { scrollbar-width: thin; scrollbar-color: #3a4553 #0f141b; }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: #0f141b; }
  *::-webkit-scrollbar-thumb { background: #3a4553; border-radius: 6px; border: 2px solid #0f141b; }
  *::-webkit-scrollbar-thumb:hover { background: #4a5766; }
`;
