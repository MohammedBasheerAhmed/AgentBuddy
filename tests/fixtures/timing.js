// CPU time of a piece of work, for the tests that guard against a blow-up (catastrophic backtracking in a regular expression, a loop
// that turns quadratic): they give a large hostile input a time budget that linear code meets many times over.
//
// Wall-clock time was not a fair measure: `node tests/run.js` runs every test file in its own process at the same time, and on a busy
// computer a parse that takes 150 ms alone took more than 500 ms by the clock, because other processes had the CPU. This counts only
// the CPU time of this process (user + system, process.cpuUsage), runs the work once first so the code is compiled and warm, then
// measures up to three runs and keeps the best: one garbage collection or page fault does not fail a test. It stops at the first run
// within the budget, so a passing check costs two runs. A real blow-up is many times the budget in every run, so it still fails.
//
//   const { ms, value } = cpuTime(() => parse(input), 500);
//   assert.ok(ms < 500, `${Math.round(ms)} ms of CPU`);

/**
 * @param {() => any} work
 * @param {number} [budgetMs] stop measuring once a run is within it (without one, all three runs are measured)
 * @returns {{ ms: number, value: any }} ms: the best measured run, in milliseconds of CPU; value: what the last run returned
 */
export function cpuTime(work, budgetMs) {
  let value = work(); // warm-up, not measured
  let best = Infinity;
  for (let run = 0; run < 3; run += 1) {
    const start = process.cpuUsage();
    value = work();
    const used = process.cpuUsage(start);
    best = Math.min(best, (used.user + used.system) / 1000);
    if (best < budgetMs) break;
  }
  return { ms: best, value };
}
