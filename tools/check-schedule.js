// Are the bot and the search being started on time? Lists the last hours of runs per workflow and trigger,
// and the largest gap between bot runs. Public repository data only (no token needed).
//   node tools/check-schedule.js [hours]     (default 6)
const REPO = process.env.GITHUB_REPOSITORY || 'mrTal77/flight-bot';
const hours = Number(process.argv[2]) || 6;
(async () => {
  const since = new Date(Date.now() - hours * 36e5);
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100&page=${page}&created=>=${since.toISOString().slice(0, 19)}Z`, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const j = await res.json(); runs.push(...j.workflow_runs);
    if (j.workflow_runs.length < 100) break;
  }
  const mine = runs.filter((r) => /^(telegram-bot|flight-watch)$/.test(r.name));
  console.log(`Runs in the last ${hours} h (${REPO}):`);
  for (const name of ['telegram-bot', 'flight-watch']) {
    const rs = mine.filter((r) => r.name === name).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const by = (ev) => rs.filter((r) => r.event === ev).length;
    const failed = rs.filter((r) => r.conclusion && !['success', 'skipped', 'cancelled'].includes(r.conclusion)).length;
    let gap = 0;
    for (let i = 1; i < rs.length; i++) gap = Math.max(gap, (new Date(rs[i].created_at) - new Date(rs[i - 1].created_at)) / 6e4);
    const last = rs.length ? rs[rs.length - 1].created_at : '—';
    console.log(`  ${name.padEnd(13)} ${String(rs.length).padStart(4)} runs (started by API/cron-job: ${by('workflow_dispatch')}, GitHub schedule: ${by('schedule')}) · failed: ${failed} · longest gap: ${Math.round(gap)} min · last: ${last}`);
  }
  const expect = Math.floor(hours * 12);
  console.log(`  expected for the bot with a 5-minute trigger: about ${expect} runs`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
