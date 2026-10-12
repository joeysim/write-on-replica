// What the app costs standing still: how long it took to open, the memory it and WebKit's
// processes hold with the welcome piece showing, and the processor time five idle seconds use.
const { ui } = window.writeOn;
await document.fonts.ready;
await t.settle();
await t.wait(1500);
const round = (value) => Math.round(value * 10) / 10;
const parts = (m) => Object.fromEntries(['app', 'web', 'gpu', 'network'].filter((name) => m[name]).map((name) => [name, m[name]]));
const before = await t.call('test.metrics');
await t.wait(5000);
const after = await t.call('test.metrics');
const memory = Object.fromEntries(Object.entries(parts(after)).map(([name, use]) => [name, round(use.footprintMB)]));
memory.total = round(Object.values(memory).reduce((sum, value) => sum + value, 0));
const idle = Object.fromEntries(Object.entries(parts(after)).map(([name, use]) => [name, round(use.cpuMs - before[name].cpuMs)]));
t.log(JSON.stringify({ readyMs: Math.round(after.readyMs), memoryMB: memory, idleCpuMsOver5s: idle }));
ui.set({ read: false });
await t.wait(1500);
const on = await t.call('test.metrics');
const memoryOn = Object.fromEntries(Object.entries(parts(on)).map(([name, use]) => [name, round(use.footprintMB)]));
memoryOn.total = round(Object.values(memoryOn).reduce((sum, value) => sum + value, 0));
t.log(JSON.stringify({ withTheToolsOn: memoryOn }));
