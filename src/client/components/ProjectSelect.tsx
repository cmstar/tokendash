import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { projectName } from '../../shared/projectNames.js';

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function projectOptions(projects: string[]) {
  const counts = new Map<string, number>();
  const options = projects.map(value => {
    const name = projectName(value);
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const prefix = value.replace(/[/\\]+$/, '').slice(0, -name.length);
    const parent = /^(?:[A-Za-z]:)?[/\\]$/.test(prefix) ? prefix : prefix.replace(/[/\\]+$/, '');
    return { value, name, parent };
  });
  options.sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.parent, b.parent) || a.value.localeCompare(b.value));
  return [
    { value: '', name: 'All Projects', parent: '' },
    ...options.map(option => counts.get(option.name.toLowerCase()) === 1 ? { ...option, parent: '' } : option),
  ];
}

export function ProjectSelect({ projects, value, onChange }: { projects: string[]; value: string; onChange: (value: string) => void }) {
  const options = useMemo(() => projectOptions(projects), [projects]);
  const selected = options.find(option => option.value === value) ?? { value, name: projectName(value), parent: '' };
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const open = activeValue !== null;
  const activeIndex = Math.max(0, options.findIndex(option => option.value === activeValue));
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const search = useRef({ text: '', time: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current!;
    const list = listRef.current!;
    const position = () => {
      const rect = root.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < Math.min(list.scrollHeight, 320) && above > below;
      list.style.left = Math.min(0, document.documentElement.clientWidth - rect.left - list.offsetWidth - 8) + 'px';
      list.style.top = upwards ? 'auto' : 'calc(100% + 4px)';
      list.style.bottom = upwards ? 'calc(100% + 4px)' : 'auto';
      list.style.maxHeight = Math.min(320, Math.max(0, upwards ? above : below)) + 'px';
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position);
    };
  }, [open, options]);

  useEffect(() => {
    if (open) listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveValue(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setActiveValue(null);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const index = Math.max(0, Math.min(options.length - 1, activeIndex + (key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(open ? options[index].value : selected.value);
    } else if (key === 'Home' || key === 'End') {
      setActiveValue(options[key === 'Home' ? 0 : options.length - 1].value);
    } else if (key === 'Enter' || key === ' ') {
      if (open) choose(options[activeIndex].value);
      else setActiveValue(selected.value);
    } else if (key === 'Escape' && open) {
      setActiveValue(null);
    } else if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const now = Date.now();
      const letter = key.toLowerCase();
      const text = (now - search.current.time < 700 ? search.current.text : '') + letter;
      search.current = { text, time: now };
      const prefix = [...text].every(c => c === letter) ? letter : text;
      const start = options.indexOf(open ? options[activeIndex] : selected) + (prefix.length === 1 ? 1 : 0);
      const next = [...options.slice(start), ...options.slice(0, start)].find(option => option.name.toLowerCase().startsWith(prefix));
      if (next) {
        if (open) setActiveValue(next.value);
        else onChange(next.value);
      }
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <div ref={rootRef} className="relative w-[220px] max-w-full">
      <button type="button" role="combobox" aria-label="Project" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? listId + '-' + activeIndex : undefined} title={selected.value || selected.name}
        onClick={() => setActiveValue(open ? null : selected.value)} onKeyDown={handleKey}
        onBlur={() => setActiveValue(null)}
        className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-left text-xs font-semibold text-stone-800 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/20">
        <span className="truncate">{selected.name}</span>
        {selected.parent && <small className="ml-auto max-w-[52%] truncate text-[11px] font-normal text-stone-500">{selected.parent}</small>}
        <span aria-hidden="true" className="ml-auto mb-1 size-1.5 shrink-0 rotate-45 border-r-[1.5px] border-b-[1.5px]" />
      </button>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Project" onMouseDown={event => event.preventDefault()}
          className="absolute z-50 w-max min-w-full max-w-[min(32rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
          {options.map((option, index) => (
            <li key={option.value} id={listId + '-' + index} role="option" aria-selected={option.value === selected.value}
              title={option.value || option.name} onClick={() => choose(option.value)}
              className={`flex cursor-pointer items-baseline justify-between gap-4 rounded-md px-2.5 py-2 text-left text-xs text-stone-800 hover:bg-stone-100 ${index === activeIndex ? 'bg-indigo-50' : ''} ${option.value === selected.value ? 'font-semibold' : ''}`}>
              <span className="min-w-0 wrap-anywhere">{option.name}</span>
              {option.parent && <small className="max-w-[55%] text-right text-[11px] font-normal text-stone-500 wrap-anywhere">{option.parent}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
