document.getElementById('year').textContent = new Date().getFullYear();

const TAG = {
  live: '<span class="tag live">Live</span>',
  wip:  '<span class="tag wip">In progress</span>',
  soon: '<span class="tag">Under development</span>',
};

function pad(n){ return String(n).padStart(2,'0'); }

function cardHtml(item, i){
  const isLive = item.status === 'live';
  const cls = isLive ? 'project' : 'project soon';
  const href = isLive ? item.url : '#';
  const arrow = isLive ? ' <span class="go">&rarr;</span>' : '';
  const tag = TAG[item.status] || TAG.soon;
  return `<a class="${cls}" href="${href}">
    <div class="p-top">
      <span class="p-mark">${pad(i+1)} / ${item.category || ''}</span>
      ${tag}
    </div>
    <div class="p-name">${item.name}${arrow}</div>
    <div class="p-desc">${item.description || ''}</div>
  </a>`;
}

const STATUS_ORDER = { live: 0, wip: 1, soon: 2 };

function groupHtml(group){
  const items = [...group.items].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
  const cards = items.map(cardHtml).join('');
  return `<div class="group">
    <div class="group-head">
      <span class="label">${group.label}</span>
      <span class="count">${pad(group.items.length)}</span>
      <span class="rule"></span>
    </div>
    <div class="projects">${cards}</div>
  </div>`;
}

async function render(){
  const mount = document.getElementById('groups');
  try {
    const res = await fetch('./projects.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    mount.innerHTML = (data.groups || []).map(groupHtml).join('');
  } catch (e) {
    mount.innerHTML = '<div class="empty">Projects could not be loaded.</div>';
  }
}
render();
