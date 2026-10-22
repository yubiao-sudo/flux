import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { onTermData, termClose, termResize, termSpawn, termWrite } from '../api';

const FLUX_TERM = {
  background: '#050607',
  foreground: '#d9d9d2',
  cursor: '#b8cfd2',
  cursorAccent: '#050607',
  selectionBackground: 'rgba(184, 207, 210, 0.24)',
  black: '#111417',
  red: '#d58e82',
  green: '#9fc2a8',
  yellow: '#d7c69a',
  blue: '#8fa8b8',
  magenta: '#b8a0b8',
  cyan: '#a8c8c4',
  white: '#d9d9d2',
  brightBlack: '#686e72',
  brightRed: '#e8aaa0',
  brightGreen: '#b8d8be',
  brightYellow: '#e6d8b0',
  brightBlue: '#aec4d2',
  brightMagenta: '#d0b8d0',
  brightCyan: '#c4ded9',
  brightWhite: '#f2f0e9',
};

const PRESETS = [
  { label: '当前目录', command: 'Get-Location' },
  { label: '文件列表', command: 'Get-ChildItem' },
  { label: 'Git 状态', command: 'git status' },
];

export default function TerminalWindow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let term: Terminal | null = null;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    try {
      term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        lineHeight: 1.42,
        letterSpacing: 0.2,
        fontFamily: "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace",
        scrollback: 6000,
        theme: FLUX_TERM,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      termRef.current = term;
      fitRef.current = fit;

      term.onData((data) => void termWrite(data));

      (async () => {
        try {
          unlisten = await onTermData((data) => term!.write(data));
          if (disposed) {
            unlisten();
            return;
          }
          fit.fit();
          void termResize(term!.rows, term!.cols);
          await termSpawn();
          if (!disposed) setStatus('ready');
        } catch (e) {
          if (!disposed) {
            setStatus('error');
            setErrorMsg(String(e));
          }
        }
      })();

      const onResize = () => {
        fit.fit();
        void termResize(term!.rows, term!.cols);
      };
      window.addEventListener('resize', onResize);

      return () => {
        disposed = true;
        window.removeEventListener('resize', onResize);
        if (unlisten) unlisten();
        void termClose();
        term!.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    } catch (e) {
      setStatus('error');
      setErrorMsg(String(e));
      return;
    }
  }, []);

  const send = (command: string) => {
    const term = termRef.current;
    if (!term) return;
    term.focus();
    void termWrite(command + '\r');
  };

  const clear = () => {
    termRef.current?.clear();
    termRef.current?.focus();
  };

  const copySelection = async () => {
    const selection = termRef.current?.getSelection();
    try {
      await navigator.clipboard.writeText(selection || '');
      setNote(selection ? '已复制选中内容' : '没有选中内容');
    } catch {
      setNote('复制失败');
    }
    window.setTimeout(() => setNote(''), 2200);
  };

  const restart = async () => {
    const term = termRef.current;
    if (!term) return;
    setStatus('loading');
    setNote('');
    try {
      await termClose();
      term.clear();
      await termSpawn();
      fitRef.current?.fit();
      void termResize(term.rows, term.cols);
      setStatus('ready');
      setNote('会话已重启');
    } catch (e) {
      setStatus('error');
      setErrorMsg(String(e));
    }
    window.setTimeout(() => setNote(''), 2600);
  };

  return (
    <div className="fx-window fx-term-window">
      <header className="fx-chrome">
        <div className="fx-brand">
          FLUX <span>/</span> TERMINAL
        </div>
        <div className="fx-crumb">CORE / LOCAL POWERSHELL — SESSION 01</div>
        <div className={`fx-status fx-status--${status}`}>
          <i className={status === 'ready' ? 'is-live' : status === 'error' ? 'is-error' : 'is-writing'} />
          {status === 'ready' ? 'READY' : status === 'error' ? 'ERROR' : 'LINKING'}
        </div>
      </header>

      <div className="fx-term-toolbar">
        <div className="fx-term-presets">
          {PRESETS.map((p) => (
            <button key={p.command} className="fx-textbtn" onClick={() => send(p.command)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="fx-term-actions">
          {note && <span className="fx-term-note">{note}</span>}
          <button className="fx-textbtn" onClick={clear}>
            清屏
          </button>
          <button className="fx-textbtn" onClick={() => void copySelection()}>
            复制选中
          </button>
          <button className="fx-textbtn" onClick={() => void restart()}>
            重启会话
          </button>
        </div>
      </div>

      {status === 'error' && (
        <div className="fx-term-error">
          <strong>终端未就绪</strong>
          <span>{errorMsg}</span>
        </div>
      )}

      <div className={`fx-term-screen ${status === 'loading' ? 'is-linking' : ''}`} ref={containerRef} />

      <footer className="fx-term-footer">
        <span>POWERSHELL · UTF-8</span>
        <span>本地 PTY · 由引擎托管</span>
        <span>Ctrl+C 中断 · 回车执行</span>
      </footer>
    </div>
  );
}
