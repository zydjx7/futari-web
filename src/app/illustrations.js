const symbols = {
  mail: '<rect x="2.8" y="5.1" width="18.4" height="13.8" rx="3.4"/><path d="m4.5 7.2 5.8 4.8c1 .8 2.4.8 3.4 0l5.8-4.8"/>',
  "/menu": '<path d="M3 11.5h18c-.6 4.4-3.7 7.2-9 7.2s-8.4-2.8-9-7.2ZM8.5 20h7M7 8c-1.4-2 1.6-2.4.4-4.4M11.6 8c-1.5-2 1.7-2.4.5-4.4M15.8 8c-1.4-2 1.6-2.4.4-4.4"/>',
  "/novels": '<path d="M12 6.8c-2.4-2-5.4-2.5-9-1.5v13c3.6-1 6.6-.4 9 1.5 2.4-1.9 5.4-2.5 9-1.5v-13c-3.6-1-6.6-.5-9 1.5ZM12 7v12M5.8 9.1c1.3-.2 2.4 0 3.5.5"/>',
  "/puzzles": '<path d="M4 5h5a2.8 2.8 0 1 1 5.5 0H19v5a2.8 2.8 0 1 0 0 5.5V20h-5a2.8 2.8 0 1 0-5.5 0H4Z"/>',
  "/news": '<path d="M4 4.5h14v13.4a2.4 2.4 0 0 0 2.3 2.3H6.5A2.5 2.5 0 0 1 4 17.7ZM18 9h3v9a2.1 2.1 0 0 1-2 2.2M7 8h8M7 11.5h3v3H7zM12.7 11.5H15M12.7 14.5H15M7 17.1h8"/>',
  paper: '<path fill="#F4DDAF" d="m4 4 13-1 2 16-13 1z"/><path fill="#FFF3F3" d="M7 4.5h13v16H8.7A1.7 1.7 0 0 1 7 18.8Z"/><path d="M9.7 5v15M12.4 10.7h5M12.4 13.5h3.8"/><path fill="#CD8294" stroke="none" d="M14.5 4h3v4.6L16 7.7l-1.5.9Z"/>',
  ears: '<path fill="#F9E5C9" d="M3.8 19.6c.2-2.5 1.3-4.1 3.5-5.5C5 9.5 4.1 4.3 5.9 3.9c1.8-.5 4.1 5 4.8 8.8.9-.2 1.7-.2 2.6 0 .6-4.1 2.6-9.4 4.3-9 2 .5.8 6.2-1.1 10.6 2.2 1.3 3.3 3.1 3.5 5.3"/><path d="M7 6.4 9 11m7.6-4.5-1.7 4.7" stroke="#D99AAA" stroke-width="1.2"/>',
  person: '<circle cx="12" cy="8.2" r="3"/><path d="M5.8 19c.5-3.8 2.7-5.7 6.2-5.7s5.7 1.9 6.2 5.7"/>',
  bookmark: '<path d="M6.7 3.5h10.6v17L12 17l-5.3 3.5z"/>',
  contents: '<path d="M8 6.5h11M8 12h11M8 17.5h11M4 6.5h.1M4 12h.1M4 17.5h.1"/>'
};

export function icon(name) {
  return `<svg class="line-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${symbols[name]}</svg>`;
}

// Small, two-tone editorial illustrations for the four section headings.
const drawings = {
  "/menu": `<ellipse class="art-shadow" cx="61" cy="62" rx="36" ry="3"/>
    <path d="m58 35 45-25m-38 27 42-23" stroke="#AD7880" stroke-width="2"/>
    <path d="M37 35c2-4 5-5 9-4 1-4 7-5 10-2 4-4 10-2 12 1 5-2 10 1 12 5" fill="#F6E3B8"/>
    <path d="M50 29c-2-5-1-8 1-11m2 10c1-5 4-7 8-8-1 4-3 7-8 8" fill="#C2D4B5" stroke="#82977D"/>
    <path d="M24 35c3 14 13 23 34 23s31-9 35-23" fill="#F6DEE4"/>
    <path d="M49 57v3c4 2 15 2 19 0v-3" fill="#F5E1C7"/>
    <path d="M24 35c13 4 54 4 69 0M28 42c17 5 44 5 61 0M34 49c9 3 16 4 24 4" stroke="#C58B9A"/>
    <path d="M53 45c2-2 4-1 5 0 1-1 4-2 5 0 1 2-3 5-5 6-2-1-6-4-5-6Z" fill="#D8909F" stroke="none"/><path d="M56 43l2 2 2-2" stroke="#8D9F80"/><path d="M33 25c-5-6 5-9 0-15m8 12c-3-4 3-7 1-11" stroke="#D3B1AD"/>`,
  "/novels": `<ellipse class="art-shadow" cx="61" cy="61" rx="39" ry="3"/>
    <path d="m23 46 54-8 18 8-2 7-52 8-18-8Z" fill="#DAE8D6"/><path d="m24 47 18 8 51-8M43 55l-.6 5m3-3 41-6" stroke="#91A48C"/>
    <path d="m29 33 51-7 15 8-1 8-50 8-15-9Z" fill="#F4DFB7"/><path d="m30 34 15 8 49-8M46 43v6m3-4 37-6" stroke="#C1A685"/>
    <path d="m27 24 48-9 17 9-1 7-49 10-15-9Z" fill="#FFF8EA"/>
    <path d="m27 24 15 9 50-9-16-10Z" fill="#F1CFD8"/><path d="m43 34-1 6m3-4 19-4m8-2 13-3" stroke="#B48D99"/>
    <path d="m63 30 4 1-1 9 3-2 3 1 .5-9-4-1" fill="#C77C8D"/><path d="m48 24 18-3" stroke="#B38190"/>`,
  "/puzzles": `<ellipse class="art-shadow" cx="62" cy="62" rx="38" ry="3"/>
    <g transform="rotate(-9 48 42)"><path d="M26 30h11c-2-9 9-11 10-3 0 1-.3 2-.7 3H59v10c-8-3-11 7-4 9l4-.2V58H26V47c7 3 11-5 5-8-2-1-3-1-5 0Z" fill="#F4D9CC"/><path d="M29 54v-5m2 6h8" stroke="#C99890"/></g>
    <g transform="rotate(13 77 29)"><path d="M63 15h10c-2-8 8-10 10-4 .5 1.5 0 3-.5 4H94v10c-7-3-10 6-4 8 1 .6 3 .5 4 .1V43H82c3-7-5-10-8-5-1 1.5-1 3 0 5H63V33c-8 3-11-6-5-8 1.8-.6 3.6-.4 5 0Z" fill="#DFE9D4"/><path d="M86 18h5v4" stroke="#9FAF8F"/></g>`,
  "/news": `<ellipse class="art-shadow" cx="62" cy="61" rx="37" ry="3"/>
    <g transform="rotate(-8 59 37)"><path d="M37 13h47v10h7v29c0 5-2 7-7 7H38c-4 0-6-2-6-6V17h5" fill="#ECD9D7"/>
    <path d="M32 15h49v38c0 3 1 5 4 6H36c-4 0-6-2-6-6V16Z" fill="#FFF5E9"/>
    <path d="M81 23h6v29c0 2-.7 3-2 3M36 22h37m-37 4h37" stroke="#B8979C"/>
    <path d="M36 32h14v12H36z" fill="#E5ECD9" stroke="#99AD99"/><path d="m37 42 4-5 3 2 3-3 3 3" stroke="#99AD99"/><path d="M55 33h18m-18 5h18m-18 5h14M36 49h37m-37 4h25" stroke="#B8A0A3"/></g>`
};

export function sectionDrawing(section) {
  return drawings[section] ? `<svg class="section-drawing" viewBox="0 0 120 72" width="120" height="72" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawings[section]}</svg>` : "";
}
